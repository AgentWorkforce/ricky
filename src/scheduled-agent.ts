import { agent, type AgentHandle, type Context } from "@agent-relay/agent";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { localRunStateRoot, repoStateKey } from "./shared/state-paths.js";
import type { LocalRunMonitorState } from "./surfaces/cli/flows/local-run-monitor.js";

const DEFAULT_RICKY_WORKSPACE = "ricky";
const DEFAULT_MONITOR_CHANNEL = "#ricky";
const DEFAULT_MONITOR_SCHEDULE = "*/5 * * * *";

/** Tuning knobs accepted by {@link createRickyScheduledAgent}. */
export interface RickyScheduledAgentOptions {
  /** Environment used to resolve workspace, channel, and state-root overrides. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Repo whose persisted run-state should be scanned. Defaults to {@link defaultRickyRepoRoot}. */
  repoRoot?: string;
  /** Channel where terminal-state alerts are posted. Defaults to {@link defaultRickyMonitorChannel}. */
  monitorChannel?: string;
  /** Cron expression for the wake-up cadence. Defaults to every 5 minutes. */
  schedule?: string;
}

/** Resolves the Relaycast/relayfile workspace name from `RICKY_WORKSPACE_ID`. */
export function defaultRickyWorkspace(env: NodeJS.ProcessEnv = process.env): string {
  const workspace = env.RICKY_WORKSPACE_ID?.trim();
  return workspace && workspace.length > 0 ? workspace : DEFAULT_RICKY_WORKSPACE;
}

/** Resolves the proactive-monitor channel from `RICKY_MONITOR_CHANNEL`. */
export function defaultRickyMonitorChannel(env: NodeJS.ProcessEnv = process.env): string {
  const channel = env.RICKY_MONITOR_CHANNEL?.trim();
  return channel && channel.length > 0 ? channel : DEFAULT_MONITOR_CHANNEL;
}

/** Resolves the repo root to monitor from `RICKY_MONITOR_REPO_ROOT` or the current working directory. */
export function defaultRickyRepoRoot(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.RICKY_MONITOR_REPO_ROOT?.trim() || process.cwd());
}

/**
 * Legacy in-repo artifact location where `startLocalRunMonitor` writes
 * `state.json` when callers do not pass a `stateRoot` override. The
 * scheduled agent must keep scanning this path because the production
 * CLI flow at `src/surfaces/cli/flows/local-workflow-flow.ts` does not
 * pass `stateRoot` and therefore lands here.
 */
export function legacyLocalArtifactRunStateRoot(repoRoot: string): string {
  return resolve(repoRoot, ".workflow-artifacts", "ricky-local-runs");
}

async function readRunStatesInRoot(stateRoot: string): Promise<LocalRunMonitorState[]> {
  try {
    const entries = await readdir(stateRoot, { withFileTypes: true });
    const runs = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const statePath = join(stateRoot, entry.name, "state.json");
          try {
            return JSON.parse(await readFile(statePath, "utf8")) as LocalRunMonitorState;
          } catch {
            return null;
          }
        }),
    );

    return runs.filter((run): run is LocalRunMonitorState => run !== null);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/**
 * Loads persisted `LocalRunMonitorState` documents from one or more state
 * roots. Mirrors the dual-path lookup used by `ricky status --run` so the
 * monitor sees both the XDG state-home tree and the in-repo
 * `.workflow-artifacts/ricky-local-runs/` tree that the local-run flow
 * actually writes to. Runs that appear in multiple roots are deduped by
 * `runId`, preferring the first occurrence.
 */
export async function listPersistedRunStates(
  stateRoot: string | readonly string[],
): Promise<LocalRunMonitorState[]> {
  const roots = Array.isArray(stateRoot) ? stateRoot : [stateRoot as string];
  const byRunId = new Map<string, LocalRunMonitorState>();
  for (const root of roots) {
    for (const run of await readRunStatesInRoot(root)) {
      if (!byRunId.has(run.runId)) {
        byRunId.set(run.runId, run);
      }
    }
  }
  return [...byRunId.values()].sort((left, right) => left.runId.localeCompare(right.runId));
}

/** Returns true when a run state has reached a terminal status worth alerting on. */
export function shouldNotifyRunState(state: LocalRunMonitorState): boolean {
  return state.status === "blocked" || state.status === "failed" || state.status === "completed";
}

/** Renders a multi-line monitor alert summarizing a terminal background run. */
export function renderRunMonitorAlert(state: LocalRunMonitorState, repoRoot: string): string {
  const execution = state.response?.execution;
  const outcome =
    execution?.evidence?.outcome_summary
    ?? state.response?.warnings?.[0]
    ?? state.response?.logs?.[0]
    ?? "No additional detail recorded.";

  const lines = [
    state.status === "completed"
      ? "Ricky monitor: background workflow completed."
      : "Ricky monitor: background workflow needs attention.",
    "",
    `Repo: ${repoRoot}`,
    `Run id: ${state.runId}`,
    `Status: ${state.status}`,
    `Artifact: ${state.artifactPath}`,
    `Outcome: ${outcome}`,
    `Evidence: ${state.evidencePath}`,
    `Fixes: ${state.fixesPath}`,
    `Next: ${state.reattachCommand}`,
  ];

  if (execution?.execution.command) {
    lines.splice(6, 0, `Command: ${execution.execution.command}`);
  }

  return lines.join("\n");
}

/**
 * Scans every supplied state root for persisted runs and posts a one-shot
 * alert per `(repo, runId, status)` triple via `ctx.once`, so duplicate
 * ticks or peer replicas do not produce duplicate notifications.
 */
export async function checkPersistedRuns(
  ctx: Context,
  input: {
    stateRoots: readonly string[];
    repoRoot: string;
    monitorChannel: string;
  },
): Promise<void> {
  const runs = await listPersistedRunStates(input.stateRoots);
  for (const run of runs) {
    if (!shouldNotifyRunState(run)) {
      continue;
    }

    await ctx.once(
      `ricky-monitor:${repoStateKey(input.repoRoot)}:${run.runId}:${run.status}`,
      async () => {
        await ctx.messages.post(
          input.monitorChannel,
          renderRunMonitorAlert(run, input.repoRoot),
        );
        return true;
      },
    );
  }
}

/**
 * Creates the proactive Ricky monitor agent. Wakes on the configured cron
 * schedule, scans both the XDG state root and the in-repo
 * `.workflow-artifacts/ricky-local-runs/` tree, and posts a single alert
 * per terminal run via `ctx.once`.
 */
export function createRickyScheduledAgent(
  options: RickyScheduledAgentOptions = {},
): AgentHandle {
  const env = options.env ?? process.env;
  const repoRoot = resolve(options.repoRoot ?? defaultRickyRepoRoot(env));
  const stateRoots = [
    localRunStateRoot(repoRoot, env),
    legacyLocalArtifactRunStateRoot(repoRoot),
  ];
  const monitorChannel = options.monitorChannel ?? defaultRickyMonitorChannel(env);

  return agent({
    workspace: defaultRickyWorkspace(env),
    name: "ricky-monitor",
    schedule: options.schedule ?? DEFAULT_MONITOR_SCHEDULE,
    onEvent: async (ctx, event) => {
      if (event.type !== "cron.tick") {
        return;
      }

      await checkPersistedRuns(ctx, {
        stateRoots,
        repoRoot,
        monitorChannel,
      });
    },
  });
}
