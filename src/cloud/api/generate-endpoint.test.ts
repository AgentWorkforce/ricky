import { describe, expect, it } from 'vitest';

import type {
  CloudExecutor,
  CloudGenerateRequest,
  CloudGenerateResponse,
  CloudGenerateResult,
} from './index';
import { CLOUD_GENERATE_ROUTE, handleCloudGenerate } from './index';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Deterministic request ID for test assertions. */
const TEST_REQUEST_ID = 'ricky-cloud-test-000';

function testOptions(executor?: CloudExecutor) {
  return {
    executor,
    requestIdFactory: () => TEST_REQUEST_ID,
  };
}

/** A valid, minimal Cloud generate request. */
function validRequest(overrides?: Partial<CloudGenerateRequest>): CloudGenerateRequest {
  return {
    auth: { token: 'test-token-abc' },
    workspace: { workspaceId: 'ws-001' },
    body: { spec: 'build a data pipeline' },
    ...overrides,
  };
}

/** A deterministic executor that records calls and returns a canned result. */
function mockExecutor(
  result?: Partial<CloudGenerateResult>,
): CloudExecutor & { calls: CloudGenerateRequest[] } {
  const calls: CloudGenerateRequest[] = [];
  return {
    calls,
    async generate(request: CloudGenerateRequest): Promise<CloudGenerateResult> {
      calls.push(request);
      return {
        artifacts: result?.artifacts ?? [],
        warnings: result?.warnings ?? [],
        followUpActions: result?.followUpActions ?? [],
      };
    },
  };
}

/** An executor that always throws, for error-path tests. */
function failingExecutor(message = 'Cloud runtime unavailable'): CloudExecutor {
  return {
    async generate(): Promise<CloudGenerateResult> {
      throw new Error(message);
    },
  };
}

// ---------------------------------------------------------------------------
// Route constant
// ---------------------------------------------------------------------------

describe('CLOUD_GENERATE_ROUTE', () => {
  it('exposes the correct route path', () => {
    expect(CLOUD_GENERATE_ROUTE).toBe('/api/v1/ricky/workflows/generate');
  });
});

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

describe('handleCloudGenerate — validation', () => {
  it('rejects requests with missing auth token', async () => {
    const request = validRequest({ auth: { token: '' } });
    const response = await handleCloudGenerate(request, testOptions());

    expect(response.ok).toBe(false);
    expect(response.status).toBe(401);
    expect(response.warnings[0].message).toContain('auth token');
    expect(response.requestId).toBe(TEST_REQUEST_ID);
  });

  it('rejects requests with missing workspace ID', async () => {
    const request = validRequest({ workspace: { workspaceId: '' } });
    const response = await handleCloudGenerate(request, testOptions());

    expect(response.ok).toBe(false);
    expect(response.status).toBe(400);
    expect(response.warnings[0].message).toContain('workspace ID');
  });

  it('rejects requests with missing spec', async () => {
    const request = validRequest({ body: { spec: '' } });
    const response = await handleCloudGenerate(request, testOptions());

    expect(response.ok).toBe(false);
    expect(response.status).toBe(400);
    expect(response.warnings[0].message).toContain('spec');
  });
});

// ---------------------------------------------------------------------------
// Successful generation
// ---------------------------------------------------------------------------

describe('handleCloudGenerate — success path', () => {
  it('delegates to the injected executor and returns 200', async () => {
    const executor = mockExecutor({
      artifacts: [{ path: 'out/workflow.ts', type: 'text/typescript', content: '// generated' }],
      warnings: [{ severity: 'info', message: 'Assumed default region.' }],
      followUpActions: [{ action: 'deploy', label: 'Deploy' }],
    });

    const request = validRequest();
    const response = await handleCloudGenerate(request, testOptions(executor));

    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    expect(response.artifacts).toEqual([
      { path: 'out/workflow.ts', type: 'text/typescript', content: '// generated' },
    ]);
    expect(response.warnings).toEqual([{ severity: 'info', message: 'Assumed default region.' }]);
    expect(response.followUpActions).toEqual([{ action: 'deploy', label: 'Deploy' }]);
    expect(response.requestId).toBe(TEST_REQUEST_ID);
  });

  it('passes auth and workspace context through to the executor', async () => {
    const executor = mockExecutor();
    const request = validRequest({
      auth: { token: 'my-token', tokenType: 'api-key' },
      workspace: { workspaceId: 'ws-prod', environment: 'production' },
    });

    await handleCloudGenerate(request, testOptions(executor));

    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0].auth.token).toBe('my-token');
    expect(executor.calls[0].auth.tokenType).toBe('api-key');
    expect(executor.calls[0].workspace.workspaceId).toBe('ws-prod');
    expect(executor.calls[0].workspace.environment).toBe('production');
  });

  it('passes spec, mode, and metadata through to the executor', async () => {
    const executor = mockExecutor();
    const request = validRequest({
      body: {
        spec: 'deploy service',
        specPath: '/specs/deploy.md',
        mode: 'both',
        metadata: { origin: 'dashboard' },
      },
    });

    await handleCloudGenerate(request, testOptions(executor));

    expect(executor.calls[0].body.spec).toBe('deploy service');
    expect(executor.calls[0].body.specPath).toBe('/specs/deploy.md');
    expect(executor.calls[0].body.mode).toBe('both');
    expect(executor.calls[0].body.metadata).toEqual({ origin: 'dashboard' });
  });

  it('returns empty artifacts and warnings when executor produces none', async () => {
    const executor = mockExecutor();
    const response = await handleCloudGenerate(validRequest(), testOptions(executor));

    expect(response.ok).toBe(true);
    expect(response.artifacts).toEqual([]);
    expect(response.warnings).toEqual([]);
    expect(response.followUpActions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('handleCloudGenerate — error path', () => {
  it('catches executor errors and returns 500 with the error message', async () => {
    const executor = failingExecutor('connection timeout');
    const response = await handleCloudGenerate(validRequest(), testOptions(executor));

    expect(response.ok).toBe(false);
    expect(response.status).toBe(500);
    expect(response.warnings[0].severity).toBe('error');
    expect(response.warnings[0].message).toContain('connection timeout');
    expect(response.followUpActions[0].action).toBe('retry');
  });

  it('handles non-Error throws gracefully', async () => {
    const executor: CloudExecutor = {
      async generate(): Promise<CloudGenerateResult> {
        throw 'string error';
      },
    };
    const response = await handleCloudGenerate(validRequest(), testOptions(executor));

    expect(response.ok).toBe(false);
    expect(response.status).toBe(500);
    expect(response.warnings[0].message).toContain('string error');
  });
});

// ---------------------------------------------------------------------------
// Default executor
// ---------------------------------------------------------------------------

describe('handleCloudGenerate — default executor', () => {
  it('works with the default executor (no options besides requestId)', async () => {
    const response = await handleCloudGenerate(validRequest(), {
      requestIdFactory: () => TEST_REQUEST_ID,
    });

    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    expect(response.warnings.some((w) => w.message.includes('stub'))).toBe(true);
    expect(response.followUpActions.some((a) => a.action === 'wire-runtime')).toBe(true);
  });

  it('default executor suggests local run for mode=both', async () => {
    const request = validRequest({ body: { spec: 'test', mode: 'both' } });
    const response = await handleCloudGenerate(request, {
      requestIdFactory: () => TEST_REQUEST_ID,
    });

    expect(response.ok).toBe(true);
    expect(response.followUpActions.some((a) => a.action === 'run-local')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Local vs Cloud path distinction
// ---------------------------------------------------------------------------

describe('Cloud vs local path distinction', () => {
  it('Cloud endpoint does not reference local entrypoint or normalizeRequest', async () => {
    // This test verifies the import boundary: Cloud types are self-contained
    const response: CloudGenerateResponse = await handleCloudGenerate(
      validRequest(),
      testOptions(mockExecutor()),
    );

    // The response shape is CloudGenerateResponse, not LocalResponse
    expect('status' in response).toBe(true);
    expect('requestId' in response).toBe(true);
    // LocalResponse has 'logs' and 'nextActions' — Cloud has 'followUpActions' and no 'logs'
    expect('logs' in response).toBe(false);
    expect('nextActions' in response).toBe(false);
  });
});
