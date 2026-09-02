import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import {
  listPersistedRunStates,
  reconcilePersistedRunState,
  renderRunMonitorAlert,
  shouldNotifyRunState,
} from "./scheduled-agent.js";
import type { LocalExecutionStageResult } from "./local/entrypoint.js";
import type { LocalRunMonitorState } from "./surfaces/cli/flows/local-run-monitor.js";

function buildRunState(
  runId: string,
  status: LocalRunMonitorState["status"],
  overrides: Partial<LocalRunMonitorState> = {},
): LocalRunMonitorState {
  const base: LocalRunMonitorState = {
    runId,
    status,
    artifactPath: `workflows/generated/${runId}.ts`,
    artifactDir: `/tmp/${runId}`,
    statePath: `/tmp/${runId}/state.json`,
    logPath: `/tmp/${runId}/run.log`,
    evidencePath: `/tmp/${runId}/evidence.json`,
    fixesPath: `/tmp/${runId}/fixes.json`,
    reattachCommand: `ricky status --run ${runId}`,
    response: {
      ok: status === "completed",
      artifacts: [],
      logs: [],
      warnings: [],
      nextActions: [],
      exitCode: status === "completed" ? 0 : 1,
    },
  };
  return { ...base, ...overrides };
}

async function writePersistedRun(root: string, state: LocalRunMonitorState): Promise<void> {
  const runDir = join(root, state.runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, "state.json"), JSON.stringify(state), "utf8");
}

describe("ricky scheduled agent helpers", () => {
  const cleanupRoots: string[] = [];

  afterEach(async () => {
    while (cleanupRoots.length) {
      const root = cleanupRoots.pop()!;
      await rm(root, { recursive: true, force: true });
    }
  });

  async function makeStateRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "ricky-agent-state-"));
    cleanupRoots.push(root);
    return root;
  }

  it("loads persisted background run state from disk", async () => {
    const stateRoot = await makeStateRoot();
    await writePersistedRun(stateRoot, buildRunState("run-1", "failed"));

    const runs = await listPersistedRunStates(stateRoot);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.runId).toBe("run-1");
  });

  it("scans multiple state roots and dedupes by run id", async () => {
    const xdgRoot = await makeStateRoot();
    const artifactRoot = await makeStateRoot();
    await writePersistedRun(xdgRoot, buildRunState("run-shared", "failed"));
    await writePersistedRun(artifactRoot, buildRunState("run-shared", "blocked"));
    await writePersistedRun(artifactRoot, buildRunState("run-artifact-only", "completed"));

    const runs = await listPersistedRunStates([xdgRoot, artifactRoot]);
    expect(runs.map((run) => run.runId)).toEqual(["run-artifact-only", "run-shared"]);
    expect(runs.find((run) => run.runId === "run-shared")?.status).toBe("failed");
  });

  it("reclassifies ancient active run state with no evidence as failed", async () => {
    const stateRoot = await makeStateRoot();
    const run = buildRunState("run-stale", "running", { response: undefined });
    await writePersistedRun(stateRoot, run);

    const reconciled = await reconcilePersistedRunState(
      { ...run, statePath: join(stateRoot, run.runId, "state.json") },
      { nowMs: Date.now() + 2 * 24 * 60 * 60 * 1000 },
    );

    expect(reconciled.status).toBe("failed");
    expect(reconciled.response?.warnings?.[0]).toContain("Persisted background run state is stale");
  });

  it("renders actionable alerts for terminal monitor states", () => {
    const run = buildRunState("run-2", "blocked", {
      artifactPath: "workflows/generated/release.ts",
      artifactDir: "/tmp/run-2",
      response: {
        ok: false,
        artifacts: [],
        logs: [],
        warnings: ["agent-relay missing"],
        nextActions: [],
        exitCode: 1,
      },
    });

    expect(shouldNotifyRunState(run)).toBe(true);
    expect(renderRunMonitorAlert(run, "/repo")).toContain("Ricky monitor: background workflow needs attention.");
    expect(renderRunMonitorAlert(run, "/repo")).toContain("ricky status --run run-2");
  });

  it("renders a completion alert for completed runs", () => {
    const execution = {
      execution: { command: "ricky run workflows/generated/done.ts" },
      evidence: { outcome_summary: "all checks green" },
    } as unknown as LocalExecutionStageResult;
    const run = buildRunState("run-3", "completed", {
      response: {
        ok: true,
        artifacts: [],
        logs: ["done"],
        warnings: [],
        nextActions: [],
        exitCode: 0,
        execution,
      },
    });

    expect(shouldNotifyRunState(run)).toBe(true);
    const rendered = renderRunMonitorAlert(run, "/repo");
    expect(rendered).toContain("Ricky monitor: background workflow completed.");
    expect(rendered).toContain("Outcome: all checks green");
    expect(rendered).toContain("Command: ricky run workflows/generated/done.ts");
  });
});
