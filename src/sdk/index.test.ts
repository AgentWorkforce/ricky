import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createRickySdk, runRickyCli } from './index.js';
import type { LocalResponse } from '../local/index.js';
import type { CloudGenerateResponse } from '../cloud/api/index.js';

function okLocalResponse(overrides: Partial<LocalResponse> = {}): LocalResponse {
  return {
    ok: true,
    artifacts: [{ path: 'workflows/generated/release-health.ts', type: 'text/typescript' }],
    logs: [],
    warnings: [],
    nextActions: [],
    exitCode: 0,
    ...overrides,
  };
}

describe('Ricky SDK', () => {
  it('generates local workflows through the local entrypoint without shelling through the CLI', async () => {
    const runLocal = vi.fn().mockResolvedValue(okLocalResponse());
    const sdk = createRickySdk({ cwd: '/repo', runLocal });

    const result = await sdk.generateLocalWorkflow({
      spec: 'build a package health workflow',
      workflowName: 'release-health',
      bestJudgement: true,
    });

    expect(result.ok).toBe(true);
    expect(runLocal).toHaveBeenCalledWith(
      {
        source: 'cli',
        spec: {
          intent: 'generate',
          description: 'build a package health workflow',
          workflowName: 'release-health',
          name: 'release-health',
          artifactPath: 'workflows/generated/release-health.ts',
        },
        invocationRoot: '/repo',
        mode: 'local',
        stageMode: 'generate',
        bestJudgement: true,
        cliMetadata: {
          handoff: 'sdk',
          workflowName: 'release-health',
          bestJudgement: true,
        },
      },
      {},
    );
  });

  it('runs existing workflow artifacts locally with retry and auto-fix metadata', async () => {
    const runLocal = vi.fn().mockResolvedValue(okLocalResponse());
    const sdk = createRickySdk({ cwd: '/repo', runLocal });

    await sdk.runLocalWorkflow({
      workflowPath: 'workflows/generated/release-health.ts',
      autoFixAttempts: 3,
      startFromStep: 'review',
      previousRunId: 'relay-run-123',
    });

    expect(runLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'workflow-artifact',
        artifactPath: 'workflows/generated/release-health.ts',
        invocationRoot: '/repo',
        mode: 'local',
        stageMode: 'run',
        autoFix: { maxAttempts: 3 },
        retry: {
          attempt: 1,
          reason: 'manual resume requested from Ricky SDK',
          startFromStep: 'review',
          previousRunId: 'relay-run-123',
          retryOfRunId: 'relay-run-123',
        },
      }),
      {},
    );
  });

  it('delegates Cloud generation through the Cloud API handler contract', async () => {
    const response: CloudGenerateResponse = {
      ok: true,
      status: 200,
      artifacts: [],
      artifactBundle: {
        artifacts: [],
        generationMode: 'generate-and-return-artifacts',
        targetMode: 'cloud',
      },
      warnings: [],
      assumptions: [],
      validation: { ok: true, status: 'passed', issues: [] },
      runReceipt: {
        executionRequested: false,
        requestId: 'req-sdk',
        status: 'not_requested',
      },
      followUpActions: [],
      requestId: 'req-sdk',
    };
    const handleCloudGenerate = vi.fn().mockResolvedValue(response);
    const sdk = createRickySdk({ handleCloudGenerate });

    const result = await sdk.generateCloudWorkflow({
      auth: { token: 'token' },
      workspace: { workspaceId: 'workspace-1' },
      body: { spec: 'build a Cloud workflow', mode: 'cloud' },
    });

    expect(result).toBe(response);
    expect(handleCloudGenerate).toHaveBeenCalledWith({
      auth: { token: 'token' },
      workspace: { workspaceId: 'workspace-1' },
      body: { spec: 'build a Cloud workflow', mode: 'cloud' },
    }, {});
  });

  it('exposes the CLI as an SDK call so the bin can stay thin', async () => {
    const runCli = vi.fn().mockResolvedValue({ exitCode: 0, output: ['ricky 1.2.3'] });
    const sdk = createRickySdk({ runCli });

    await expect(sdk.runCli({ argv: ['version'], version: '1.2.3' })).resolves.toEqual({
      exitCode: 0,
      output: ['ricky 1.2.3'],
    });
    await expect(runRickyCli({ argv: ['version'], version: '1.2.3', runCli })).resolves.toEqual({
      exitCode: 0,
      output: ['ricky 1.2.3'],
    });
  });

  it('keeps the published bin routed through the SDK instead of importing cli-main directly', () => {
    const binPath = fileURLToPath(new URL('../surfaces/cli/bin/ricky.ts', import.meta.url));
    const source = readFileSync(binPath, 'utf8');

    expect(source).toContain("from '../../../sdk/index.js'");
    expect(source).not.toContain("../commands/cli-main.js");
  });
});
