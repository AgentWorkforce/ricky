/**
 * Ricky Cloud generate proof surface.
 *
 * Proves the user-visible contract of the Cloud generate endpoint:
 * - Request validation rejects missing auth, workspace, and spec
 * - Successful generate response includes artifacts, warnings, follow-up actions, and request ID
 * - Explicit auth/workspace context is passed through to the executor
 * - The default executor is honest about being a stubbed runtime seam
 *
 * Each proof case is deterministic and bounded — no network, no Cloud runtime,
 * no non-determinism. Evidence is user-visible text, not implementation trivia.
 */

import type {
  CloudExecutor,
  CloudGenerateRequest,
  CloudGenerateResult,
} from '../index';
import { handleCloudGenerate } from '../index';

// ---------------------------------------------------------------------------
// Proof types
// ---------------------------------------------------------------------------

export type ProofCaseName =
  | 'missing-auth-rejection'
  | 'missing-workspace-rejection'
  | 'missing-spec-rejection'
  | 'success-response-shape'
  | 'empty-executor-response'
  | 'auth-context-passthrough'
  | 'workspace-context-passthrough'
  | 'spec-and-options-passthrough'
  | 'stubbed-executor-honesty'
  | 'executor-error-path';

export interface CloudProofCase {
  name: ProofCaseName;
  description: string;
  evaluate: () => Promise<CloudProofResult>;
}

export interface CloudProofResult {
  name: string;
  passed: boolean;
  evidence: string[];
  gaps: string[];
  failures: string[];
}

export interface CloudProofSummary {
  passed: boolean;
  failures: string[];
  gaps: string[];
}

// ---------------------------------------------------------------------------
// Test helpers — deterministic fakes
// ---------------------------------------------------------------------------

/** Deterministic request ID for all proof assertions. */
const PROOF_REQUEST_ID = 'ricky-cloud-proof-000';

function proofOptions(executor?: CloudExecutor) {
  return {
    executor,
    requestIdFactory: () => PROOF_REQUEST_ID,
  };
}

/** A valid, minimal Cloud generate request. */
function validRequest(overrides?: Partial<CloudGenerateRequest>): CloudGenerateRequest {
  return {
    auth: { token: 'proof-token-abc' },
    workspace: { workspaceId: 'ws-proof-001' },
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

// ---------------------------------------------------------------------------
// Evidence helpers
// ---------------------------------------------------------------------------

function result(
  name: ProofCaseName,
  checks: boolean[],
  evidence: string[],
  gaps: string[] = [],
  failures: string[] = [],
): CloudProofResult {
  return {
    name,
    passed: checks.every(Boolean) && failures.length === 0,
    evidence,
    gaps,
    failures,
  };
}

// ---------------------------------------------------------------------------
// Proof cases
// ---------------------------------------------------------------------------

export function getCloudProofCases(): CloudProofCase[] {
  return [
    // --- Validation ---
    {
      name: 'missing-auth-rejection',
      description: 'Requests with missing or empty auth token are rejected with 401.',
      async evaluate() {
        const response = await handleCloudGenerate(
          validRequest({ auth: { token: '' } }),
          proofOptions(),
        );

        const checks = [
          response.ok === false,
          response.status === 401,
          response.warnings.length > 0,
          response.warnings[0].severity === 'error',
          response.warnings[0].message.includes('auth token'),
          response.artifacts.length === 0,
          response.requestId === PROOF_REQUEST_ID,
        ];

        return result('missing-auth-rejection', checks, [
          `ok: ${response.ok}`,
          `status: ${response.status}`,
          `warning severity: ${response.warnings[0]?.severity}`,
          `warning message: ${response.warnings[0]?.message}`,
          `artifacts: ${response.artifacts.length}`,
          `requestId: ${response.requestId}`,
        ]);
      },
    },
    {
      name: 'missing-workspace-rejection',
      description: 'Requests with missing or empty workspace ID are rejected with 400.',
      async evaluate() {
        const response = await handleCloudGenerate(
          validRequest({ workspace: { workspaceId: '' } }),
          proofOptions(),
        );

        const checks = [
          response.ok === false,
          response.status === 400,
          response.warnings[0].severity === 'error',
          response.warnings[0].message.includes('workspace ID'),
          response.artifacts.length === 0,
          response.requestId === PROOF_REQUEST_ID,
        ];

        return result('missing-workspace-rejection', checks, [
          `ok: ${response.ok}`,
          `status: ${response.status}`,
          `warning message: ${response.warnings[0]?.message}`,
          `requestId: ${response.requestId}`,
        ]);
      },
    },
    {
      name: 'missing-spec-rejection',
      description: 'Requests with missing or empty spec are rejected with 400.',
      async evaluate() {
        const response = await handleCloudGenerate(
          validRequest({ body: { spec: '' } }),
          proofOptions(),
        );

        const checks = [
          response.ok === false,
          response.status === 400,
          response.warnings[0].severity === 'error',
          response.warnings[0].message.includes('spec'),
          response.artifacts.length === 0,
          response.requestId === PROOF_REQUEST_ID,
        ];

        return result('missing-spec-rejection', checks, [
          `ok: ${response.ok}`,
          `status: ${response.status}`,
          `warning message: ${response.warnings[0]?.message}`,
          `requestId: ${response.requestId}`,
        ]);
      },
    },

    // --- Successful response shape ---
    {
      name: 'success-response-shape',
      description: 'Successful generate returns ok=true, 200, with artifacts, warnings, follow-up actions, and request ID.',
      async evaluate() {
        const executor = mockExecutor({
          artifacts: [{ path: 'out/workflow.ts', type: 'text/typescript', content: '// generated' }],
          warnings: [{ severity: 'info', message: 'Assumed default region.' }],
          followUpActions: [{ action: 'deploy', label: 'Deploy', description: 'Deploy the workflow.' }],
        });

        const response = await handleCloudGenerate(validRequest(), proofOptions(executor));

        const checks = [
          response.ok === true,
          response.status === 200,
          response.artifacts.length === 1,
          response.artifacts[0].path === 'out/workflow.ts',
          response.artifacts[0].type === 'text/typescript',
          response.artifacts[0].content === '// generated',
          response.warnings.length === 1,
          response.warnings[0].severity === 'info',
          response.warnings[0].message === 'Assumed default region.',
          response.followUpActions.length === 1,
          response.followUpActions[0].action === 'deploy',
          response.followUpActions[0].label === 'Deploy',
          response.requestId === PROOF_REQUEST_ID,
        ];

        return result('success-response-shape', checks, [
          `ok: ${response.ok}`,
          `status: ${response.status}`,
          `artifact count: ${response.artifacts.length}`,
          `artifact path: ${response.artifacts[0]?.path}`,
          `artifact type: ${response.artifacts[0]?.type}`,
          `warning count: ${response.warnings.length}`,
          `warning: ${response.warnings[0]?.message}`,
          `follow-up action count: ${response.followUpActions.length}`,
          `follow-up action: ${response.followUpActions[0]?.action}`,
          `requestId: ${response.requestId}`,
        ]);
      },
    },
    {
      name: 'empty-executor-response',
      description: 'When executor returns empty arrays, response still has correct shape with ok=true and 200.',
      async evaluate() {
        const executor = mockExecutor();
        const response = await handleCloudGenerate(validRequest(), proofOptions(executor));

        const checks = [
          response.ok === true,
          response.status === 200,
          response.artifacts.length === 0,
          response.warnings.length === 0,
          response.followUpActions.length === 0,
          response.requestId === PROOF_REQUEST_ID,
        ];

        return result('empty-executor-response', checks, [
          `ok: ${response.ok}`,
          `status: ${response.status}`,
          `artifacts: ${response.artifacts.length}`,
          `warnings: ${response.warnings.length}`,
          `followUpActions: ${response.followUpActions.length}`,
          `requestId: ${response.requestId}`,
        ]);
      },
    },

    // --- Context passthrough ---
    {
      name: 'auth-context-passthrough',
      description: 'Auth token and token type are passed through verbatim to the executor.',
      async evaluate() {
        const executor = mockExecutor();
        await handleCloudGenerate(
          validRequest({
            auth: { token: 'explicit-bearer-token', tokenType: 'api-key' },
          }),
          proofOptions(executor),
        );

        const req = executor.calls[0];
        const checks = [
          executor.calls.length === 1,
          req.auth.token === 'explicit-bearer-token',
          req.auth.tokenType === 'api-key',
        ];

        return result('auth-context-passthrough', checks, [
          `executor calls: ${executor.calls.length}`,
          `auth token: ${req?.auth.token}`,
          `auth tokenType: ${req?.auth.tokenType}`,
        ]);
      },
    },
    {
      name: 'workspace-context-passthrough',
      description: 'Workspace ID and environment are passed through verbatim to the executor.',
      async evaluate() {
        const executor = mockExecutor();
        await handleCloudGenerate(
          validRequest({
            workspace: { workspaceId: 'ws-prod-42', environment: 'production' },
          }),
          proofOptions(executor),
        );

        const req = executor.calls[0];
        const checks = [
          executor.calls.length === 1,
          req.workspace.workspaceId === 'ws-prod-42',
          req.workspace.environment === 'production',
        ];

        return result('workspace-context-passthrough', checks, [
          `executor calls: ${executor.calls.length}`,
          `workspace ID: ${req?.workspace.workspaceId}`,
          `workspace environment: ${req?.workspace.environment}`,
        ]);
      },
    },
    {
      name: 'spec-and-options-passthrough',
      description: 'Spec, specPath, mode, and metadata are passed through verbatim to the executor.',
      async evaluate() {
        const executor = mockExecutor();
        await handleCloudGenerate(
          validRequest({
            body: {
              spec: 'deploy service',
              specPath: '/specs/deploy.md',
              mode: 'both',
              metadata: { origin: 'dashboard' },
            },
          }),
          proofOptions(executor),
        );

        const req = executor.calls[0];
        const checks = [
          req.body.spec === 'deploy service',
          req.body.specPath === '/specs/deploy.md',
          req.body.mode === 'both',
          JSON.stringify(req.body.metadata) === JSON.stringify({ origin: 'dashboard' }),
        ];

        return result('spec-and-options-passthrough', checks, [
          `spec: ${req?.body.spec}`,
          `specPath: ${req?.body.specPath}`,
          `mode: ${req?.body.mode}`,
          `metadata: ${JSON.stringify(req?.body.metadata)}`,
        ]);
      },
    },

    // --- Executor honesty ---
    {
      name: 'stubbed-executor-honesty',
      description:
        'The default executor is honest about being a stub — warnings mention the stub, ' +
        'follow-up actions tell the caller to wire the real runtime.',
      async evaluate() {
        const response = await handleCloudGenerate(validRequest(), {
          requestIdFactory: () => PROOF_REQUEST_ID,
        });

        const warningsText = response.warnings.map((w) => w.message).join('\n');
        const actionsText = response.followUpActions.map((a) => `${a.action}: ${a.label}`).join('\n');
        const checks = [
          response.ok === true,
          response.status === 200,
          warningsText.includes('stub'),
          response.followUpActions.some((a) => a.action === 'wire-runtime'),
        ];

        return result('stubbed-executor-honesty', checks, [
          `ok: ${response.ok}`,
          `status: ${response.status}`,
          `warnings mention stub: ${warningsText.includes('stub')}`,
          `follow-up actions include wire-runtime: ${response.followUpActions.some((a) => a.action === 'wire-runtime')}`,
          `warnings: ${warningsText}`,
          `follow-up actions: ${actionsText}`,
        ]);
      },
    },

    // --- Error path ---
    {
      name: 'executor-error-path',
      description: 'When the executor throws, the response is ok=false, 500, with error details and retry action.',
      async evaluate() {
        const failingExecutor: CloudExecutor = {
          async generate(): Promise<CloudGenerateResult> {
            throw new Error('Cloud runtime unavailable');
          },
        };
        const response = await handleCloudGenerate(validRequest(), proofOptions(failingExecutor));

        const checks = [
          response.ok === false,
          response.status === 500,
          response.warnings.length > 0,
          response.warnings[0].severity === 'error',
          response.warnings[0].message.includes('Cloud runtime unavailable'),
          response.followUpActions.some((a) => a.action === 'retry'),
          response.requestId === PROOF_REQUEST_ID,
        ];

        return result('executor-error-path', checks, [
          `ok: ${response.ok}`,
          `status: ${response.status}`,
          `warning severity: ${response.warnings[0]?.severity}`,
          `warning message: ${response.warnings[0]?.message}`,
          `retry action present: ${response.followUpActions.some((a) => a.action === 'retry')}`,
          `requestId: ${response.requestId}`,
        ]);
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Evaluation API
// ---------------------------------------------------------------------------

export async function evaluateCloudProof(): Promise<CloudProofResult[]> {
  const cases = getCloudProofCases();
  const results: CloudProofResult[] = [];
  for (const proofCase of cases) {
    results.push(await proofCase.evaluate());
  }
  return results;
}

export async function evaluateCloudProofCase(name: ProofCaseName): Promise<CloudProofResult> {
  const proofCase = getCloudProofCases().find((candidate) => candidate.name === name);
  if (!proofCase) {
    throw new Error(`Unknown cloud proof case: ${name}`);
  }
  return proofCase.evaluate();
}

export async function summarizeCloudProof(): Promise<CloudProofSummary> {
  const results = await evaluateCloudProof();
  const failures = results.flatMap((r) =>
    r.passed ? [] : [`${r.name}: ${r.failures.join('; ') || 'contract assertion failed'}`],
  );
  const gaps = results.flatMap((r) => r.gaps.map((gap) => `${r.name}: ${gap}`));

  return {
    passed: failures.length === 0,
    failures,
    gaps,
  };
}
