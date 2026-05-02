import { constants } from 'node:fs';
import { access, readdir, readFile, stat } from 'node:fs/promises';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { editor, input, select } from '@inquirer/prompts';

import { PromptCancelledError } from '../prompts/index.js';
import type { RawHandoff } from '../../../local/request-normalizer.js';
import type { LocalEntrypointOptions, LocalResponse } from '../../../local/entrypoint.js';
import { runLocal } from '../../../local/entrypoint.js';
import { buildWorkflowSummary, type WorkflowSummary } from './workflow-summary.js';
import {
  runSpecIntakeFlow,
  specCaptureToHandoff,
  type CapturedWorkflowSpec,
  type SpecIntakePrompts,
} from './spec-intake-flow.js';
import { startLocalRunMonitor, withSafeRunOptions, type LocalRunMonitorState } from './local-run-monitor.js';

export interface LocalPreflightCheck {
  id: string;
  label: string;
  status: 'found' | 'missing' | 'unknown';
  path?: string;
  detail?: string;
  blocker?: boolean;
  recovery?: string;
}

export interface LocalSpecLocation {
  path: string;
  kind: 'file' | 'directory';
}

export interface LocalPreflightResult {
  cwd: string;
  repoRoot: string;
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown';
  checks: LocalPreflightCheck[];
  specLocations: LocalSpecLocation[];
  workflowArtifacts: string[];
  blockers: string[];
}

export type LocalRunConfirmation = 'background' | 'foreground' | 'not-now' | 'edit-first';

export interface LocalWorkflowPrompts extends SpecIntakePrompts {
  confirmRun(input: { summary: WorkflowSummary }): Promise<LocalRunConfirmation>;
}

export interface LocalWorkflowPromptRuntime {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  signal?: AbortSignal;
}

export interface LocalWorkflowFlowDeps {
  cwd?: string;
  prompts: LocalWorkflowPrompts;
  runLocalFn?: typeof runLocal;
  localOptions?: LocalEntrypointOptions;
  outputPath?: string;
  autoFixAttempts?: number;
  onMonitorStarted?: (state: LocalRunMonitorState) => void | Promise<void>;
}

export function createInquirerLocalWorkflowPrompts(runtime: LocalWorkflowPromptRuntime = {}): LocalWorkflowPrompts {
  const context = {
    input: runtime.input,
    output: runtime.output,
    signal: runtime.signal,
  };

  // Wrap every guided-prompt call so Ctrl+C / Abort during the local flow
  // surfaces as `PromptCancelledError` rather than leaking a raw inquirer
  // `ExitPromptError` / `AbortPromptError` through `runLocalWorkflowFlow`.
  async function withCancellationNormalization<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof Error && (error.name === 'AbortPromptError' || error.name === 'ExitPromptError')) {
        throw new PromptCancelledError(error.name === 'AbortPromptError' ? 'abort' : 'exit');
      }
      if (runtime.signal?.aborted === true) {
        throw new PromptCancelledError('abort');
      }
      throw error;
    }
  }

  return {
    async selectSpecSource({ suggestions }) {
      return withCancellationNormalization(() => select({
        message: suggestions.length > 0
          ? 'Do you already have a spec for this workflow?'
          : 'How should Ricky get the workflow spec?',
        choices: [
          { value: 'spec-file' as const, name: 'Yes, use a spec file' },
          { value: 'editor' as const, name: 'Yes, I will paste or write it now' },
          { value: 'goal' as const, name: 'No, help me shape one from a goal' },
          { value: 'workflow-artifact' as const, name: 'Run an existing workflow file' },
        ],
        default: suggestions.length > 0 ? 'spec-file' : 'editor',
        loop: false,
      }, context));
    },
    async inputSpecFilePath({ defaultPath }) {
      return withCancellationNormalization(() => input({
        message: 'Spec file path',
        default: defaultPath ?? 'SPEC.md',
        required: true,
      }, context));
    },
    async editSpec({ initialValue, message }) {
      return withCancellationNormalization(() => editor({
        message,
        default: initialValue,
        waitForUserInput: false,
      }, context));
    },
    async inputWorkflowName({ defaultName }) {
      return withCancellationNormalization(() => input({
        message: 'Workflow name',
        default: defaultName,
        required: true,
      }, context));
    },
    async inputGoal() {
      return withCancellationNormalization(() => input({
        message: 'Desired outcome',
        required: true,
      }, context));
    },
    async inputGoalClarification({ question }) {
      return withCancellationNormalization(() => input({
        message: question,
        required: true,
      }, context));
    },
    async approveGeneratedSpec({ spec }) {
      return withCancellationNormalization(() => select({
        message: 'Use this generated spec?',
        choices: [
          { value: 'approve' as const, name: 'Approve and generate workflow' },
          { value: 'edit' as const, name: 'Edit first' },
        ],
        default: 'approve',
        loop: false,
      }, {
        ...context,
        output: runtime.output,
      }));
    },
    async inputWorkflowArtifactPath({ suggestions }) {
      return withCancellationNormalization(() => input({
        message: 'Workflow artifact path',
        default: suggestions[0] ?? 'workflows/generated/local-workflow.ts',
        required: true,
      }, context));
    },
    async confirmRun({ summary }) {
      return withCancellationNormalization(() => select({
        message: summary.missingLocalBlockers.length > 0
          ? 'Local blockers were found. What should Ricky do?'
          : 'Run this workflow now?',
        choices: [
          { value: 'background' as const, name: 'Yes, run in the background and monitor it' },
          { value: 'foreground' as const, name: 'Yes, run in the foreground' },
          { value: 'not-now' as const, name: 'Not now, just show the command' },
          { value: 'edit-first' as const, name: 'Edit the workflow first' },
        ],
        default: summary.missingLocalBlockers.length > 0 ? 'not-now' : 'background',
        loop: false,
      }, context));
    },
  };
}

export interface LocalWorkflowFlowResult {
  preflight: LocalPreflightResult;
  capture: CapturedWorkflowSpec;
  generation?: LocalResponse;
  summary: WorkflowSummary;
  confirmation: LocalRunConfirmation;
  run?: LocalResponse;
  monitoredRun?: LocalRunMonitorState;
  runSummary?: LocalWorkflowRunSummary;
  command: string;
}

export interface LocalWorkflowRunSummary {
  outcome: string;
  changedFiles: string[];
  evidencePath?: string;
  nextCommand: string;
}

export async function runLocalPreflight(cwd = process.cwd()): Promise<LocalPreflightResult> {
  const resolvedCwd = resolve(cwd);
  const repoRoot = await detectRepoRoot(resolvedCwd);
  const packageManager = await detectPackageManager(repoRoot);
  const specLocations = await detectSpecLocations(repoRoot);
  const workflowArtifacts = await detectWorkflowArtifacts(repoRoot);

  const checks: LocalPreflightCheck[] = [
    {
      id: 'repo-root',
      label: 'Repo root',
      status: 'found',
      path: repoRoot,
    },
    {
      id: 'package-manager',
      label: 'Package manager',
      status: packageManager === 'unknown' ? 'unknown' : 'found',
      detail: packageManager,
    },
    await checkExecutable('agent-relay', repoRoot, true),
    await checkExecutable('claude', repoRoot, false),
    await checkExecutable('codex', repoRoot, false),
    await checkExecutable('opencode', repoRoot, false),
    await checkExecutable('gemini', repoRoot, false),
    await checkPath('.ricky/config.json', repoRoot, false, 'Run Ricky setup or continue with explicit CLI options.'),
  ];
  const blockers = checks
    .filter((check) => check.status === 'missing' && check.blocker)
    .map((check) => check.label);

  return {
    cwd: resolvedCwd,
    repoRoot,
    packageManager,
    checks,
    specLocations,
    workflowArtifacts,
    blockers,
  };
}

export async function runLocalWorkflowFlow(deps: LocalWorkflowFlowDeps): Promise<LocalWorkflowFlowResult> {
  const cwd = resolve(deps.cwd ?? process.cwd());
  const preflight = await runLocalPreflight(cwd);
  const capture = await runSpecIntakeFlow({ prompts: deps.prompts, cwd: preflight.repoRoot, preflight });
  const runLocalFn = deps.runLocalFn ?? runLocal;

  let generation: LocalResponse | undefined;
  let artifactPath = capture.artifactPath ?? capture.specPath;
  let handoff: RawHandoff;

  if (capture.source === 'workflow-artifact') {
    handoff = specCaptureToHandoff(capture, preflight.repoRoot, { stageMode: 'run' });
  } else {
    handoff = specCaptureToHandoff(capture, preflight.repoRoot, {
      stageMode: 'generate',
      outputPath: deps.outputPath,
    });
    generation = await runLocalFn(handoff, deps.localOptions);
    artifactPath = generation.generation?.artifact?.path ?? generation.artifacts[0]?.path ?? artifactPath;
  }

  const summary = buildWorkflowSummary({ capture, localResult: generation, preflight, artifactPath });
  const confirmation = await deps.prompts.confirmRun({ summary });
  const command = summary.command;

  if (confirmation === 'not-now' || confirmation === 'edit-first') {
    return { preflight, capture, generation, summary, confirmation, command };
  }

  const runHandoff = capture.source === 'workflow-artifact'
    ? handoff
    : {
        source: 'workflow-artifact',
        artifactPath: summary.artifactPath,
        invocationRoot: preflight.repoRoot,
        mode: 'local',
        stageMode: 'run',
        metadata: {
          workflowName: capture.workflowName,
          guidedSource: capture.source,
        },
      } satisfies RawHandoff;

  if (confirmation === 'background') {
    const monitoredRun = await startLocalRunMonitor({
      cwd: preflight.repoRoot,
      artifactPath: summary.artifactPath,
      handoff: runHandoff,
      mode: 'background',
      autoFixAttempts: deps.autoFixAttempts,
      localOptions: deps.localOptions,
      runLocalFn,
      onMonitorStarted: deps.onMonitorStarted,
    });
    return {
      preflight,
      capture,
      generation,
      summary,
      confirmation,
      monitoredRun,
      runSummary: buildLocalWorkflowRunSummary(monitoredRun, undefined, command),
      command,
    };
  }

  const run = await runLocalFn(withSafeRunOptions(runHandoff, deps.autoFixAttempts), deps.localOptions);
  return {
    preflight,
    capture,
    generation,
    summary,
    confirmation,
    run,
    runSummary: buildLocalWorkflowRunSummary(undefined, run, command),
    command,
  };
}

export function buildLocalWorkflowRunSummary(
  monitoredRun: LocalRunMonitorState | undefined,
  run: LocalResponse | undefined,
  command: string,
): LocalWorkflowRunSummary {
  const response = monitoredRun?.response ?? run;
  const evidence = response?.execution?.evidence;
  const changedFiles = [
    ...(evidence?.side_effects.files_written ?? []),
    ...(response?.artifacts.map((artifact) => artifact.path) ?? []),
  ];
  return {
    outcome: evidence?.outcome_summary
      ?? (monitoredRun ? `Background run ${monitoredRun.status}.` : response?.ok ? 'Local run completed.' : 'Local run did not complete.'),
    changedFiles: [...new Set(changedFiles)],
    evidencePath: monitoredRun?.evidencePath
      ?? evidence?.logs.stdout_path
      ?? evidence?.logs.stderr_path,
    nextCommand: monitoredRun?.reattachCommand ?? command,
  };
}

async function detectRepoRoot(cwd: string): Promise<string> {
  let current = cwd;
  while (true) {
    if (await exists(join(current, '.git')) || await exists(join(current, 'package.json'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return cwd;
    current = parent;
  }
}

async function detectPackageManager(repoRoot: string): Promise<LocalPreflightResult['packageManager']> {
  const packageJsonPath = join(repoRoot, 'package.json');
  try {
    const parsed = JSON.parse(await readFile(packageJsonPath, 'utf8')) as { packageManager?: unknown };
    if (typeof parsed.packageManager === 'string') {
      if (parsed.packageManager.startsWith('pnpm@')) return 'pnpm';
      if (parsed.packageManager.startsWith('yarn@')) return 'yarn';
      if (parsed.packageManager.startsWith('bun@')) return 'bun';
      if (parsed.packageManager.startsWith('npm@')) return 'npm';
    }
  } catch {
    // Fall through to lockfile detection.
  }
  if (await exists(join(repoRoot, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await exists(join(repoRoot, 'yarn.lock'))) return 'yarn';
  if (await exists(join(repoRoot, 'bun.lockb')) || await exists(join(repoRoot, 'bun.lock'))) return 'bun';
  if (await exists(join(repoRoot, 'package-lock.json'))) return 'npm';
  return 'unknown';
}

async function detectSpecLocations(repoRoot: string): Promise<LocalSpecLocation[]> {
  const locations: LocalSpecLocation[] = [];
  for (const candidate of ['SPEC.md', 'spec.md', 'specs', 'docs/specs', 'docs/product', 'product/specs', '.ricky/specs']) {
    const path = join(repoRoot, candidate);
    try {
      const entry = await stat(path);
      locations.push({
        path: candidate,
        kind: entry.isDirectory() ? 'directory' : 'file',
      });
    } catch {
      // Missing common spec locations are not blockers.
    }
  }
  return locations;
}

async function detectWorkflowArtifacts(repoRoot: string): Promise<string[]> {
  const roots = ['workflows/generated', 'workflows'];
  const artifacts: string[] = [];
  for (const root of roots) {
    const absoluteRoot = join(repoRoot, root);
    if (!(await exists(absoluteRoot))) continue;
    for (const file of await listFiles(absoluteRoot, 2)) {
      if (/\.(?:ts|js)$/.test(file)) {
        artifacts.push(file.slice(repoRoot.length + 1));
      }
    }
  }
  return [...new Set(artifacts)].sort();
}

async function listFiles(root: string, depth: number): Promise<string[]> {
  if (depth < 0) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(path, depth - 1));
    } else {
      files.push(path);
    }
  }
  return files;
}

async function checkExecutable(command: string, repoRoot: string, blocker: boolean): Promise<LocalPreflightCheck> {
  const localBin = join(repoRoot, 'node_modules', '.bin', command);
  if (await executable(localBin)) {
    return { id: command, label: command, status: 'found', path: localBin };
  }
  for (const pathEntry of (process.env.PATH ?? '').split(delimiter)) {
    if (!pathEntry) continue;
    const candidate = join(pathEntry, command);
    if (await executable(candidate)) {
      return { id: command, label: command, status: 'found', path: candidate };
    }
  }
  return {
    id: command,
    label: command,
    status: 'missing',
    blocker,
    recovery: command === 'agent-relay'
      ? 'Install dependencies so node_modules/.bin/agent-relay is available, or install agent-relay on PATH.'
      : `Install or connect ${command} if the generated workflow assigns it work.`,
  };
}

async function checkPath(path: string, repoRoot: string, blocker: boolean, recovery: string): Promise<LocalPreflightCheck> {
  const absolute = join(repoRoot, path);
  return {
    id: path,
    label: path,
    status: await exists(absolute) ? 'found' : 'missing',
    path: absolute,
    blocker,
    recovery,
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function executable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function localPreflightDigest(preflight: LocalPreflightResult): string[] {
  return [
    `Repo: ${basename(preflight.repoRoot)}`,
    `Package manager: ${preflight.packageManager}`,
    ...preflight.checks.map((check) => `${check.label}: ${check.status}${check.path ? ` (${check.path})` : ''}`),
    ...preflight.specLocations.map((location) => `Spec ${location.kind}: ${location.path}`),
  ];
}
