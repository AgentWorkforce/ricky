import { describe, it, expect } from 'vitest';
import {
  handleCloudGenerate,
  defaultExecutor,
  CLOUD_GENERATE_ROUTE,
  type CloudExecutor,
} from './generate-endpoint.js';
import type { CloudGenerateRequest } from './request-types.js';
import type { CloudGenerateResponse } from './response-types.js';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

let counter = 0;
const stableIdFactory = () => `req-${++counter}`;

function validRequest(overrides: Partial<CloudGenerateRequest> = {}): CloudGenerateRequest {
  return {
    auth: { token: 'tok_test' },
    workspace: { workspaceId: 'ws_1' },
    body: { spec: { kind: 'string', raw: 'hello' } },
    ...overrides,
  };
}

function mockExecutor(response: CloudGenerateResponse): CloudExecutor {
  return { execute: async () => response };
}

function throwingExecutor(error: unknown): CloudExecutor {
  return {
    execute: async () => {
      throw error;
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('Cloud Generate endpoint', () => {
  beforeEach(() => {
    counter = 0;
  });

  /* ---------- Route constant ---------- */

  it('exposes the correct route constant', () => {
    expect(CLOUD_GENERATE_ROUTE).toBe('POST /api/v1/ricky/workflows/generate');
  });

  /* ---------- Validation: missing auth ---------- */

  it('rejects request with missing auth token (empty string)', async () => {
    const res = await handleCloudGenerate(
      validRequest({ auth: { token: '' } }),
      { generateRequestId: stableIdFactory },
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Missing auth token');
  });

  it('rejects request with missing auth object', async () => {
    const res = await handleCloudGenerate(
      validRequest({ auth: undefined as any }),
      { generateRequestId: stableIdFactory },
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Missing auth token');
  });

  /* ---------- Validation: missing workspace ---------- */

  it('rejects request with missing workspace ID (empty string)', async () => {
    const res = await handleCloudGenerate(
      validRequest({ workspace: { workspaceId: '' } }),
      { generateRequestId: stableIdFactory },
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Missing workspace ID');
  });

  it('rejects request with missing workspace object', async () => {
    const res = await handleCloudGenerate(
      validRequest({ workspace: undefined as any }),
      { generateRequestId: stableIdFactory },
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Missing workspace ID');
  });

  /* ---------- Validation: missing spec ---------- */

  it('rejects request with missing spec payload', async () => {
    const res = await handleCloudGenerate(
      validRequest({ body: { spec: undefined as any } }),
      { generateRequestId: stableIdFactory },
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Missing spec payload');
  });

  it('rejects request with missing body', async () => {
    const res = await handleCloudGenerate(
      validRequest({ body: undefined as any }),
      { generateRequestId: stableIdFactory },
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Missing spec payload');
  });

  /* ---------- Validation: error responses include receipt ---------- */

  it('validation error response includes a receipt with the request ID', async () => {
    const res = await handleCloudGenerate(
      validRequest({ auth: { token: '' } }),
      { generateRequestId: stableIdFactory },
    );
    expect(res.receipt.requestId).toBe('req-1');
    expect(res.receipt.durationMs).toBe(0);
  });

  it('validation error response includes an issue in validation.issues', async () => {
    const res = await handleCloudGenerate(
      validRequest({ auth: { token: '' } }),
      { generateRequestId: stableIdFactory },
    );
    expect(res.validation.valid).toBe(false);
    expect(res.validation.issues).toHaveLength(1);
    expect(res.validation.issues[0].field).toBe('request');
  });

  /* ---------- Success path ---------- */

  it('returns the executor response on success', async () => {
    const expected: CloudGenerateResponse = {
      ok: true,
      artifacts: [{ id: 'a1', name: 'out.ts', content: 'export {}', mimeType: 'text/typescript' }],
      warnings: [{ code: 'W1', message: 'heads up' }],
      assumptions: [{ key: 'env', value: 'prod', reason: 'default' }],
      followUpActions: [{ label: 'Deploy', action: 'deploy', payload: { target: 'staging' } }],
      validation: { valid: true, issues: [] },
      receipt: { requestId: 'req-1', startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:00:01Z', durationMs: 1000 },
    };

    const res = await handleCloudGenerate(
      validRequest(),
      { executor: mockExecutor(expected), generateRequestId: stableIdFactory },
    );
    expect(res).toEqual(expected);
  });

  it('passes artifacts through unchanged', async () => {
    const artifacts = [
      { id: 'a1', name: 'file.ts', content: 'code' },
      { id: 'a2', name: 'file2.ts', content: 'more code', mimeType: 'text/typescript' },
    ];
    const resp: CloudGenerateResponse = {
      ok: true,
      artifacts,
      warnings: [],
      assumptions: [],
      followUpActions: [],
      validation: { valid: true, issues: [] },
      receipt: { requestId: 'r', startedAt: '', completedAt: '', durationMs: 0 },
    };
    const res = await handleCloudGenerate(validRequest(), { executor: mockExecutor(resp) });
    expect(res.artifacts).toEqual(artifacts);
  });

  it('passes warnings through unchanged', async () => {
    const warnings = [{ code: 'DEPRECATION', message: 'use v2' }];
    const resp: CloudGenerateResponse = {
      ok: true,
      artifacts: [],
      warnings,
      assumptions: [],
      followUpActions: [],
      validation: { valid: true, issues: [] },
      receipt: { requestId: 'r', startedAt: '', completedAt: '', durationMs: 0 },
    };
    const res = await handleCloudGenerate(validRequest(), { executor: mockExecutor(resp) });
    expect(res.warnings).toEqual(warnings);
  });

  it('passes assumptions through unchanged', async () => {
    const assumptions = [{ key: 'region', value: 'us-east-1' }];
    const resp: CloudGenerateResponse = {
      ok: true,
      artifacts: [],
      warnings: [],
      assumptions,
      followUpActions: [],
      validation: { valid: true, issues: [] },
      receipt: { requestId: 'r', startedAt: '', completedAt: '', durationMs: 0 },
    };
    const res = await handleCloudGenerate(validRequest(), { executor: mockExecutor(resp) });
    expect(res.assumptions).toEqual(assumptions);
  });

  it('passes followUpActions through unchanged', async () => {
    const followUpActions = [{ label: 'Review', action: 'review' }];
    const resp: CloudGenerateResponse = {
      ok: true,
      artifacts: [],
      warnings: [],
      assumptions: [],
      followUpActions,
      validation: { valid: true, issues: [] },
      receipt: { requestId: 'r', startedAt: '', completedAt: '', durationMs: 0 },
    };
    const res = await handleCloudGenerate(validRequest(), { executor: mockExecutor(resp) });
    expect(res.followUpActions).toEqual(followUpActions);
  });

  it('passes run receipt through unchanged', async () => {
    const receipt = { requestId: 'r1', startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:00:02Z', durationMs: 2000 };
    const resp: CloudGenerateResponse = {
      ok: true,
      artifacts: [],
      warnings: [],
      assumptions: [],
      followUpActions: [],
      validation: { valid: true, issues: [] },
      receipt,
    };
    const res = await handleCloudGenerate(validRequest(), { executor: mockExecutor(resp) });
    expect(res.receipt).toEqual(receipt);
  });

  /* ---------- Error handling ---------- */

  it('catches executor Error and returns error response', async () => {
    const res = await handleCloudGenerate(
      validRequest(),
      { executor: throwingExecutor(new Error('boom')), generateRequestId: stableIdFactory },
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Executor error: boom');
    expect(res.receipt.requestId).toBe('req-1');
  });

  it('catches non-Error throws and stringifies them', async () => {
    const res = await handleCloudGenerate(
      validRequest(),
      { executor: throwingExecutor('string-error'), generateRequestId: stableIdFactory },
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Executor error: string-error');
  });

  /* ---------- Default executor ---------- */

  it('default executor returns ok with STUB warning', async () => {
    const res = await defaultExecutor.execute(validRequest());
    expect(res.ok).toBe(true);
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0].code).toBe('STUB');
  });

  /* ---------- Cloud vs local distinction ---------- */

  it('response uses followUpActions (not nextActions) – Cloud-specific shape', async () => {
    const resp: CloudGenerateResponse = {
      ok: true,
      artifacts: [],
      warnings: [],
      assumptions: [],
      followUpActions: [{ label: 'Next', action: 'next' }],
      validation: { valid: true, issues: [] },
      receipt: { requestId: 'r', startedAt: '', completedAt: '', durationMs: 0 },
    };
    const res = await handleCloudGenerate(validRequest(), { executor: mockExecutor(resp) });
    expect(res).toHaveProperty('followUpActions');
    expect(res).not.toHaveProperty('nextActions');
    expect(res).not.toHaveProperty('logs');
  });
});
