import { describe, expect, it } from 'vitest';

import { intake, normalizeSpec, parseSpec, routeSpec } from './index.js';
import type { RawSpecPayload, RoutingDecision } from './types.js';

const RECEIVED_AT = '2026-04-26T00:00:00.000Z';

function natural(text: string, surface: RawSpecPayload['surface'] = 'cli'): RawSpecPayload {
  return {
    kind: 'natural_language',
    surface,
    receivedAt: RECEIVED_AT,
    requestId: `${surface}-request`,
    text,
  };
}

function routeThroughStages(payload: RawSpecPayload): RoutingDecision {
  const parsed = parseSpec(payload);
  const { normalized, issues } = normalizeSpec(parsed);
  return routeSpec(normalized, issues);
}

describe('spec intake parser, normalizer, and router', () => {
  it('routes Claude handoff text with workflow intent to generate without requiring a hand-authored workflow file', () => {
    const payload = natural(
      [
        'Claude handoff: create a new workflow spec for release readiness.',
        'Goal: generate coordinated validation for package, typecheck, and tests.',
        'Do not assume the user has already authored a workflow file.',
      ].join('\n'),
      'claude_handoff',
    );
    const result = intake(payload);
    const stagedRouting = routeThroughStages(payload);

    expect(result.success).toBe(true);
    expect(result.routing?.target).toBe('generate');
    expect(stagedRouting.target).toBe('generate');
    expect(stagedRouting.normalizedSpec.sourceSpec.intent.primary).toBe('generate');
    expect(stagedRouting.normalizedSpec.desiredAction.workflowFileHint).toBeUndefined();
    expect(result.routing?.normalizedSpec.intent).toBe('generate');
    expect(result.routing?.normalizedSpec.sourceSpec.intent.primary).toBe('generate');
    expect(result.routing?.normalizedSpec.desiredAction.kind).toBe('generate');
    expect(result.routing?.reason).toContain('author a new workflow');
    expect(result.routing?.normalizedSpec.desiredAction.specText).toContain('create a new workflow spec');
    expect(result.routing?.normalizedSpec.desiredAction.workflowFileHint).toBeUndefined();
    expect(result.routing?.normalizedSpec.targetFiles).toEqual([]);
    expect(result.routing?.normalizedSpec.providerContext.surface).toBe('claude_handoff');
    expect(result.routing?.normalizedSpec.providerContext.surfaceLabel).toBe('Claude handoff');
    expect(result.routing?.normalizedSpec.sourceSpec.rawPayload.kind).toBe('natural_language');
  });

  it('normalizes CLI natural-language constraints and acceptance gates', () => {
    const payload = natural(
      [
        'Build a workflow for repo AgentWorkforce/ricky to verify the local runtime.',
        'Must only modify src/runtime/local-coordinator.ts.',
        'Do not call external services.',
        'Acceptance: npm test exits 0.',
        'Gate: deterministic routing proof is recorded.',
      ].join('\n'),
    );
    const result = intake(payload);
    const stagedRouting = routeThroughStages(payload);

    expect(result.success).toBe(true);
    expect(result.routing?.target).toBe('generate');
    expect(stagedRouting.target).toBe('generate');
    expect(result.routing?.normalizedSpec.sourceSpec.intent.primary).toBe('generate');
    expect(stagedRouting.normalizedSpec.sourceSpec.intent.primary).toBe('generate');
    expect(result.routing?.normalizedSpec.targetRepo).toBe('AgentWorkforce/ricky');
    expect(result.routing?.normalizedSpec.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          constraint: 'Must only modify src/runtime/local-coordinator.ts.',
          category: 'scope',
        }),
        expect.objectContaining({
          constraint: 'Do not call external services.',
        }),
      ]),
    );
    expect(result.routing?.normalizedSpec.acceptanceGates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ gate: 'npm test exits 0.', kind: 'deterministic' }),
        expect.objectContaining({ gate: 'deterministic routing proof is recorded.', kind: 'deterministic' }),
      ]),
    );
    expect(stagedRouting.normalizedSpec.constraints).toEqual(result.routing?.normalizedSpec.constraints);
    expect(stagedRouting.normalizedSpec.acceptanceGates).toEqual(result.routing?.normalizedSpec.acceptanceGates);
    expect(result.routing?.normalizedSpec.desiredAction.workflowFileHint).toBeUndefined();
  });

  it('preserves out-of-scope sections as non-goal scope constraints', () => {
    const result = intake(
      natural(
        [
          'Generate a workflow for AgentWorkforce/ricky.',
          '',
          '## Out of scope',
          '',
          '- Passive Linear comment monitoring',
          '- Custom per-repo workflow templates',
        ].join('\n'),
      ),
    );

    expect(result.success).toBe(true);
    expect(result.routing?.normalizedSpec.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          constraint: 'Non-goal: Passive Linear comment monitoring',
          category: 'scope',
        }),
        expect.objectContaining({
          constraint: 'Non-goal: Custom per-repo workflow templates',
          category: 'scope',
        }),
      ]),
    );
  });

  it('preserves plain non-goal headings as scope constraints', () => {
    const result = intake(
      natural(
        [
          'Generate a workflow for AgentWorkforce/ricky.',
          '',
          'Non-goals:',
          '',
          '- Broad dashboard changes',
          '- Passive Linear monitoring',
        ].join('\n'),
      ),
    );

    expect(result.success).toBe(true);
    expect(result.routing?.normalizedSpec.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          constraint: 'Non-goal: Broad dashboard changes',
          category: 'scope',
        }),
        expect.objectContaining({
          constraint: 'Non-goal: Passive Linear monitoring',
          category: 'scope',
        }),
      ]),
    );
  });

  it('preserves MCP-style structured payload source and provider context', () => {
    const payload: RawSpecPayload = {
      kind: 'mcp',
      surface: 'mcp',
      receivedAt: RECEIVED_AT,
      requestId: 'mcp-request',
      toolName: 'ricky.workflow.generate',
      metadata: { origin: 'relaycast' },
      arguments: {
        provider: 'claude',
        channel: 'wf-ricky-wave2',
        threadId: 'thread-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        spec: {
          description: 'Generate a workflow that triages flaky test evidence.',
          targetRepo: 'AgentWorkforce/ricky',
          context: 'product spec intake',
          constraints: [
            { constraint: 'Only use deterministic local checks.' },
            { requirement: 'Do not call external services.' },
          ],
          evidence: [{ requirement: 'Output contains SPEC_INTAKE_READY.' }],
          acceptanceGates: [{ gate: 'npm test exits 0' }],
        },
      },
    };

    const result = intake(payload);
    const stagedRouting = routeThroughStages(payload);
    const normalized = result.routing?.normalizedSpec;

    expect(result.success).toBe(true);
    expect(result.routing?.target).toBe('generate');
    expect(stagedRouting.target).toBe('generate');
    expect(normalized?.sourceSpec.intent.signals).toContain('tool:ricky.workflow.generate');
    expect(stagedRouting.normalizedSpec.sourceSpec.intent.signals).toContain('tool:ricky.workflow.generate');
    expect(normalized?.providerContext).toMatchObject({
      surface: 'mcp',
      toolName: 'ricky.workflow.generate',
      provider: 'claude',
      channel: 'wf-ricky-wave2',
      threadId: 'thread-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      requestId: 'mcp-request',
      metadata: { origin: 'relaycast' },
    });
    expect(stagedRouting.normalizedSpec.providerContext).toMatchObject(normalized?.providerContext ?? {});
    expect(normalized?.sourceSpec.rawPayload).toBe(payload);
    expect(normalized?.sourceSpec.surface).toBe('mcp');
    expect(normalized?.sourceSpec.providerContext.requestId).toBe('mcp-request');
    expect(normalized?.targetContext).toBe('product spec intake');
    expect(normalized?.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ constraint: 'Only use deterministic local checks.', category: 'scope' }),
        expect.objectContaining({ constraint: 'Do not call external services.', category: 'other' }),
      ]),
    );
    expect(normalized?.evidenceRequirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requirement: 'Output contains SPEC_INTAKE_READY.',
          verificationType: 'output_contains',
        }),
      ]),
    );
    expect(normalized?.acceptanceGates).toEqual(
      expect.arrayContaining([expect.objectContaining({ gate: 'npm test exits 0', kind: 'deterministic' })]),
    );
  });

  it('routes failed-run evidence to debug', () => {
    const payload = natural(
      [
        'Debug the failed workflow run id run-123 for workflows/release.workflow.ts.',
        'Evidence: stdout contains a stack trace stored at artifacts/run-123.log.',
        'Verification: explain the failure and identify the failing step.',
      ].join('\n'),
    );
    const result = intake(payload);
    const stagedRouting = routeThroughStages(payload);

    expect(result.success).toBe(true);
    expect(result.routing?.target).toBe('debug');
    expect(stagedRouting.target).toBe('debug');
    expect(result.routing?.normalizedSpec.intent).toBe('debug');
    expect(stagedRouting.normalizedSpec.intent).toBe('debug');
    expect(result.routing?.normalizedSpec.sourceSpec.intent.primary).toBe('debug');
    expect(result.routing?.normalizedSpec.targetFiles).toEqual(
      expect.arrayContaining(['workflows/release.workflow.ts', 'artifacts/run-123.log']),
    );
    expect(result.routing?.normalizedSpec.evidenceRequirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requirement: expect.stringContaining('stdout contains a stack trace'),
          verificationType: 'output_contains',
        }),
      ]),
    );
  });

  it('routes ready artifact requests to execute', () => {
    const payload = natural('Run the ready artifact workflows/release.workflow.ts for the current repository.');
    const result = intake(payload);
    const stagedRouting = routeThroughStages(payload);

    expect(result.success).toBe(true);
    expect(result.routing?.target).toBe('execute');
    expect(stagedRouting.target).toBe('execute');
    expect(result.routing?.normalizedSpec.intent).toBe('execute');
    expect(stagedRouting.normalizedSpec.intent).toBe('execute');
    expect(result.routing?.normalizedSpec.sourceSpec.intent.primary).toBe('execute');
    expect(result.routing?.normalizedSpec.desiredAction.workflowFileHint).toBe('workflows/release.workflow.ts');
    expect(stagedRouting.normalizedSpec.desiredAction.workflowFileHint).toBe('workflows/release.workflow.ts');
    expect(result.routing?.reason).toContain('executable workflow artifact');
  });

  it('routes failure-named ready workflow artifacts to execute when no failed-run evidence exists', () => {
    const result = intake(
      natural('Run the ready artifact workflows/failure-analysis.workflow.ts for the current repository.'),
    );

    expect(result.success).toBe(true);
    expect(result.routing?.target).toBe('execute');
    expect(result.routing?.normalizedSpec.intent).toBe('execute');
    expect(result.routing?.normalizedSpec.desiredAction.workflowFileHint).toBe('workflows/failure-analysis.workflow.ts');
  });

  it('keeps structured execute requests on execute even when artifact paths contain failure vocabulary', () => {
    const result = intake({
      kind: 'structured_json',
      surface: 'api',
      receivedAt: RECEIVED_AT,
      requestId: 'api-execute-failure-artifact',
      data: {
        intent: 'execute',
        description: 'Run the ready artifact workflows/failure-analysis.workflow.ts for the current repository.',
        artifactPath: 'workflows/failure-analysis.workflow.ts',
      },
    });

    expect(result.success).toBe(true);
    expect(result.routing?.target).toBe('execute');
    expect(result.routing?.normalizedSpec.intent).toBe('execute');
    expect(result.routing?.normalizedSpec.desiredAction.workflowFileHint).toBe('workflows/failure-analysis.workflow.ts');
  });

  it('excludes repository slugs from targetFiles', () => {
    const result = intake(
      natural('Build a workflow for repo AgentWorkforce/ricky to verify the local runtime.'),
    );

    expect(result.routing?.normalizedSpec.targetRepo).toBe('AgentWorkforce/ricky');
    expect(result.routing?.normalizedSpec.targetFiles).not.toContain('AgentWorkforce/ricky');
  });

  it('preserves two-segment directory targets when a target repo is present', () => {
    const result = intake(
      natural(
        'Build a workflow for repo AgentWorkforce/ricky. Only touch workflows/wave2-product.',
      ),
    );

    expect(result.routing?.normalizedSpec.targetRepo).toBe('AgentWorkforce/ricky');
    expect(result.routing?.normalizedSpec.targetFiles).toContain('workflows/wave2-product');
    expect(result.routing?.normalizedSpec.targetFiles).not.toContain('AgentWorkforce/ricky');
  });

  it('routes structured generation specs containing a logs evidence field to generate, not debug', () => {
    const result = intake({
      kind: 'structured_json',
      surface: 'api',
      receivedAt: RECEIVED_AT,
      requestId: 'api-generate-with-logs-evidence',
      data: {
        spec: {
          description: 'Generate a workflow that captures logs after validation steps.',
          logs: ['Record generated workflow logs as evidence.'],
        },
      },
    });

    expect(result.success).toBe(true);
    expect(result.routing?.target).toBe('generate');
    expect(result.routing?.normalizedSpec.intent).toBe('generate');
    expect(result.routing?.normalizedSpec.sourceSpec.intent.primary).toBe('generate');
  });

  it('treats workflow path fields as generation hints when the request text still asks to generate', () => {
    const result = intake({
      kind: 'structured_json',
      surface: 'api',
      receivedAt: RECEIVED_AT,
      requestId: 'api-generate-with-workflow-path-hint',
      data: {
        spec: {
          description: 'Generate a local workflow for packages/local/src/entrypoint.ts',
          workflowFile: 'workflows/local-cli.workflow.ts',
        },
      },
    });

    expect(result.success).toBe(true);
    expect(result.routing?.target).toBe('generate');
    expect(result.routing?.normalizedSpec.intent).toBe('generate');
    expect(result.routing?.normalizedSpec.sourceSpec.intent.primary).toBe('generate');
    expect(result.routing?.normalizedSpec.desiredAction.workflowFileHint).toBe('workflows/local-cli.workflow.ts');
  });

  it('routes structured generation specs whose requiredEvidence mentions logs to generate, not debug', () => {
    const result = intake({
      kind: 'structured_json',
      surface: 'api',
      receivedAt: RECEIVED_AT,
      requestId: 'api-generate-required-evidence-logs',
      data: {
        spec: {
          description: 'Generate a workflow that emits structured logs and verifies them.',
          requiredEvidence: ['logs at .workflow-artifacts/run.log', 'stdout contains DONE'],
        },
      },
    });

    expect(result.success).toBe(true);
    expect(result.routing?.target).toBe('generate');
    expect(result.routing?.normalizedSpec.intent).toBe('generate');
  });

  it('still routes structured payloads with strong failure signals (failedRunId) to debug', () => {
    const result = intake({
      kind: 'structured_json',
      surface: 'api',
      receivedAt: RECEIVED_AT,
      requestId: 'api-debug-failed-run',
      data: {
        spec: {
          description: 'Investigate failure for the workflow run.',
          failedRunId: 'run-789',
          logs: ['stack trace lines redacted'],
        },
      },
    });

    expect(result.routing?.target).toBe('debug');
    expect(result.routing?.normalizedSpec.intent).toBe('debug');
  });

  it('does not treat arbitrary .ts files as workflow file hints', () => {
    const result = intake(
      natural('Run src/runtime/local-coordinator.ts for the current repository.'),
    );

    expect(result.routing?.normalizedSpec.desiredAction.workflowFileHint).toBeUndefined();
    // Without a recognized workflow artifact, execute degrades to clarify
    expect(result.routing?.target).toBe('clarify');
  });

  it('surfaces route-blocking clarify reason in validationIssues for debug without evidence', () => {
    const result = intake(natural('Debug this workflow'));

    expect(result.success).toBe(false);
    expect(result.routing?.target).toBe('clarify');
    expect(result.routing?.reason).toContain('failed-run evidence');
    expect(result.validationIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'warning',
          field: 'routing',
          message: expect.stringContaining('failed-run evidence'),
        }),
      ]),
    );
  });

  it('maps ricky.workflow.coordinate MCP tool to coordinate intent', () => {
    const result = intake({
      kind: 'mcp',
      surface: 'mcp',
      receivedAt: RECEIVED_AT,
      requestId: 'mcp-coord',
      toolName: 'ricky.workflow.coordinate',
      arguments: { description: 'Orchestrate agents across repos' },
    });

    expect(result.routing?.target).toBe('coordinate');
    expect(result.routing?.normalizedSpec.intent).toBe('coordinate');
  });

  it('routes generate requests about failure/error topics to generate, not debug', () => {
    const cases = [
      'Generate a workflow that classifies TypeScript error output and records evidence artifacts.',
      'Create a workflow for failure analysis reports.',
      'Build a workflow to collect logs after failed steps.',
      'Write a new workflow that detects timeout patterns in CI.',
    ];

    for (const text of cases) {
      const result = intake(natural(text));
      expect(result.routing?.target, `Expected generate for: "${text}"`).toBe('generate');
      expect(result.routing?.normalizedSpec.intent, `Expected generate intent for: "${text}"`).toBe('generate');
    }
  });

  it('still routes actual failure debugging to debug even with generate-adjacent vocabulary', () => {
    const result = intake(
      natural('Fix the failed workflow run id run-456. Stack trace is in the logs.'),
    );

    expect(result.routing?.target).toBe('debug');
    expect(result.routing?.normalizedSpec.intent).toBe('debug');
  });

  it('returns clarify for ambiguous input with actionable missing fields', () => {
    const payload = natural('Can you help me figure out the next thing?');
    const result = intake(payload);
    const stagedRouting = routeThroughStages(payload);

    expect(result.success).toBe(false);
    expect(result.routing?.target).toBe('clarify');
    expect(stagedRouting.target).toBe('clarify');
    expect(result.routing?.normalizedSpec.intent).toBe('clarify');
    expect(stagedRouting.normalizedSpec.intent).toBe('clarify');
    expect(result.routing?.normalizedSpec.sourceSpec.intent.primary).toBe('clarify');
    expect(result.routing?.reason).toContain('ambiguous');
    expect(result.validationIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'warning',
          field: 'intent',
          suggestion: expect.stringContaining('workflow goal or target artifact'),
        }),
      ]),
    );
    expect(result.validationIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'intent',
          message: expect.stringContaining('ambiguous'),
          suggestion: expect.stringContaining('workflow goal or target artifact'),
        }),
      ]),
    );
    expect(result.routing?.suggestedFollowUp).toContain('generate, debug, coordinate, or execute');
    expect(result.routing?.suggestedFollowUp).toContain('target context');
  });

  it('returns structured clarification questions for explicit open questions in generation specs', () => {
    const result = intake(
      natural(
        [
          'Generate a workflow for package validation.',
          '',
          'Open questions:',
          '- Should it validate package A or package B?',
          '- Who signs off the final review?',
        ].join('\n'),
      ),
    );

    expect(result.success).toBe(false);
    expect(result.routing?.target).toBe('clarify');
    expect(result.clarificationQuestions).toEqual([
      expect.objectContaining({
        id: 'open-question-1',
        question: 'Should it validate package A or package B?',
        blocking: true,
      }),
      expect.objectContaining({
        id: 'open-question-2',
        question: 'Who signs off the final review?',
        blocking: true,
      }),
    ]);
    expect(result.routing?.clarificationQuestions).toHaveLength(2);
    expect(result.routing?.suggestedFollowUp).toContain('structured clarification questions');
  });

  it('turns unresolved open-question bullets into concrete clarification questions', () => {
    const result = intake(
      natural(
        [
          'Generate a workflow for Slack migration.',
          '',
          'Open questions:',
          '- TBD: choose direct Slack OAuth or Nango provider credentials',
          '- Unclear: who owns final rollout signoff',
        ].join('\n'),
      ),
    );

    expect(result.success).toBe(false);
    expect(result.clarificationQuestions).toEqual([
      expect.objectContaining({
        id: 'open-question-1',
        question: 'Please clarify: choose direct Slack OAuth or Nango provider credentials?',
        blocking: true,
      }),
      expect.objectContaining({
        id: 'open-question-2',
        question: 'Please clarify: who owns final rollout signoff?',
        blocking: true,
      }),
    ]);
  });

  it('treats appended clarification answers as resolving explicit open-question markers', () => {
    const result = intake(
      natural(
        [
          'Generate a workflow for Slack migration.',
          '',
          'Open questions:',
          '- TBD: choose direct Slack OAuth or Nango provider credentials',
          '',
          'Clarification answers:',
          '- Please clarify: choose direct Slack OAuth or Nango provider credentials?: Use Nango provider credentials.',
        ].join('\n'),
      ),
    );

    expect(result.clarificationQuestions).toEqual([]);
    expect(result.routing?.target).toBe('generate');
  });

  it('keeps asking for unresolved questions when clarification answers are partial', () => {
    const result = intake(
      natural(
        [
          'Generate a workflow for Slack migration.',
          '',
          'Open questions:',
          '- TBD: choose direct Slack OAuth or Nango provider credentials',
          '- Unclear: who owns final rollout signoff',
          '',
          'Clarification answers:',
          '- Please clarify: choose direct Slack OAuth or Nango provider credentials?: Use Nango provider credentials.',
        ].join('\n'),
      ),
    );

    expect(result.success).toBe(false);
    expect(result.clarificationQuestions).toEqual([
      expect.objectContaining({
        id: 'open-question-1',
        question: 'Please clarify: who owns final rollout signoff?',
        blocking: true,
      }),
    ]);
  });

  it('asks for execution clarification when a generation spec mixes local and cloud execution', () => {
    const result = intake(
      natural('Generate a workflow for repo AgentWorkforce/ricky that supports local BYOH and cloud hosted execution.'),
    );

    expect(result.success).toBe(false);
    expect(result.routing?.target).toBe('clarify');
    expect(result.routing?.normalizedSpec.executionPreference).toBe('auto');
    expect(result.clarificationQuestions).toEqual([
      expect.objectContaining({
        id: 'execution-mode-conflict',
        question: expect.stringContaining('run locally/BYOH, in Cloud, or generate artifacts for both paths'),
        blocking: true,
      }),
    ]);
  });

  it('lets explicit CLI local mode override mixed local and cloud spec text', () => {
    const result = intake({
      kind: 'structured_json',
      surface: 'cli',
      receivedAt: new Date().toISOString(),
      metadata: { mode: 'local' },
      data: {
        intent: 'generate',
        description: 'Generate a workflow for a primitive that supports local BYOH and Cloud hosted execution.',
      },
    });

    expect(result.success).toBe(true);
    expect(result.routing?.target).toBe('generate');
    expect(result.routing?.normalizedSpec.executionPreference).toBe('local');
    expect(result.clarificationQuestions).toEqual([]);
  });

  it('treats interactive execution-mode answers as resolving the conflict', () => {
    const result = intake(
      natural(
        [
          'Generate a workflow for a primitive that supports local BYOH and Cloud hosted execution.',
          '',
          'Clarification answers:',
          '- Should this workflow run locally/BYOH, in Cloud, or generate artifacts for both paths?: locally',
        ].join('\n'),
      ),
    );

    expect(result.success).toBe(true);
    expect(result.routing?.target).toBe('generate');
    expect(result.routing?.normalizedSpec.executionPreference).toBe('local');
    expect(result.clarificationQuestions).toEqual([]);
  });

  it('asks for a side-effect boundary before generating risky workflows', () => {
    const result = intake(
      natural('Generate a workflow that deletes obsolete files, commits the cleanup, and pushes the branch.'),
    );

    expect(result.success).toBe(false);
    expect(result.routing?.target).toBe('clarify');
    expect(result.clarificationQuestions).toEqual([
      expect.objectContaining({
        id: 'side-effect-approval',
        question: expect.stringContaining('Which side effects'),
        blocking: true,
      }),
    ]);
  });

  describe('targetFiles extraction (AST-driven)', () => {
    it('captures backticked paths from markdown prose via inlineCode nodes', () => {
      const result = intake(
        natural(
          [
            'Implementation plan:',
            '- Update `packages/web/app/api/v1/workflows/run/route.ts` to accept the new mode.',
            '- Update `packages/core/src/bootstrap/launcher.ts` to provision a sandbox.',
          ].join('\n'),
        ),
      );
      const targets = result.routing?.normalizedSpec.targetFiles ?? [];
      expect(targets).toEqual(
        expect.arrayContaining([
          'packages/web/app/api/v1/workflows/run/route.ts',
          'packages/core/src/bootstrap/launcher.ts',
        ]),
      );
    });

    it('does not capture paths inside fenced code blocks', () => {
      const result = intake(
        natural(
          [
            'Edit `packages/web/route.ts` to fix the bug.',
            '',
            'The current code looks like:',
            '',
            '```ts',
            'import { foo } from "packages/legacy/old-helper.ts";',
            'export const bar = "examples/sample/path.json";',
            '```',
            '',
            'Replace it.',
          ].join('\n'),
        ),
      );
      const targets = result.routing?.normalizedSpec.targetFiles ?? [];
      expect(targets).toContain('packages/web/route.ts');
      expect(targets).not.toContain('packages/legacy/old-helper.ts');
      expect(targets).not.toContain('examples/sample/path.json');
    });

    it('suppresses backticked tokens that are not paths (git refs, type names)', () => {
      const result = intake(
        natural(
          [
            'Touch `packages/web/route.ts` and rebase onto `git/main`.',
            'The new type `MsdRelayReviewArtifact` lives in `packages/core/types.ts`.',
          ].join('\n'),
        ),
      );
      const targets = result.routing?.normalizedSpec.targetFiles ?? [];
      expect(targets).toContain('packages/web/route.ts');
      expect(targets).toContain('packages/core/types.ts');
      // `git/main` has 2 segments, no extension, no recognized prefix → filtered.
      expect(targets).not.toContain('git/main');
      // `MsdRelayReviewArtifact` has no slash → never considered.
      expect(targets).not.toContain('MsdRelayReviewArtifact');
    });

    it('extracts paths from a structured `## Target Files` block in priority over inline code', () => {
      const result = intake(
        natural(
          [
            '# Spec',
            'Some prose mentioning `tests/scratch/example.ts` casually.',
            '',
            '## Target Files',
            '',
            '- `packages/web/app/api/v1/workflows/run/route.ts`',
            '- packages/core/src/bootstrap/launcher.ts',
            '',
            '## Acceptance',
            'It works.',
          ].join('\n'),
        ),
      );
      const targets = result.routing?.normalizedSpec.targetFiles ?? [];
      expect(targets).toEqual([
        'packages/web/app/api/v1/workflows/run/route.ts',
        'packages/core/src/bootstrap/launcher.ts',
      ]);
      expect(targets).not.toContain('tests/scratch/example.ts');
    });

    it('honors a `### Target Files` block at any heading depth', () => {
      const result = intake(
        natural(
          [
            '## Implementation',
            '',
            '### Target Files',
            '',
            '- `packages/web/route.ts`',
            '',
            '### Tests',
            '',
            'Run vitest.',
          ].join('\n'),
        ),
      );
      const targets = result.routing?.normalizedSpec.targetFiles ?? [];
      expect(targets).toEqual(['packages/web/route.ts']);
    });

    it('falls back to inline code extraction when there is no Target Files block', () => {
      const result = intake(
        natural('Edit `packages/core/src/bootstrap/launcher.ts` to provision a sandbox.'),
      );
      const targets = result.routing?.normalizedSpec.targetFiles ?? [];
      expect(targets).toContain('packages/core/src/bootstrap/launcher.ts');
    });

    it('suppresses prose noise in non-markdown inputs via the regex fallback', () => {
      // No backticks anywhere — the AST extractor returns []. The plain-text
      // fallback then applies looksLikeRealPath to drop noise.
      const result = intake(
        natural(
          'Send the PR number, base/head SHA, and the user/account pair to MSD. ' +
            'Update packages/web/route.ts.',
        ),
      );
      const targets = result.routing?.normalizedSpec.targetFiles ?? [];
      expect(targets).toContain('packages/web/route.ts');
      expect(targets).not.toContain('base/head');
      expect(targets).not.toContain('user/account');
    });

    it('keeps deeply-nested paths without an extension (3+ segments)', () => {
      const result = intake(
        natural('Touch `packages/web/lib/nango-bridge` for the new adapter.'),
      );
      const targets = result.routing?.normalizedSpec.targetFiles ?? [];
      expect(targets).toContain('packages/web/lib/nango-bridge');
    });
  });
});
