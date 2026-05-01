import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import type { RawHandoff } from '../../../local/request-normalizer.js';
import type { LocalEntrypointOptions, LocalResponse } from '../../../local/entrypoint.js';
import { runLocal } from '../../../local/entrypoint.js';

export type LocalRunMode = 'background' | 'foreground';

export interface LocalRunMonitorState {
  runId: string;
  status: 'queued' | 'running' | 'completed' | 'blocked' | 'failed';
  artifactPath: string;
  artifactDir: string;
  statePath: string;
  logPath: string;
  evidencePath: string;
  fixesPath: string;
  reattachCommand: string;
  response?: LocalResponse;
}

export interface LocalRunMonitorOptions {
  cwd: string;
  artifactPath: string;
  handoff: RawHandoff;
  mode: LocalRunMode;
  autoFixAttempts?: number;
  localOptions?: LocalEntrypointOptions;
  runLocalFn?: typeof runLocal;
  onMonitorStarted?: (state: LocalRunMonitorState) => void | Promise<void>;
  /**
   * Inject a deterministic run-id factory for tests. The factory must return
   * a stable id given the artifactPath and mode so reattach paths and
   * `ricky status --run <id>` reproduce exactly across invocations.
   */
  runIdFactory?: (input: { artifactPath: string; mode: LocalRunMode }) => string;
}

export async function startLocalRunMonitor(options: LocalRunMonitorOptions): Promise<LocalRunMonitorState> {
  const runId = options.runIdFactory
    ? options.runIdFactory({ artifactPath: options.artifactPath, mode: options.mode })
    : `ricky-local-${randomUUID()}`;
  const artifactDir = resolve(options.cwd, '.workflow-artifacts', 'ricky-local-runs', runId);
  const statePath = join(artifactDir, 'state.json');
  const logPath = join(artifactDir, 'run.log');
  const evidencePath = join(artifactDir, 'evidence.json');
  const fixesPath = join(artifactDir, 'fixes.json');
  const reattachCommand = `ricky status --run ${runId}`;

  await mkdir(artifactDir, { recursive: true });
  const initialState: LocalRunMonitorState = {
    runId,
    status: 'queued',
    artifactPath: options.artifactPath,
    artifactDir,
    statePath,
    logPath,
    evidencePath,
    fixesPath,
    reattachCommand,
  };
  await persistState(initialState);

  const handoff = withSafeRunOptions(options.handoff, options.autoFixAttempts);
  const runningState = { ...initialState, status: 'running' as const };
  await persistState(runningState);
  await options.onMonitorStarted?.(runningState);

  const runLocalFn = options.runLocalFn ?? runLocal;
  const response = await runLocalFn(handoff, options.localOptions);
  const finalState: LocalRunMonitorState = {
    ...runningState,
    status: statusFromResponse(response),
    response,
  };

  await writeFile(logPath, `${response.logs.join('\n')}\n`, 'utf8');
  await writeFile(evidencePath, `${JSON.stringify(response.execution?.evidence ?? {}, null, 2)}\n`, 'utf8');
  await writeFile(fixesPath, `${JSON.stringify(response.auto_fix ?? { attempts: [] }, null, 2)}\n`, 'utf8');
  await copyGeneratedArtifacts(response, artifactDir, options.cwd);
  await persistState(finalState);

  return finalState;
}

export function withSafeRunOptions(handoff: RawHandoff, autoFixAttempts: number | undefined): RawHandoff {
  const maxAttempts = clampAutoFixAttempts(autoFixAttempts ?? 3);
  return {
    ...handoff,
    stageMode: 'run',
    mode: 'local',
    autoFix: { maxAttempts },
    metadata: {
      ...(handoff.metadata ?? {}),
      autoFixPolicy: 'bounded-safe-only',
      destructiveActionsApproved: false,
      commitsApproved: false,
    },
  } as RawHandoff;
}

function clampAutoFixAttempts(value: number): number {
  return Math.min(10, Math.max(1, Math.trunc(value)));
}

function statusFromResponse(response: LocalResponse): LocalRunMonitorState['status'] {
  if (response.ok) return 'completed';
  if (response.execution?.status === 'blocker') return 'blocked';
  return 'failed';
}

async function persistState(state: LocalRunMonitorState): Promise<void> {
  await mkdir(dirname(state.statePath), { recursive: true });
  await writeFile(state.statePath, `${JSON.stringify({
    runId: state.runId,
    status: state.status,
    artifactPath: state.artifactPath,
    artifactDir: state.artifactDir,
    logPath: state.logPath,
    evidencePath: state.evidencePath,
    fixesPath: state.fixesPath,
    reattachCommand: state.reattachCommand,
    response: state.response,
  }, null, 2)}\n`, 'utf8');
}

async function copyGeneratedArtifacts(response: LocalResponse, artifactDir: string, cwd: string): Promise<void> {
  const generatedDir = join(artifactDir, 'generated-artifacts');
  await mkdir(generatedDir, { recursive: true });
  for (const artifact of response.artifacts) {
    const safeName = artifact.path.replace(/[^a-zA-Z0-9._-]+/g, '__');
    const target = join(generatedDir, safeName);
    if (artifact.content !== undefined) {
      await writeFile(target, artifact.content, 'utf8');
      continue;
    }
    const sourcePath = isAbsolute(artifact.path) ? artifact.path : resolve(cwd, artifact.path);
    await writeFile(target, `Artifact reference: ${sourcePath}\n`, 'utf8');
  }
}
