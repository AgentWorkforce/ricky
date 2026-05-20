import { describe, expect, it, vi } from 'vitest';

import type {
  CloudExecutor,
  CloudGenerateEndpointContract,
  CloudGenerateEndpointOptions,
  CloudGenerateRequest,
  CloudGenerateResponse,
  CloudGenerateResult,
} from './index.js';
import {
  CLOUD_GENERATE_METHOD,
  CLOUD_GENERATE_ROUTE,
  cloudGenerateEndpoint,
  handleCloudGenerate,
} from './index.js';
import type { AuthorizedWorkspaceScope } from '../auth/types.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Deterministic request ID for test assertions. */
const TEST_REQUEST_ID = 'ricky-cloud-test-000';

const DEFAULT_TEST_ARTIFACT = {
  path: 'out/workflow.ts',
  type: 'text/typescript',
  content: '// generated',
};

function testOptions(
  executor?: CloudExecutor,
  authorizedWorkspaceScope: AuthorizedWorkspaceScope = { workspaceId: 'ws-001' },
): CloudGenerateEndpointOptions {
  return {
    executor,
    authorizedWorkspaceScope,
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
  const artifacts = Object.prototype.hasOwnProperty.call(result ?? {}, 'artifacts')
    ? result?.artifacts ?? []
    : [DEFAULT_TEST_ARTIFACT];
  const validation: CloudGenerateResult['validation'] =
    Object.prototype.hasOwnProperty.call(result ?? {}, 'validation')
      ? result?.validation
      : { ok: true, status: 'passed', issues: [] };
  return {
    calls,
    async generate(request: CloudGenerateRequest): Promise<CloudGenerateResult> {
      calls.push(request);
      return {
        artifacts,
        warnings: result?.warnings ?? [],
        assumptions: result?.assumptions,
        validation,
        runReceipt: result?.runReceipt,
        generationMetadata: result?.generationMetadata,
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
    expect(CLOUD_GENERATE_ROUTE.startsWith('/api/v1/ricky/')).toBe(true);
    expect(CLOUD_GENERATE_ROUTE.includes('/workflows/')).toBe(true);
    expect(CLOUD_GENERATE_ROUTE.split('/').filter(Boolean)).toEqual([
      'api',
      'v1',
      'ricky',
      'workflows',
      'generate',
    ]);
    expect(CLOUD_GENERATE_ROUTE.endsWith('/workflows/generate')).toBe(true);
  });

  it('exposes the POST method for transport mounting', () => {
    expect(CLOUD_GENERATE_METHOD).toBe('POST');
    expect(`${CLOUD_GENERATE_METHOD} ${CLOUD_GENERATE_ROUTE}`).toBe(
      'POST /api/v1/ricky/workflows/generate',
    );
  });

  it('exports a mountable endpoint contract object', async () => {
    const endpoint: CloudGenerateEndpointContract = cloudGenerateEndpoint;

    expect(endpoint).toMatchObject({
      method: 'POST',
      path: '/api/v1/ricky/workflows/generate',
    });
    expect(endpoint.path).toBe(CLOUD_GENERATE_ROUTE);
    expect(`${endpoint.method} ${endpoint.path}`).toBe(
      'POST /api/v1/ricky/workflows/generate',
    );
    expect(endpoint.handler).toBe(handleCloudGenerate);

    const response = await endpoint.handler(validRequest(), testOptions(mockExecutor()));

    expect(response.ok).toBe(true);
    expect(response.artifactBundle.targetMode).toBe('cloud');
    expect(response.artifactBundle.artifacts).toBe(response.artifacts);
  });

  it('serves successful Cloud generation responses through the exported endpoint contract', async () => {
    const endpoint: CloudGenerateEndpointContract = cloudGenerateEndpoint;
    const artifact = {
      path: 'workflows/mounted-cloud-generate.ts',
      type: 'text/typescript',
      content: 'export const workflow = "mounted-cloud-generate";',
    };
    const executor = mockExecutor({
      artifacts: [artifact],
      warnings: [{ severity: 'warning', message: 'Assumed the default Cloud queue.' }],
      assumptions: [{ key: 'queue', message: 'Used the workspace default queue.' }],
      followUpActions: [
        {
          action: 'review-generated-files',
          label: 'Review Generated Files',
          description: 'Inspect returned workflow artifacts before deployment.',
        },
      ],
    });

    const response = await endpoint.handler(validRequest(), testOptions(executor));

    expect(`${endpoint.method} ${endpoint.path}`).toBe(
      'POST /api/v1/ricky/workflows/generate',
    );
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    expect(response.artifacts).toEqual([artifact]);
    expect(response.artifactBundle).toEqual({
      artifacts: response.artifacts,
      generationMode: 'generate-and-return-artifacts',
      targetMode: 'cloud',
    });
    expect(response.artifactBundle.artifacts[0]).toMatchObject({
      path: 'workflows/mounted-cloud-generate.ts',
      type: 'text/typescript',
      content: expect.stringContaining('mounted-cloud-generate'),
    });
    expect(response.warnings).toEqual([
      { severity: 'warning', message: 'Assumed the default Cloud queue.' },
    ]);
    expect(response.assumptions).toEqual([
      { key: 'queue', message: 'Used the workspace default queue.' },
    ]);
    expect(response.followUpActions).toEqual([
      {
        action: 'review-generated-files',
        label: 'Review Generated Files',
        description: 'Inspect returned workflow artifacts before deployment.',
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

describe('handleCloudGenerate — validation', () => {
  it('rejects requests with missing authentication context', async () => {
    const executor = mockExecutor();
    const request = {
      workspace: { workspaceId: 'ws-001' },
      body: { spec: 'build a data pipeline' },
    } as CloudGenerateRequest;

    const response = await handleCloudGenerate(request, testOptions(executor));

    expect(response.ok).toBe(false);
    expect(response.status).toBe(401);
    expect(response.warnings[0].message).toContain('auth token');
    expect(response.validation.issues[0]).toEqual({
      code: 'missing-auth-token',
      message: 'Missing or empty auth token.',
      path: 'auth.token',
    });
    expect(executor.calls).toHaveLength(0);
  });

  it('rejects requests with missing auth token', async () => {
    const request = validRequest({ auth: { token: '' } });
    const response = await handleCloudGenerate(request, testOptions());

    expect(response.ok).toBe(false);
    expect(response.status).toBe(401);
    expect(response.warnings[0].message).toContain('auth token');
    expect(response.validation).toEqual({
      ok: false,
      status: 'failed',
      issues: [
        {
          code: 'missing-auth-token',
          message: 'Missing or empty auth token.',
          path: 'auth.token',
        },
      ],
    });
    expect(response.error).toEqual({
      code: 'MISSING_AUTH_TOKEN',
      message: 'Missing or empty auth token.',
      path: 'auth.token',
    });
    expect(response.requestId).toBe(TEST_REQUEST_ID);
  });

  it('rejects requests with missing workspace context', async () => {
    const executor = mockExecutor();
    const request = {
      auth: { token: 'test-token-abc' },
      body: { spec: 'build a data pipeline' },
    } as CloudGenerateRequest;

    const response = await handleCloudGenerate(request, testOptions(executor));

    expect(response.ok).toBe(false);
    expect(response.status).toBe(400);
    expect(response.warnings[0].message).toContain('workspace ID');
    expect(response.validation.issues[0]).toEqual({
      code: 'missing-workspace-id',
      message: 'Missing or empty workspace ID.',
      path: 'workspace.workspaceId',
    });
    expect(executor.calls).toHaveLength(0);
  });

  it('rejects requests with missing workspace ID', async () => {
    const request = validRequest({ workspace: { workspaceId: '' } });
    const response = await handleCloudGenerate(request, testOptions());

    expect(response.ok).toBe(false);
    expect(response.status).toBe(400);
    expect(response.warnings[0].message).toContain('workspace ID');
    expect(response.validation.issues[0].code).toBe('missing-workspace-id');
  });

  it('rejects requests with missing spec', async () => {
    const request = validRequest({ body: { spec: '' } });
    const response = await handleCloudGenerate(request, testOptions());

    expect(response.ok).toBe(false);
    expect(response.status).toBe(400);
    expect(response.warnings[0].message).toContain('spec');
    expect(response.validation.issues[0].code).toBe('missing-spec');
  });

  it('returns the Cloud generate failure contract when the request body omits the spec', async () => {
    const executor = mockExecutor();
    const response = await handleCloudGenerate(
      validRequest({ body: { spec: '   ' } }),
      testOptions(executor),
    );

    expect(`${CLOUD_GENERATE_METHOD} ${CLOUD_GENERATE_ROUTE}`).toBe(
      'POST /api/v1/ricky/workflows/generate',
    );
    expect(response.ok).toBe(false);
    expect(response.status).toBe(400);
    expect(response.artifacts).toEqual([]);
    expect(response.artifactBundle).toEqual({
      artifacts: [],
      generationMode: 'generate-and-return-artifacts',
      targetMode: 'cloud',
    });
    expect(response.warnings).toEqual([
      { severity: 'error', message: 'Missing or empty spec in request body.' },
    ]);
    expect(response.assumptions).toEqual([]);
    expect(response.followUpActions).toEqual([]);
    expect(response.validation).toEqual({
      ok: false,
      status: 'failed',
      issues: [
        {
          code: 'missing-spec',
          message: 'Missing or empty spec in request body.',
          path: 'body.spec',
        },
      ],
    });
    expect(executor.calls).toHaveLength(0);
  });

  it('rejects requests with empty structured spec payloads', async () => {
    const request = validRequest({ body: { spec: { kind: 'structured', document: {} } } });
    const response = await handleCloudGenerate(request, testOptions());

    expect(response.ok).toBe(false);
    expect(response.status).toBe(400);
    expect(response.validation.issues[0].path).toBe('body.spec');
  });

  it('rejects requests when no authorized workspace scope is supplied', async () => {
    const executor = mockExecutor();
    const response = await handleCloudGenerate(validRequest(), {
      executor,
      requestIdFactory: () => TEST_REQUEST_ID,
    });

    expect(response.ok).toBe(false);
    expect(response.status).toBe(403);
    expect(response.validation).toEqual({
      ok: false,
      status: 'failed',
      issues: [
        {
          code: 'missing-authorized-workspace-scope',
          message: 'Missing authorized workspace scope.',
          path: 'workspace.workspaceId',
        },
      ],
    });
    expect(executor.calls).toHaveLength(0);
  });

  it('rejects cross-workspace requests before executor invocation', async () => {
    const executor = mockExecutor();
    const response = await handleCloudGenerate(
      validRequest({ workspace: { workspaceId: 'ws-other' } }),
      testOptions(executor, { workspaceId: 'ws-001' }),
    );

    expect(response.ok).toBe(false);
    expect(response.status).toBe(403);
    expect(response.validation.issues[0]).toEqual({
      code: 'cross-workspace-access',
      message: 'Cross-workspace access denied.',
      path: 'workspace.workspaceId',
    });
    expect(executor.calls).toHaveLength(0);
  });

  it('rejects cross-project requests before executor invocation', async () => {
    const executor = mockExecutor();
    const response = await handleCloudGenerate(
      validRequest({ workspace: { workspaceId: 'ws-001', projectId: 'proj-other' } }),
      testOptions(executor, { workspaceId: 'ws-001', projectId: 'proj-allowed' }),
    );

    expect(response.ok).toBe(false);
    expect(response.status).toBe(403);
    expect(response.validation.issues[0]).toEqual({
      code: 'cross-project-access',
      message: 'Cross-project access denied.',
      path: 'workspace.projectId',
    });
    expect(executor.calls).toHaveLength(0);
  });

  it('rejects cross-environment requests before executor invocation', async () => {
    const executor = mockExecutor();
    const response = await handleCloudGenerate(
      validRequest({ workspace: { workspaceId: 'ws-001', environment: 'staging' } }),
      testOptions(executor, { workspaceId: 'ws-001', environment: 'production' }),
    );

    expect(response.ok).toBe(false);
    expect(response.status).toBe(403);
    expect(response.validation.issues[0]).toEqual({
      code: 'cross-environment-access',
      message: 'Cross-environment access denied.',
      path: 'workspace.environment',
    });
    expect(executor.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Successful generation
// ---------------------------------------------------------------------------

describe('handleCloudGenerate — success path', () => {
  it('satisfies the Cloud route contract without network or live runtime access', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network disabled'));
    const executor = mockExecutor({
      artifacts: [
        {
          path: 'workflows/cloud-contract-workflow.ts',
          type: 'text/typescript',
          content: 'export const workflow = "cloud-contract";',
        },
      ],
      warnings: [{ severity: 'warning', message: 'Assumed default validation policy.' }],
      assumptions: [{ key: 'trigger', message: 'Used manual trigger by default.' }],
      followUpActions: [
        {
          action: 'review-generated-files',
          label: 'Review Generated Files',
          description: 'Review the returned artifact bundle before deployment.',
        },
      ],
    });

    try {
      const response = await handleCloudGenerate(
        validRequest({
          body: {
            spec: 'generate a workflow from the Cloud API',
            generationMode: 'generate-and-return-artifacts',
          },
        }),
        testOptions(executor),
      );

      expect(`${CLOUD_GENERATE_METHOD} ${CLOUD_GENERATE_ROUTE}`).toBe(
        'POST /api/v1/ricky/workflows/generate',
      );
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      expect(response.artifactBundle).toEqual({
        artifacts: response.artifacts,
        generationMode: 'generate-and-return-artifacts',
        targetMode: 'cloud',
      });
      expect(response.artifactBundle.artifacts[0]).toMatchObject({
        path: 'workflows/cloud-contract-workflow.ts',
        type: 'text/typescript',
        content: expect.stringContaining('cloud-contract'),
      });
      expect(response.warnings[0]).toEqual({
        severity: 'warning',
        message: 'Assumed default validation policy.',
      });
      expect(response.assumptions[0]).toEqual({
        key: 'trigger',
        message: 'Used manual trigger by default.',
      });
      expect(response.followUpActions[0]).toMatchObject({
        action: 'review-generated-files',
        label: 'Review Generated Files',
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(executor.calls).toHaveLength(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('returns the POST route response contract for Cloud generation callers', async () => {
    const artifact = {
      path: 'workflows/route-contract.ts',
      type: 'text/typescript',
      content: 'export const workflow = "route-contract";',
    };
    const executor = mockExecutor({
      artifacts: [artifact],
      warnings: [{ severity: 'warning', message: 'Spec omitted schedule details.' }],
      assumptions: [{ key: 'schedule', message: 'Used manual trigger by default.' }],
      followUpActions: [
        {
          action: 'review-generated-files',
          label: 'Review Generated Files',
          description: 'Inspect generated workflow artifacts before enabling Cloud execution.',
        },
      ],
    });

    const response = await handleCloudGenerate(
      validRequest({
        body: {
          spec: 'generate the endpoint route contract workflow',
          mode: 'both',
          generationMode: 'generate-and-return-artifacts',
        },
      }),
      testOptions(executor),
    );

    expect(`${CLOUD_GENERATE_METHOD} ${CLOUD_GENERATE_ROUTE}`).toBe(
      'POST /api/v1/ricky/workflows/generate',
    );
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    expect(response.artifacts).toEqual([artifact]);
    expect(response.artifacts[0]).toMatchObject({
      path: 'workflows/route-contract.ts',
      type: 'text/typescript',
      content: expect.stringContaining('route-contract'),
    });
    expect(response.artifactBundle).toEqual({
      artifacts: response.artifacts,
      generationMode: 'generate-and-return-artifacts',
      targetMode: 'both',
    });
    expect(response.artifactBundle.artifacts[0]).toMatchObject({
      path: expect.stringContaining('route-contract.ts'),
      type: 'text/typescript',
    });
    expect(response.warnings).toEqual([
      { severity: 'warning', message: 'Spec omitted schedule details.' },
    ]);
    expect(response.assumptions).toEqual([
      { key: 'schedule', message: 'Used manual trigger by default.' },
    ]);
    expect(response.followUpActions).toEqual([
      {
        action: 'review-generated-files',
        label: 'Review Generated Files',
        description: 'Inspect generated workflow artifacts before enabling Cloud execution.',
      },
    ]);
    expect(response.validation).toEqual({ ok: true, status: 'passed', issues: [] });
    expect(response.requestId).toBe(TEST_REQUEST_ID);
  });

  it('delegates to the injected executor and returns 200', async () => {
    const executor = mockExecutor({
      artifacts: [{ path: 'out/workflow.ts', type: 'text/typescript', content: '// generated' }],
      warnings: [{ severity: 'info', message: 'Assumed default region.' }],
      assumptions: [{ key: 'default-region', message: 'Used the workspace default region.' }],
      followUpActions: [{ action: 'deploy', label: 'Deploy' }],
    });

    const request = validRequest();
    const response = await handleCloudGenerate(request, testOptions(executor));

    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    expect(response.artifacts).toEqual([
      { path: 'out/workflow.ts', type: 'text/typescript', content: '// generated' },
    ]);
    expect(response.artifacts[0]).toMatchObject({
      path: expect.stringMatching(/\.ts$/),
      type: 'text/typescript',
      content: expect.stringContaining('generated'),
    });
    expect(response.warnings).toEqual([{ severity: 'info', message: 'Assumed default region.' }]);
    expect(response.assumptions).toEqual([
      { key: 'default-region', message: 'Used the workspace default region.' },
    ]);
    expect(response.validation).toEqual({ ok: true, status: 'passed', issues: [] });
    expect(response.runReceipt).toEqual({
      executionRequested: false,
      requestId: TEST_REQUEST_ID,
      status: 'not_requested',
    });
    expect(response.artifactBundle).toEqual({
      artifacts: [
        { path: 'out/workflow.ts', type: 'text/typescript', content: '// generated' },
      ],
      generationMode: 'generate-and-return-artifacts',
      targetMode: 'cloud',
    });
    expect(response.followUpActions).toEqual([{ action: 'deploy', label: 'Deploy' }]);
    expect(response.requestId).toBe(TEST_REQUEST_ID);
  });

  it('passes auth and workspace context through to the executor', async () => {
    const executor = mockExecutor();
    const request = validRequest({
      auth: { token: 'my-token', tokenType: 'api-key' },
      workspace: { workspaceId: 'ws-prod', projectId: 'proj-001', environment: 'production' },
    });

    await handleCloudGenerate(
      request,
      testOptions(executor, {
        workspaceId: 'ws-prod',
        projectId: 'proj-001',
        environment: 'production',
      }),
    );

    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0].auth.token).toBe('my-token');
    expect(executor.calls[0].auth.tokenType).toBe('api-key');
    expect(executor.calls[0].workspace.workspaceId).toBe('ws-prod');
    expect(executor.calls[0].workspace.projectId).toBe('proj-001');
    expect(executor.calls[0].workspace.environment).toBe('production');
  });

  it('passes only the resolved authorized workspace scope to the executor', async () => {
    const executor = mockExecutor();
    const request = validRequest({
      workspace: { workspaceId: 'ws-prod' },
    });

    await handleCloudGenerate(
      request,
      testOptions(executor, {
        workspaceId: 'ws-prod',
        projectId: 'proj-authorized',
        environment: 'production',
      }),
    );

    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0].workspace).toEqual({
      workspaceId: 'ws-prod',
      projectId: 'proj-authorized',
      environment: 'production',
    });
  });

  it('passes spec, mode, and metadata through to the executor', async () => {
    const executor = mockExecutor();
    const request = validRequest({
      body: {
        spec: 'deploy service',
        specPath: '/specs/deploy.md',
        mode: 'both',
        generationMode: 'generate-and-return-artifacts',
        metadata: { origin: 'dashboard' },
      },
    });

    await handleCloudGenerate(request, testOptions(executor));

    expect(executor.calls[0].body.spec).toBe('deploy service');
    expect(executor.calls[0].body.specPath).toBe('/specs/deploy.md');
    expect(executor.calls[0].body.mode).toBe('both');
    expect(executor.calls[0].body.generationMode).toBe('generate-and-return-artifacts');
    expect(executor.calls[0].body.metadata).toEqual({ origin: 'dashboard' });
  });

  it('passes structured spec payloads through to the executor', async () => {
    const executor = mockExecutor();
    const request = validRequest({
      body: {
        spec: {
          kind: 'structured',
          format: 'ricky-workflow',
          document: { name: 'deploy-service', steps: [{ name: 'build' }] },
        },
        mode: 'cloud',
      },
    });

    await handleCloudGenerate(request, testOptions(executor));

    expect(executor.calls[0].body.spec).toEqual({
      kind: 'structured',
      format: 'ricky-workflow',
      document: { name: 'deploy-service', steps: [{ name: 'build' }] },
    });
    expect(executor.calls[0].body.mode).toBe('cloud');
  });

  it('preserves structured JSON spec payloads for Cloud generation', async () => {
    const executor = mockExecutor();
    const structuredSpec = {
      name: 'json-spec-workflow',
      steps: [{ name: 'generate', gate: 'tsc --noEmit' }],
    };
    const request = validRequest({
      body: {
        spec: {
          kind: 'structured',
          format: 'json',
          document: structuredSpec,
        },
      },
    });

    await handleCloudGenerate(request, testOptions(executor));

    expect(executor.calls[0].body.spec).toEqual({
      kind: 'structured',
      format: 'json',
      document: structuredSpec,
    });
  });

  it('accepts natural-language spec payloads and preserves Cloud response evidence', async () => {
    const artifact = {
      path: 'workflows/natural-language-workflow.ts',
      type: 'text/typescript',
      content: 'export const workflow = "natural-language";',
    };
    const executor = mockExecutor({
      artifacts: [artifact],
      warnings: [{ severity: 'info', message: 'Assumed default Cloud queue.' }],
      assumptions: [
        { key: 'trigger', message: 'Used manual trigger because no schedule was specified.' },
      ],
      followUpActions: [
        {
          action: 'review-generated-files',
          label: 'Review Generated Files',
          description: 'Review the returned workflow artifact before enabling execution.',
        },
      ],
    });
    const request = validRequest({
      body: {
        spec: { kind: 'natural-language', text: 'Generate a workflow from this prompt.' },
        generationMode: 'generate-and-return-artifacts',
      },
    });

    const response = await handleCloudGenerate(request, testOptions(executor));

    expect(`${CLOUD_GENERATE_METHOD} ${CLOUD_GENERATE_ROUTE}`).toBe(
      'POST /api/v1/ricky/workflows/generate',
    );
    expect(executor.calls[0].body.spec).toEqual({
      kind: 'natural-language',
      text: 'Generate a workflow from this prompt.',
    });
    expect(response.ok).toBe(true);
    expect(response.artifactBundle).toEqual({
      artifacts: [artifact],
      generationMode: 'generate-and-return-artifacts',
      targetMode: 'cloud',
    });
    expect(response.artifactBundle.artifacts[0]).toMatchObject({
      path: 'workflows/natural-language-workflow.ts',
      type: 'text/typescript',
      content: expect.stringContaining('natural-language'),
    });
    expect(response.warnings[0].message).toContain('Cloud queue');
    expect(response.assumptions[0]).toEqual({
      key: 'trigger',
      message: 'Used manual trigger because no schedule was specified.',
    });
    expect(response.followUpActions[0]).toMatchObject({
      action: 'review-generated-files',
      label: 'Review Generated Files',
    });
  });

  it('ignores executor-provided run receipt fields when execution was not requested', async () => {
    const executor = mockExecutor({
      runReceipt: {
        executionRequested: true,
        runId: 'run-001',
        status: 'queued',
        receiptUrl: '/runs/run-001',
      },
    });
    const response = await handleCloudGenerate(validRequest(), testOptions(executor));

    expect(response.runReceipt).toEqual({
      executionRequested: false,
      requestId: TEST_REQUEST_ID,
      status: 'not_requested',
    });
  });

  it('returns executor-provided run receipt fields for generate-and-run requests', async () => {
    const executor = mockExecutor({
      runReceipt: {
        executionRequested: true,
        runId: 'run-001',
        status: 'queued',
        receiptUrl: '/runs/run-001',
      },
    });
    const response = await handleCloudGenerate(
      validRequest({
        body: {
          spec: 'generate and run in Cloud',
          mode: 'cloud',
          generationMode: 'generate-and-run',
        },
      }),
      testOptions(executor),
    );

    expect(response.runReceipt).toEqual({
      executionRequested: true,
      requestId: TEST_REQUEST_ID,
      runId: 'run-001',
      status: 'queued',
      receiptUrl: '/runs/run-001',
    });
  });

  it('marks execution requested for generate-and-run without implementing run behavior', async () => {
    const executor = mockExecutor();
    const response = await handleCloudGenerate(
      validRequest({
        body: {
          spec: 'generate and run in Cloud',
          mode: 'cloud',
          generationMode: 'generate-and-run',
        },
      }),
      testOptions(executor),
    );

    expect(response.ok).toBe(true);
    expect(response.runReceipt).toEqual({
      executionRequested: true,
      requestId: TEST_REQUEST_ID,
      status: 'skipped',
    });
    expect(response.artifactBundle.generationMode).toBe('generate-and-run');
    expect(response.artifactBundle.targetMode).toBe('cloud');
  });

  it('returns the artifact bundle response contract with warnings, assumptions, and follow-ups', async () => {
    const executor = mockExecutor({
      artifacts: [
        {
          path: 'workflows/generated-workflow.ts',
          type: 'text/typescript',
          content: 'export const workflow = {};',
        },
        {
          path: 'workflows/generated-workflow.metadata.json',
          type: 'application/json',
          content: '{"source":"cloud-generate"}',
        },
      ],
      warnings: [{ severity: 'warning', message: 'Spec did not include an owner.' }],
      assumptions: [{ key: 'owner', message: 'Used the requesting workspace as owner.' }],
      followUpActions: [
        {
          action: 'review-artifacts',
          label: 'Review Artifacts',
          description: 'Review generated workflow files before deployment.',
        },
      ],
    });

    const response = await handleCloudGenerate(validRequest(), testOptions(executor));

    expect(response.artifacts).toHaveLength(2);
    expect(response.artifacts[0]).toMatchObject({
      path: 'workflows/generated-workflow.ts',
      type: 'text/typescript',
      content: expect.stringContaining('workflow'),
    });
    expect(response.artifacts[1].path).toBe('workflows/generated-workflow.metadata.json');
    expect(response.warnings[0]).toEqual({
      severity: 'warning',
      message: 'Spec did not include an owner.',
    });
    expect(response.assumptions[0]).toEqual({
      key: 'owner',
      message: 'Used the requesting workspace as owner.',
    });
    expect(response.followUpActions[0]).toMatchObject({
      action: 'review-artifacts',
      label: 'Review Artifacts',
    });
    expect(response.artifactBundle).toEqual({
      artifacts: response.artifacts,
      generationMode: 'generate-and-return-artifacts',
      targetMode: 'cloud',
    });
    expect(response.artifactBundle.artifacts).toBe(response.artifacts);
    expect(response.artifactBundle.artifacts[0]).toMatchObject({
      path: 'workflows/generated-workflow.ts',
      type: 'text/typescript',
      content: expect.stringContaining('workflow'),
    });
  });

  it('returns generated file artifact fields for Cloud API clients', async () => {
    const executor = mockExecutor({
      artifacts: [
        {
          path: 'workflows/cloud-generated-workflow.ts',
          type: 'text/typescript',
          content: 'export const generatedWorkflow = workflow("cloud-generated");',
        },
      ],
      warnings: [{ severity: 'info', message: 'Assumed workflow artifact path.' }],
      assumptions: [{ key: 'artifact-path', message: 'Used the default workflows directory.' }],
      followUpActions: [
        {
          action: 'open-generated-file',
          label: 'Open Generated File',
          description: 'Inspect the returned workflow file before committing it.',
        },
      ],
    });

    const response = await handleCloudGenerate(validRequest(), testOptions(executor));

    expect(response.ok).toBe(true);
    expect(response.artifacts).toEqual([
      {
        path: 'workflows/cloud-generated-workflow.ts',
        type: 'text/typescript',
        content: 'export const generatedWorkflow = workflow("cloud-generated");',
      },
    ]);
    expect(response.artifactBundle.artifacts[0]).toEqual({
      path: 'workflows/cloud-generated-workflow.ts',
      type: 'text/typescript',
      content: expect.stringContaining('cloud-generated'),
    });
    expect(response.warnings[0]).toEqual({
      severity: 'info',
      message: 'Assumed workflow artifact path.',
    });
    expect(response.assumptions[0]).toEqual({
      key: 'artifact-path',
      message: 'Used the default workflows directory.',
    });
    expect(response.followUpActions[0]).toMatchObject({
      action: 'open-generated-file',
      label: 'Open Generated File',
    });
  });

  it('appends Workforce persona generation metadata as a cloud artifact when provided', async () => {
    const executor = mockExecutor({
      artifacts: [
        {
          path: 'workflows/generated-workflow.ts',
          type: 'text/typescript',
          content: 'workflow("generated")',
        },
      ],
      generationMetadata: {
        workforcePersona: {
          personaId: 'agent-relay-workflow',
          tier: 'best',
          harness: 'codex',
          model: 'openai-codex/gpt-5.3-codex',
          promptDigest: 'a'.repeat(64),
          warnings: [],
          runId: 'run-persona-001',
          source: 'package',
          selectedIntent: 'agent-relay-workflow',
          responseFormat: 'structured-json',
          outputPath: 'workflows/generated-workflow.ts',
          promptInputs: {
            workflowName: 'generated-workflow',
            targetMode: 'cloud',
            repoRoot: '/repo',
            relevantFileCount: 2,
          },
        },
      },
    });

    const response = await handleCloudGenerate(validRequest(), testOptions(executor));

    expect(response.artifacts).toHaveLength(2);
    expect(response.artifacts[1]).toMatchObject({
      path: 'workflows/generated-workflow.workforce-persona.json',
      type: 'application/json',
      content: expect.stringContaining('"personaId": "agent-relay-workflow"'),
    });
    expect(response.artifactBundle.artifacts).toBe(response.artifacts);
    expect(response.artifactBundle.artifacts).toHaveLength(2);
    expect(response.artifactBundle.artifacts[1]).toEqual(response.artifacts[1]);
    expect(response.artifacts[1].content).toContain('"runId": "run-persona-001"');
    expect(response.artifacts[1].content).toContain('"promptDigest": "aaaaaaaa');
  });

  it('represents executor validation failures as top-level failure with 422 status', async () => {
    const executor = mockExecutor({
      warnings: [{ severity: 'error', message: 'Generated workflow did not pass validation.' }],
      validation: {
        ok: false,
        status: 'failed',
        issues: [
          {
            code: 'invalid-workflow',
            message: 'Generated workflow is missing a deterministic gate.',
            path: 'steps[3]',
          },
        ],
      },
      followUpActions: [{ action: 'revise-spec', label: 'Revise Spec' }],
    });

    const response = await handleCloudGenerate(validRequest(), testOptions(executor));

    // Top-level response must reflect the validation failure
    expect(response.ok).toBe(false);
    expect(response.status).toBe(422);
    expect(response.error).toEqual({
      code: 'INVALID_WORKFLOW',
      message: 'Generated workflow is missing a deterministic gate.',
      path: 'steps[3]',
    });
    expect(response.validation).toEqual({
      ok: false,
      status: 'failed',
      issues: [
        {
          code: 'invalid-workflow',
          message: 'Generated workflow is missing a deterministic gate.',
          path: 'steps[3]',
        },
      ],
    });
    expect(response.artifacts).toEqual([
      { path: 'out/workflow.ts', type: 'text/typescript', content: '// generated' },
    ]);
    expect(response.artifactBundle).toEqual({
      artifacts: response.artifacts,
      generationMode: 'generate-and-return-artifacts',
      targetMode: 'cloud',
    });
    expect(response.warnings[0].severity).toBe('error');
    expect(response.followUpActions[0]).toEqual({ action: 'revise-spec', label: 'Revise Spec' });
  });

  it('does not claim validation passed when executor returns artifacts without validation', async () => {
    const calls: CloudGenerateRequest[] = [];
    const executor: CloudExecutor = {
      async generate(request: CloudGenerateRequest): Promise<CloudGenerateResult> {
        calls.push(request);
        return {
          artifacts: [
            {
              path: 'out/unvalidated-workflow.ts',
              type: 'text/typescript',
              content: '// generated without validation',
            },
          ],
          warnings: [],
          followUpActions: [{ action: 'review', label: 'Review' }],
        };
      },
    };

    const response = await handleCloudGenerate(validRequest(), testOptions(executor));

    expect(calls).toHaveLength(1);
    expect(response.ok).toBe(false);
    expect(response.status).toBe(500);
    expect(response.error).toEqual({
      code: 'MISSING_EXECUTOR_VALIDATION',
      message: 'Cloud generation returned artifacts without validation evidence.',
      path: 'validation',
    });
    expect(response.artifacts).toEqual([
      {
        path: 'out/unvalidated-workflow.ts',
        type: 'text/typescript',
        content: '// generated without validation',
      },
    ]);
    expect(response.validation).toEqual({
      ok: false,
      status: 'skipped',
      issues: [
        {
          code: 'missing-executor-validation',
          message: 'Cloud generation returned artifacts without validation evidence.',
          path: 'validation',
        },
      ],
    });
    expect(response.validation.status).not.toBe('passed');
    expect(response.warnings[0]).toEqual({
      severity: 'error',
      message: 'Cloud generation returned artifacts without validation evidence.',
    });
    expect(response.followUpActions[0]).toEqual({
      action: 'validate-artifacts',
      label: 'Validate Artifacts',
      description: 'Run the workflow artifact validator before accepting this generated bundle.',
    });
  });

  it('fails closed when executor produces no artifacts', async () => {
    const executor = mockExecutor({ artifacts: [] });
    const response = await handleCloudGenerate(validRequest(), testOptions(executor));

    expect(response.ok).toBe(false);
    expect(response.status).toBe(500);
    expect(response.error).toEqual({
      code: 'MISSING_GENERATED_ARTIFACTS',
      message: 'Cloud generation produced no workflow artifacts.',
      path: 'artifacts',
    });
    expect(response.artifacts).toEqual([]);
    expect(response.artifactBundle).toEqual({
      artifacts: [],
      generationMode: 'generate-and-return-artifacts',
      targetMode: 'cloud',
    });
    expect(response.warnings[0]).toEqual({
      severity: 'error',
      message: 'Cloud generation produced no workflow artifacts; the generation runtime may not be wired.',
    });
    expect(response.assumptions).toEqual([]);
    expect(response.validation).toEqual({
      ok: false,
      status: 'failed',
      issues: [
        {
          code: 'missing-generated-artifacts',
          message: 'Cloud generation produced no workflow artifacts.',
          path: 'artifacts',
        },
      ],
    });
    expect(response.runReceipt).toEqual({
      executionRequested: false,
      requestId: TEST_REQUEST_ID,
      status: 'not_requested',
    });
    expect(response.followUpActions).toEqual([
      {
        action: 'wire-runtime',
        label: 'Wire Cloud Runtime',
        description: 'Connect a generation runtime that returns validated workflow artifacts.',
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('handleCloudGenerate — error path', () => {
  it('catches executor errors and returns 500 with a sanitized retry warning', async () => {
    const executor = failingExecutor('connection timeout');
    const response = await handleCloudGenerate(validRequest(), testOptions(executor));

    expect(response.ok).toBe(false);
    expect(response.status).toBe(500);
    expect(response.error).toEqual({
      code: 'CLOUD_GENERATION_FAILED',
      message: 'Cloud generation failed before validation completed.',
    });
    expect(response.warnings[0].severity).toBe('error');
    expect(response.warnings[0].message).toContain('Cloud generation failed');
    expect(response.warnings[0].message).toContain(TEST_REQUEST_ID);
    expect(response.warnings[0].message).not.toContain('connection timeout');
    expect(response.followUpActions[0].action).toBe('retry');
    expect(response.validation).toEqual({ ok: false, status: 'skipped', issues: [] });
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
    expect(response.warnings[0].message).toContain('Cloud generation failed');
    expect(response.warnings[0].message).toContain(TEST_REQUEST_ID);
    expect(response.warnings[0].message).not.toContain('string error');
    expect(response.validation).toEqual({ ok: false, status: 'skipped', issues: [] });
  });
});

// ---------------------------------------------------------------------------
// Default executor
// ---------------------------------------------------------------------------

describe('handleCloudGenerate — default executor', () => {
  it('fails closed with the default executor when no runtime is wired', async () => {
    const response = await handleCloudGenerate(validRequest(), {
      authorizedWorkspaceScope: { workspaceId: 'ws-001' },
      requestIdFactory: () => TEST_REQUEST_ID,
    });

    expect(response.ok).toBe(false);
    expect(response.status).toBe(500);
    expect(response.artifacts).toEqual([]);
    expect(response.warnings.some((w) => w.message.includes('stub'))).toBe(true);
    expect(response.warnings.some((w) => w.severity === 'error')).toBe(true);
    expect(response.assumptions.some((a) => a.key === 'runtime-not-wired')).toBe(true);
    expect(response.validation).toEqual({
      ok: false,
      status: 'failed',
      issues: [
        {
          code: 'missing-generated-artifacts',
          message: 'Cloud generation produced no workflow artifacts.',
          path: 'artifacts',
        },
      ],
    });
    expect(response.followUpActions.some((a) => a.action === 'wire-runtime')).toBe(true);
  });

  it('default executor suggests local run for mode=both', async () => {
    const request = validRequest({ body: { spec: 'test', mode: 'both' } });
    const response = await handleCloudGenerate(request, {
      authorizedWorkspaceScope: { workspaceId: 'ws-001' },
      requestIdFactory: () => TEST_REQUEST_ID,
    });

    expect(response.ok).toBe(false);
    expect(response.status).toBe(500);
    expect(response.followUpActions.some((a) => a.action === 'run-local')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Runtime-invalid request input
// ---------------------------------------------------------------------------

describe('handleCloudGenerate — runtime-invalid input', () => {
  it('rejects non-string auth.token without throwing', async () => {
    const executor = mockExecutor();
    const request = {
      auth: { token: 123 as unknown as string },
      workspace: { workspaceId: 'ws-001' },
      body: { spec: 'build something' },
    } as CloudGenerateRequest;

    const response = await handleCloudGenerate(request, testOptions(executor));

    expect(response.ok).toBe(false);
    expect(response.status).toBe(401);
    expect(response.validation.issues[0].code).toBe('missing-auth-token');
    expect(response.validation.issues[0].path).toBe('auth.token');
    expect(executor.calls).toHaveLength(0);
    expect(response.runReceipt).toEqual({
      executionRequested: false,
      requestId: TEST_REQUEST_ID,
      status: 'not_requested',
    });
  });

  it('rejects invalid auth.tokenType values', async () => {
    const executor = mockExecutor();
    const request = validRequest({
      auth: { token: 'test-token', tokenType: 'session' as unknown as 'bearer' },
    });

    const response = await handleCloudGenerate(request, testOptions(executor));

    expect(response.ok).toBe(false);
    expect(response.status).toBe(400);
    expect(response.validation.issues[0].code).toBe('invalid-auth-token-type');
    expect(response.validation.issues[0].path).toBe('auth.tokenType');
    expect(executor.calls).toHaveLength(0);
  });

  it('rejects non-string workspace.workspaceId without throwing', async () => {
    const executor = mockExecutor();
    const request = {
      auth: { token: 'test-token' },
      workspace: { workspaceId: 42 as unknown as string },
      body: { spec: 'build something' },
    } as CloudGenerateRequest;

    const response = await handleCloudGenerate(request, testOptions(executor));

    expect(response.ok).toBe(false);
    expect(response.status).toBe(400);
    expect(response.validation.issues[0].code).toBe('missing-workspace-id');
    expect(response.validation.issues[0].path).toBe('workspace.workspaceId');
    expect(executor.calls).toHaveLength(0);
  });

  it('rejects invalid body.mode values', async () => {
    const executor = mockExecutor();
    const request = validRequest({
      body: { spec: 'build something', mode: 'local' as unknown as 'cloud' },
    });

    const response = await handleCloudGenerate(request, testOptions(executor));

    expect(response.ok).toBe(false);
    expect(response.status).toBe(400);
    expect(response.validation.issues[0].code).toBe('invalid-mode');
    expect(response.validation.issues[0].path).toBe('body.mode');
    expect(executor.calls).toHaveLength(0);
  });

  it('rejects invalid generationMode values', async () => {
    const executor = mockExecutor();
    const request = validRequest({
      body: {
        spec: 'build something',
        generationMode: 'run-only' as unknown as CloudGenerateRequest['body']['generationMode'],
      },
    });

    const response = await handleCloudGenerate(request, testOptions(executor));

    expect(response.ok).toBe(false);
    expect(response.status).toBe(400);
    expect(response.validation.issues[0].code).toBe('invalid-generation-mode');
    expect(response.validation.issues[0].path).toBe('body.generationMode');
    expect(executor.calls).toHaveLength(0);
  });

  it('rejects malformed structured spec missing the kind discriminant', async () => {
    const executor = mockExecutor();
    const request = validRequest({
      body: { spec: { document: { name: 'demo' } } as unknown as CloudGenerateRequest['body']['spec'] },
    });

    const response = await handleCloudGenerate(request, testOptions(executor));

    expect(response.ok).toBe(false);
    expect(response.status).toBe(400);
    expect(response.validation.issues[0].code).toBe('missing-spec');
    expect(response.validation.issues[0].path).toBe('body.spec');
    expect(response.warnings).toEqual([
      { severity: 'error', message: 'Missing or empty spec in request body.' },
    ]);
    expect(response.assumptions).toEqual([]);
    expect(response.followUpActions).toEqual([]);
    expect(executor.calls).toHaveLength(0);
  });

  it('rejects structured specs with invalid format values', async () => {
    const executor = mockExecutor();
    const request = validRequest({
      body: {
        spec: {
          kind: 'structured',
          document: { name: 'demo' },
          format: 'toml' as unknown as 'json',
        },
      },
    });

    const response = await handleCloudGenerate(request, testOptions(executor));

    expect(response.ok).toBe(false);
    expect(response.status).toBe(400);
    expect(response.validation.issues[0]).toEqual({
      code: 'invalid-structured-spec-format',
      message: 'Invalid structured spec format.',
      path: 'body.spec.format',
    });
    expect(response.error).toEqual({
      code: 'INVALID_STRUCTURED_SPEC_FORMAT',
      message: 'Invalid structured spec format.',
      path: 'body.spec.format',
    });
    expect(executor.calls).toHaveLength(0);
  });

  it('rejects malformed natural-language spec with non-string text', async () => {
    const executor = mockExecutor();
    const request = validRequest({
      body: {
        spec: { kind: 'natural-language', text: 99 as unknown as string } as CloudGenerateRequest['body']['spec'],
      },
    });

    const response = await handleCloudGenerate(request, testOptions(executor));

    expect(response.ok).toBe(false);
    expect(response.status).toBe(400);
    expect(response.validation.issues[0].code).toBe('missing-spec');
    expect(executor.calls).toHaveLength(0);
  });

  it('rejects invalid workspace.projectId without throwing', async () => {
    const executor = mockExecutor();
    const request = validRequest({
      workspace: { workspaceId: 'ws-001', projectId: 7 as unknown as string },
    });

    const response = await handleCloudGenerate(request, testOptions(executor));

    expect(response.ok).toBe(false);
    expect(response.status).toBe(400);
    expect(response.validation.issues[0].code).toBe('invalid-project-id');
    expect(response.validation.issues[0].path).toBe('workspace.projectId');
    expect(executor.calls).toHaveLength(0);
  });

  it('rejects invalid workspace.environment without throwing', async () => {
    const executor = mockExecutor();
    const request = validRequest({
      workspace: { workspaceId: 'ws-001', environment: 9 as unknown as string },
    });

    const response = await handleCloudGenerate(request, testOptions(executor));

    expect(response.ok).toBe(false);
    expect(response.status).toBe(400);
    expect(response.validation.issues[0].code).toBe('invalid-environment');
    expect(response.validation.issues[0].path).toBe('workspace.environment');
    expect(executor.calls).toHaveLength(0);
  });

  it('echoes caller-requested mode and generationMode on shape-rejection bundles', async () => {
    const request = validRequest({
      body: { spec: '', mode: 'both', generationMode: 'generate-and-run' },
    });

    const response = await handleCloudGenerate(request, testOptions(mockExecutor()));

    expect(response.ok).toBe(false);
    expect(response.status).toBe(400);
    expect(response.validation.issues[0].code).toBe('missing-spec');
    expect(response.artifactBundle).toEqual({
      artifacts: [],
      generationMode: 'generate-and-run',
      targetMode: 'both',
    });
    expect(response.runReceipt).toEqual({
      executionRequested: true,
      requestId: TEST_REQUEST_ID,
      status: 'skipped',
    });
  });

  it('defaults bundle mode when caller-requested mode is invalid', async () => {
    const request = validRequest({
      body: {
        spec: 'build something',
        mode: 'local' as unknown as 'cloud',
        generationMode: 'run-only' as unknown as CloudGenerateRequest['body']['generationMode'],
      },
    });

    const response = await handleCloudGenerate(request, testOptions(mockExecutor()));

    expect(response.ok).toBe(false);
    expect(response.artifactBundle).toEqual({
      artifacts: [],
      generationMode: 'generate-and-return-artifacts',
      targetMode: 'cloud',
    });
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
    expect('validation' in response).toBe(true);
    expect('runReceipt' in response).toBe(true);
    // LocalResponse has 'logs' and 'nextActions' — Cloud has 'followUpActions' and no 'logs'
    expect('followUpActions' in response).toBe(true);
    expect('logs' in response).toBe(false);
    expect('nextActions' in response).toBe(false);
  });
});
