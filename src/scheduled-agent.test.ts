import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import {
  listPersistedRunStates,
  renderRunMonitorAlert,
  shouldNotifyRunState,
} from "./scheduled-agent.js";
import type { LocalRunMonitorState } from "./surfaces/cli/flows/local-run-monitor.js";

describe("ricky scheduled agent helpers", () => {
  let stateRoot: string | undefined;

  afterEach(async () => {
    if (stateRoot) {
      await import("node:fs/promises").then(({ rm }) => rm(stateRoot!, { recursive: true, force: true }));
      stateRoot = undefined;
    }
  });

  it("loads persisted background run state from disk", async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "ricky-agent-state-"));
    const runDir = join(stateRoot, "run-1");
    await mkdir(runDir, { recursive: true });
    await writeFile(
      join(runDir, "state.json"),
      JSON.stringify({
        runId: "run-1",
        status: "failed",
        artifactPath: "workflows/generated/checks.ts",
        artifactDir: runDir,
        statePath: join(runDir, "state.json"),
        logPath: join(runDir, "run.log"),
        evidencePath: join(runDir, "evidence.json"),
        fixesPath: join(runDir, "fixes.json"),
        reattachCommand: "ricky status --run run-1",
        response: {
          ok: false,
          artifacts: [],
          logs: ["failed"],
          warnings: ["failed"],
          nextActions: [],
          exitCode: 1,
        },
      } satisfies LocalRunMonitorState),
      "utf8",
    );

    const runs = await listPersistedRunStates(stateRoot);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.runId).toBe("run-1");
  });

  it("renders actionable alerts for terminal monitor states", () => {
    const run = {
      runId: "run-2",
      status: "blocked",
      artifactPath: "workflows/generated/release.ts",
      artifactDir: "/tmp/run-2",
      statePath: "/tmp/run-2/state.json",
      logPath: "/tmp/run-2/run.log",
      evidencePath: "/tmp/run-2/evidence.json",
      fixesPath: "/tmp/run-2/fixes.json",
      reattachCommand: "ricky status --run run-2",
      response: {
        ok: false,
        artifacts: [],
        logs: [],
        warnings: ["agent-relay missing"],
        nextActions: [],
        exitCode: 1,
      },
    } satisfies LocalRunMonitorState;

    expect(shouldNotifyRunState(run)).toBe(true);
    expect(renderRunMonitorAlert(run, "/repo")).toContain("Ricky monitor: background workflow needs attention.");
    expect(renderRunMonitorAlert(run, "/repo")).toContain("ricky status --run run-2");
  });
});
