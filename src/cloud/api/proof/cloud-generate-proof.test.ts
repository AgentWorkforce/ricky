/**
 * Cloud Generate – Proof surface tests.
 *
 * These tests prove user-visible Cloud contract behavior:
 *   1. Request validation rejects missing auth, workspace, and spec
 *   2. Successful responses carry the full Cloud shape (artifacts, warnings,
 *      follow-up actions, request ID, receipt)
 *   3. Auth and workspace context are passed through to the executor
 *   4. The current executor is an honest stub – tests acknowledge this
 *
 * All proofs are deterministic and bounded: no real I/O, no timers,
 * fixed timestamps, and a stable ID factory.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  handleCloudGenerate,
  type HandleCloudGenerateOptions,
} from '../generate-endpoint.js';
import type { CloudGenerateRequest } from '../request-types.js';
import type { CloudGenerateResponse } from '../response-types.js';
import {
  createStableIdFactory,
  validProofRequest,
  successProofResponse,
  createRecordingExecutor,
} from './cloud-generate-proof.js';

/* ------------------------------------------------------------------ */
/*  Shared deterministic ID factory                                   */
/* ------------------------------------------------------------------ */

let stableId: () => string;

beforeEach(() => {
  stableId = createStableIdFactory('proof');
});

/* ================================================================== */
/*  1. Request validation                                             */
/* ================================================================== */

describe('Cloud Generate proof – request validation', () => {
  const opts = (): HandleCloudGenerateOptions => ({
    generateRequestId: stableId,
  });

  /* ---------- Missing auth ---------- */

  it('rejects when auth token is an empty string', async () => {
    const res = await handleCloudGenerate(
      validProofRequest({ auth: { token: '' } }),
      opts(),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Missing auth token');
    expect(res.validation.valid).toBe(false);
    expect(res.validation.issues[0]).toEqual({ field: 'request', message: 'Missing auth token' });
  });

  it('rejects when auth object is absent', async () => {
    const res = await handleCloudGenerate(
      validProofRequest({ auth: undefined as any }),
      opts(),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Missing auth token');
  });

  /* ---------- Missing workspace ---------- */

  it('rejects when workspace ID is an empty string', async () => {
    const res = await handleCloudGenerate(
      validProofRequest({ workspace: { workspaceId: '' } }),
      opts(),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Missing workspace ID');
    expect(res.validation.valid).toBe(false);
    expect(res.validation.issues[0]).toEqual({ field: 'request', message: 'Missing workspace ID' });
  });

  it('rejects when workspace object is absent', async () => {
    const res = await handleCloudGenerate(
      validProofRequest({ workspace: undefined as any }),
      opts(),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Missing workspace ID');
  });

  /* ---------- Missing spec ---------- */

  it('rejects when spec is absent in body', async () => {
    const res = await handleCloudGenerate(
      validProofRequest({ body: { spec: undefined as any } }),
      opts(),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Missing spec payload');
    expect(res.validation.valid).toBe(false);
  });

  it('rejects when body is absent', async () => {
    const res = await handleCloudGenerate(
      validProofRequest({ body: undefined as any }),
      opts(),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Missing spec payload');
  });

  /* ---------- Validation error shape ---------- */

  it('validation errors carry a receipt with the assigned request ID', async () => {
    const res = await handleCloudGenerate(
      validProofRequest({ auth: { token: '' } }),
      opts(),
    );
    expect(res.receipt.requestId).toBe('proof-1');
    expect(res.receipt.durationMs).toBe(0);
    expect(typeof res.receipt.startedAt).toBe('string');
    expect(typeof res.receipt.completedAt).toBe('string');
  });

  it('validation errors return empty arrays for artifacts, warnings, assumptions, followUpActions', async () => {
    const res = await handleCloudGenerate(
      validProofRequest({ auth: { token: '' } }),
      opts(),
    );
    expect(res.artifacts).toEqual([]);
    expect(res.warnings).toEqual([]);
    expect(res.assumptions).toEqual([]);
    expect(res.followUpActions).toEqual([]);
  });
});

/* ================================================================== */
/*  2. Successful response shape                                      */
/* ================================================================== */

describe('Cloud Generate proof – successful response shape', () => {
  it('returns full Cloud shape: artifacts, warnings, followUpActions, receipt', async () => {
    const { executor } = createRecordingExecutor('proof-1');
    const res = await handleCloudGenerate(
      validProofRequest(),
      { executor, generateRequestId: stableId },
    );

    expect(res.ok).toBe(true);

    // Artifacts
    expect(res.artifacts).toHaveLength(1);
    expect(res.artifacts[0]).toEqual(
      expect.objectContaining({ id: 'art-1', name: 'proof-output.ts' }),
    );
    expect(typeof res.artifacts[0].content).toBe('string');

    // Warnings
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]).toHaveProperty('code');
    expect(res.warnings[0]).toHaveProperty('message');

    // Follow-up actions
    expect(res.followUpActions).toHaveLength(1);
    expect(res.followUpActions[0]).toEqual(
      expect.objectContaining({ label: 'Verify', action: 'verify-output' }),
    );

    // Receipt
    expect(res.receipt.requestId).toBe('proof-1');
    expect(typeof res.receipt.startedAt).toBe('string');
    expect(typeof res.receipt.completedAt).toBe('string');
    expect(typeof res.receipt.durationMs).toBe('number');
  });

  it('response uses Cloud-specific followUpActions (not nextActions or logs)', async () => {
    const { executor } = createRecordingExecutor('proof-1');
    const res = await handleCloudGenerate(
      validProofRequest(),
      { executor, generateRequestId: stableId },
    );

    expect(res).toHaveProperty('followUpActions');
    expect(res).not.toHaveProperty('nextActions');
    expect(res).not.toHaveProperty('logs');
  });

  it('response shape matches CloudGenerateResponse exactly', async () => {
    const expected = successProofResponse('proof-1');
    const { executor } = createRecordingExecutor('proof-1');

    const res = await handleCloudGenerate(
      validProofRequest(),
      { executor, generateRequestId: stableId },
    );

    expect(res).toEqual(expected);
  });

  it('request ID is assigned from the factory when not provided on the request', async () => {
    const { executor, state } = createRecordingExecutor('proof-1');
    await handleCloudGenerate(
      validProofRequest(),
      { executor, generateRequestId: stableId },
    );

    // The handler merges the generated ID onto the request before passing to executor
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].requestId).toBe('proof-1');
  });

  it('request ID from the request takes precedence over the factory', async () => {
    const { executor, state } = createRecordingExecutor('explicit-id');
    state.response = successProofResponse('explicit-id');

    await handleCloudGenerate(
      validProofRequest({ requestId: 'explicit-id' }),
      { executor, generateRequestId: stableId },
    );

    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].requestId).toBe('explicit-id');
  });
});

/* ================================================================== */
/*  3. Auth and workspace context pass-through                        */
/* ================================================================== */

describe('Cloud Generate proof – auth/workspace context pass-through', () => {
  it('passes auth context to the executor unchanged', async () => {
    const { executor, state } = createRecordingExecutor('proof-1');
    const auth = { token: 'tok_explicit_proof' };

    await handleCloudGenerate(
      validProofRequest({ auth }),
      { executor, generateRequestId: stableId },
    );

    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].auth).toEqual(auth);
  });

  it('passes workspace context including environment to the executor', async () => {
    const { executor, state } = createRecordingExecutor('proof-1');
    const workspace = { workspaceId: 'ws_explicit', environment: 'staging' };

    await handleCloudGenerate(
      validProofRequest({ workspace }),
      { executor, generateRequestId: stableId },
    );

    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].workspace).toEqual(workspace);
  });

  it('passes body/spec to the executor unchanged', async () => {
    const { executor, state } = createRecordingExecutor('proof-1');
    const body = { spec: { kind: 'nl' as const, prompt: 'build a widget' }, dryRun: true };

    await handleCloudGenerate(
      validProofRequest({ body }),
      { executor, generateRequestId: stableId },
    );

    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].body).toEqual(body);
  });
});

/* ================================================================== */
/*  4. Honest stub acknowledgment                                     */
/* ================================================================== */

describe('Cloud Generate proof – stubbed runtime seam', () => {
  it('proof executor response includes a PROOF warning acknowledging it is a stub', async () => {
    const { executor } = createRecordingExecutor('proof-1');
    const res = await handleCloudGenerate(
      validProofRequest(),
      { executor, generateRequestId: stableId },
    );

    const proofWarning = res.warnings.find((w) => w.code === 'PROOF');
    expect(proofWarning).toBeDefined();
    expect(proofWarning!.message).toMatch(/proof executor/i);
    expect(proofWarning!.message).toMatch(/not a real Cloud runtime/i);
  });

  it('proof executor response includes a stub assumption', async () => {
    const { executor } = createRecordingExecutor('proof-1');
    const res = await handleCloudGenerate(
      validProofRequest(),
      { executor, generateRequestId: stableId },
    );

    const stubAssumption = res.assumptions.find((a) => a.key === 'runtime');
    expect(stubAssumption).toBeDefined();
    expect(stubAssumption!.value).toBe('stub');
  });

  it('proof executor records every call for inspection', async () => {
    const { executor, state } = createRecordingExecutor('proof-1');

    await handleCloudGenerate(validProofRequest(), { executor, generateRequestId: stableId });
    await handleCloudGenerate(validProofRequest(), { executor, generateRequestId: stableId });

    expect(state.calls).toHaveLength(2);
  });

  it('proof executor durationMs is zero – no real work performed', async () => {
    const { executor } = createRecordingExecutor('proof-1');
    const res = await handleCloudGenerate(
      validProofRequest(),
      { executor, generateRequestId: stableId },
    );

    expect(res.receipt.durationMs).toBe(0);
  });
});
