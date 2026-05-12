import { agent, type AgentHandle, type Context } from "@agent-relay/agent";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { localRunStateRoot, repoStateKey } from "./shared/state-paths.js";
import type { LocalRunMonitorState } from "./surfaces/cli/flows/local-run-monitor.js";

const DEFAULT_RICKY_WORKSPACE = "ricky";
const DEFAULT_MONITOR_CHANNEL = "#ricky";
const DEFAULT_MONITOR_SCHEDULE = "*/5 * * * *";

export interface RickyScheduledAgentOptions {
  env?: NodeJS.ProcessEnv;
  repoRoot?: string;
  monitorChannel?: string;
  schedule?: string;
}

export function defaultRickyWorkspace(env: NodeJS.ProcessEnv = process.env): string {
  const workspace = env.RICKY_WORKSPACE_ID?.trim();
  return workspace && workspace.length > 0 ? workspace : DEFAULT_RICKY_WORKSPACE;
}

export function defaultRickyMonitorChannel(env: NodeJS.ProcessEnv = process.env): string {
  const channel = env.RICKY_MONITOR_CHANNEL?.trim();
  return channel && channel.length > 0 ? channel : DEFAULT_MONITOR_CHANNEL;
}

export function defaultRickyRepoRoot(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.RICKY_MONITOR_REPO_ROOT?.trim() || process.cwd());
}

export async function listPersistedRunStates(stateRoot: string): Promise<LocalRunMonitorState[]> {
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

    return runs
      .filter((run): run is LocalRunMonitorState => run !== null)
      .sort((left, right) => left.runId.localeCompare(right.runId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export function shouldNotifyRunState(state: LocalRunMonitorState): boolean {
  return state.status === "blocked" || state.status === "failed" || state.status === "completed";
}

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

export async function checkPersistedRuns(
  ctx: Context,
  input: {
    stateRoot: string;
    repoRoot: string;
    monitorChannel: string;
  },
): Promise<void> {
  const runs = await listPersistedRunStates(input.stateRoot);
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

export function createRickyScheduledAgent(
  options: RickyScheduledAgentOptions = {},
): AgentHandle {
  const env = options.env ?? process.env;
  const repoRoot = resolve(options.repoRoot ?? defaultRickyRepoRoot(env));
  const stateRoot = localRunStateRoot(repoRoot, env);
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
        stateRoot,
        repoRoot,
        monitorChannel,
      });
    },
  });
}
