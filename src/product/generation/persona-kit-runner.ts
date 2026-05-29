/**
 * Thin adapter that gives ricky a `useRunnableSelection` / `useRunnablePersona`
 * interface backed by `@agentworkforce/persona-kit` instead of the deprecated
 * `@agentworkforce/harness-kit`.
 *
 * persona-kit's `buildNonInteractiveSpec` uses the correct codex flags —
 * no `--ask-for-approval`, which was removed in codex 0.1.77+ and caused
 * every codex agent step to exit immediately with a parse error.
 *
 * The subprocess-spawning logic is ported from harness-kit's `runner.ts` so
 * callers see the same result shape and the same timeout / cancellation
 * behaviour.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { buildNonInteractiveSpec } from '@agentworkforce/persona-kit';
import {
  usePersona,
  useSelection,
  type PersonaContext,
  type PersonaSelection,
} from '@agentworkforce/workload-router';

// ── Types mirrored from harness-kit for API compatibility ─────────────────────

export interface RunnablePersonaOptions {
  tier?: string;
  installRoot?: string;
  harness?: string;
  profile?: string;
  commandOverrides?: Record<string, string>;
}

export interface RunnableSelectionOptions {
  installRoot?: string;
  harness?: string;
  commandOverrides?: Record<string, string>;
}

export interface SendMessageOptions {
  workingDirectory?: string;
  name?: string;
  timeoutSeconds?: number;
  installSkills?: boolean;
  env?: Record<string, string>;
  signal?: AbortSignal;
  onProgress?: (event: { stream: 'stdout' | 'stderr'; text: string }) => void;
  inputs?: Record<string, string | number | boolean>;
}

export interface PersonaExecutionResult {
  status: 'completed' | 'failed' | 'cancelled' | 'timeout';
  output: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  workflowRunId?: string;
}

export interface PersonaExecution extends Promise<PersonaExecutionResult> {
  cancel(reason?: string): void;
  runId: Promise<string>;
}

export interface RunnablePersonaContext {
  selection: PersonaSelection;
  install: {
    commandString: string;
    command: readonly string[];
    cleanupCommandString: string;
    cleanupCommand: readonly string[];
  };
  sendMessage(task: string, options?: SendMessageOptions): PersonaExecution;
}

// ── Subprocess spawning (ported from harness-kit/runner.ts) ──────────────────

const FORCE_KILL_GRACE_MS = 1_000;

interface SpawnCaptureOptions {
  cwd?: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
  timeoutSeconds?: number;
  onProgress?: (event: { stream: 'stdout' | 'stderr'; text: string }) => void;
}

interface SpawnCaptureResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  status: 'completed' | 'failed' | 'cancelled' | 'timeout';
}

function abortReason(signal: AbortSignal, fallback = 'cancelled'): string {
  return signal.reason instanceof Error
    ? signal.reason.message
    : typeof signal.reason === 'string'
      ? signal.reason
      : fallback;
}

function anySignal(signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  const active = signals.filter((s): s is AbortSignal => s !== undefined);
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  // AbortSignal.any() (Node.js ≥ 20.3) handles listener cleanup automatically.
  return AbortSignal.any(active);
}

async function spawnCapture(
  bin: string | undefined,
  args: readonly string[],
  options: SpawnCaptureOptions,
): Promise<SpawnCaptureResult> {
  if (!bin) return { stdout: '', stderr: 'missing command\n', exitCode: 127, status: 'failed' };
  if (options.signal?.aborted) {
    return { stdout: '', stderr: abortReason(options.signal), exitCode: null, status: 'cancelled' };
  }
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let cancelled = false;
    let forceKillTimeout: ReturnType<typeof setTimeout> | undefined;

    const child = spawn(bin, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timeout =
      options.timeoutSeconds && options.timeoutSeconds > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
            forceKillTimeout = setTimeout(() => {
              if (!settled) child.kill('SIGKILL');
            }, FORCE_KILL_GRACE_MS);
          }, options.timeoutSeconds * 1000)
        : undefined;

    const abort = () => { cancelled = true; child.kill('SIGTERM'); };
    options.signal?.addEventListener('abort', abort, { once: true });

    const finish = (exitCode: number | null, status?: SpawnCaptureResult['status']) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (forceKillTimeout) clearTimeout(forceKillTimeout);
      options.signal?.removeEventListener('abort', abort);
      resolve({
        stdout,
        stderr,
        exitCode,
        status: status ?? (timedOut ? 'timeout' : cancelled ? 'cancelled' : 'completed'),
      });
    };

    child.stdout!.on('data', (buf: Buffer) => {
      const text = buf.toString();
      stdout += text;
      options.onProgress?.({ stream: 'stdout', text });
    });
    child.stderr!.on('data', (buf: Buffer) => {
      const text = buf.toString();
      stderr += text;
      options.onProgress?.({ stream: 'stderr', text });
    });
    // Use 'close' (not 'exit') to ensure stdio streams are fully drained
    // before resolving — 'exit' fires while pipes may still have buffered data.
    child.on('close', (code) => finish(code));
    child.on('error', (err: NodeJS.ErrnoException) => {
      stderr += err.message;
      finish(err.code === 'ENOENT' ? 127 : 1, 'failed');
    });
  });
}

// ── Core adapter ─────────────────────────────────────────────────────────────

/**
 * Build a `RunnablePersonaContext` from a workload-router `PersonaContext`
 * using `@agentworkforce/persona-kit`'s `buildNonInteractiveSpec` for
 * argument construction and inline subprocess spawning for execution.
 *
 * The workload-router `PersonaContext.selection.runtime` carries the flat
 * harness/model/systemPrompt fields that persona-kit's `buildNonInteractiveSpec`
 * expects as `BuildInteractiveSpecInput`.
 */
export function makeRunnablePersonaContext(
  personaContext: PersonaContext,
  options: { commandOverrides?: Record<string, string> } = {},
): RunnablePersonaContext {
  const { selection } = personaContext;
  const { runtime } = selection;
  const install = personaContext.install ?? {
    commandString: ':',
    command: [':'],
    cleanupCommandString: ':',
    cleanupCommand: [':'],
  };

  const sendMessage = (task: string, sendOptions: SendMessageOptions = {}): PersonaExecution => {
    const runId = randomUUID();
    const controller = new AbortController();
    const startedAt = Date.now();
    let cancelReason = '';

    const cancel = (reason = 'cancelled') => { cancelReason = reason; controller.abort(); };

    const promise = (async (): Promise<PersonaExecutionResult> => {
      const cwd = sendOptions.workingDirectory ?? process.cwd();
      const callerEnv: Record<string, string> = sendOptions.env
        ? { ...process.env as Record<string, string>, ...sendOptions.env }
        : { ...process.env as Record<string, string> };

      // persona-kit's buildNonInteractiveSpec uses the fixed codex flags.
      // workload-router's runtime object maps 1:1 to BuildInteractiveSpecInput.
      const spec = buildNonInteractiveSpec({
        harness: runtime.harness as 'claude' | 'codex' | 'opencode',
        personaId: selection.personaId,
        model: runtime.model,
        systemPrompt: runtime.systemPrompt ?? '',
        harnessSettings: runtime.harnessSettings as Parameters<typeof buildNonInteractiveSpec>[0]['harnessSettings'],
        mcpServers: selection.mcpServers as Parameters<typeof buildNonInteractiveSpec>[0]['mcpServers'],
        permissions: selection.permissions as Parameters<typeof buildNonInteractiveSpec>[0]['permissions'],
        task,
        name: sendOptions.name,
        workingDirectory: cwd,
      });

      const bin = options.commandOverrides?.[runtime.harness] ?? spec.bin;
      const signal = anySignal([controller.signal, sendOptions.signal]);

      if (signal?.aborted) {
        return {
          status: 'cancelled',
          output: '',
          stderr: abortReason(signal, cancelReason),
          exitCode: null,
          durationMs: Date.now() - startedAt,
        };
      }

      const skillsInstalled =
        sendOptions.installSkills === true && install.commandString !== ':';

      // Install skills if requested
      if (skillsInstalled) {
        const installResult = await spawnCapture(install.command[0], install.command.slice(1), {
          cwd,
          env: callerEnv,
          signal,
          timeoutSeconds: sendOptions.timeoutSeconds,
          onProgress: sendOptions.onProgress,
        });
        if (installResult.status !== 'completed' || (installResult.exitCode ?? 0) !== 0) {
          return {
            status: installResult.status === 'completed' ? 'failed' : installResult.status,
            output: installResult.stdout,
            stderr: installResult.stderr,
            exitCode: installResult.exitCode,
            durationMs: Date.now() - startedAt,
          };
        }
      }

      // Wrap execution in try/finally so cleanup always runs even on error/cancellation.
      let result: SpawnCaptureResult;
      try {
        result = await spawnCapture(bin, spec.args, {
          cwd,
          env: callerEnv,
          signal,
          timeoutSeconds: sendOptions.timeoutSeconds,
          onProgress: sendOptions.onProgress,
        });
      } finally {
        if (skillsInstalled && install.cleanupCommandString !== ':') {
          await spawnCapture(install.cleanupCommand[0], install.cleanupCommand.slice(1), {
            cwd,
            env: callerEnv,
            signal: undefined,
            timeoutSeconds: 30,
          }).catch(() => undefined);
        }
      }

      const status =
        result.status === 'completed' && (result.exitCode ?? 0) !== 0 ? 'failed' : result.status;

      return {
        status,
        output: result.stdout,
        stderr: result.stderr + (cancelReason ? `\n${cancelReason}` : ''),
        exitCode: result.exitCode,
        durationMs: Date.now() - startedAt,
      };
    })();

    const execution = promise as PersonaExecution;
    Object.defineProperties(execution, {
      cancel: { value: cancel },
      runId: { value: Promise.resolve(runId) },
    });
    return execution;
  };

  return { selection, install, sendMessage };
}

// ── Public API (mirrors harness-kit exports) ──────────────────────────────────

/**
 * Resolve a persona intent to a runnable context using persona-kit's
 * `buildNonInteractiveSpec` for correct CLI argument generation.
 */
export function useRunnablePersona(
  intent: string,
  options: RunnablePersonaOptions = {},
): RunnablePersonaContext {
  type UsePersonaOpts = NonNullable<Parameters<typeof usePersona>[1]>;
  // workload-router narrows intent to a specific union — cast through unknown.
  const opts: UsePersonaOpts = {
    harness: options.harness as UsePersonaOpts['harness'],
    tier: options.tier as UsePersonaOpts['tier'],
    installRoot: options.installRoot,
    ...( options.profile !== undefined
      ? { profile: options.profile as UsePersonaOpts['profile'] }
      : {} ),
  };
  const context = usePersona(intent as Parameters<typeof usePersona>[0], opts);
  return makeRunnablePersonaContext(context, { commandOverrides: options.commandOverrides });
}

/**
 * Convert a pre-resolved `PersonaSelection` to a runnable context using
 * persona-kit's `buildNonInteractiveSpec` for correct CLI argument generation.
 */
export function useRunnableSelection(
  selection: PersonaSelection,
  options: RunnableSelectionOptions = {},
): RunnablePersonaContext {
  const context = useSelection(selection, {
    harness: options.harness as Parameters<typeof useSelection>[1] extends { harness?: infer H } ? H : never,
    installRoot: options.installRoot,
  });
  return makeRunnablePersonaContext(context, { commandOverrides: options.commandOverrides });
}
