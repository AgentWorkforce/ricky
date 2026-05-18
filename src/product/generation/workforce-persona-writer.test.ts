import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { NormalizedWorkflowSpec, RawSpecPayload } from '../spec-intake/types.js';
import { generate, generateWithWorkforcePersona } from './pipeline.js';
import type { WorkforcePersonaExecution, WorkforcePersonaResolver } from './workforce-persona-writer.js';
import {
  buildWorkflowPersonaTask,
  detectSpecIntentMismatch,
  dumpPersonaDebug,
  loadWorkforcePersonaModule,
  loadWorkforceSelectionModule,
  parsePersonaWorkflowResponse,
  resolveWorkforcePersonaContextWithModules,
  stripGlobalGithubExecutorForMixedWorkflow,
  summarizeRelevantFilesForPersona,
  summarizeSpecForPersona,
  waitForWriterWithWatchdog,
  WORKFORCE_PERSONA_INTENT_CANDIDATES,
  WorkforcePersonaWriterError,
} from './workforce-persona-writer.js';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const RECEIVED_AT = '2026-04-30T00:00:00.000Z';

describe('workforce persona workflow writer', () => {
  it('builds the one-shot persona task with spec, mode, repo, standards, contract, constraints, and evidence rules', () => {
    const task = buildWorkflowPersonaTask(spec(), {
      workflowName: 'release-health',
      targetMode: 'local',
      repoRoot: '/repo',
      outputPath: 'workflows/generated/release-health.ts',
      relevantFiles: [{ path: 'src/product/generation/pipeline.ts', content: 'export function generate() {}' }],
    });

    expect(task).toContain('Normalized spec JSON');
    expect(task).toContain('"workflowName": "release-health"');
    expect(task).toContain('"targetMode": "local"');
    expect(task).toContain('"repoRoot": "/repo"');
    expect(task).toContain('Agent Relay workflow standards');
    expect(task).toContain('Matched Ricky generation skills');
    expect(task).toContain('80-to-100 fix loop');
    expect(task).toContain('never pass GitHubStepExecutor as the global `.run({ executor })`');
    expect(task).toContain('If the normalized spec declares `Worktree: <absolute path>`');
    expect(task).toContain('Never use `test -f` for a worktree/repository directory');
    expect(task).toContain('deterministic sanity gate');
    expect(task).toContain('POSIX grep, git grep');
    expect(task).toContain('If using rg, guard it with command -v rg');
    expect(task).toContain('Keep agent steps bounded');
    expect(task).toContain('Structured response contract');
    expect(task).toContain('fenced ```ts artifact block plus a fenced ```json metadata block');
    expect(task).toContain('Relevant file context');
    expect(task).toContain('Auto-fix and repair expectations');
    expect(task).toContain('Evidence rules');
    expect(task).toContain('IMPLEMENTATION_WORKFLOW_CONTRACT');
    expect(task).toContain('must edit source files');
    expect(task).toContain('Do not create, edit, or write outputPath directly');
    expect(task).toContain('Do not satisfy implementation specs by only writing plan.md');
    expect(task).toContain('Do not open an interactive Claude, Codex, or OpenCode terminal UI');
  });

  it('injects Ricky repo-local workflow policy files into the persona task', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'ricky-persona-policy-'));
    mkdirSync(join(repoRoot, 'docs/workflows'), { recursive: true });
    mkdirSync(join(repoRoot, 'workflows/shared'), { recursive: true });
    mkdirSync(join(repoRoot, 'workflows/meta/spec'), { recursive: true });
    writeFileSync(
      join(repoRoot, 'docs/workflows/WORKFLOW_STANDARDS.md'),
      '# Standards\n\nRequire shadowed squad review loop.\n',
      'utf8',
    );
    writeFileSync(
      join(repoRoot, 'workflows/shared/WORKFLOW_AUTHORING_RULES.md'),
      '# Rules\n\nRequire live shadow feedback.\n',
      'utf8',
    );
    writeFileSync(
      join(repoRoot, 'workflows/meta/spec/generated-workflow-template.md'),
      '# Template\n\nRequire final-reviewer-claude and final-reviewer-codex.\n',
      'utf8',
    );

    try {
      const task = buildWorkflowPersonaTask(spec(), {
        workflowName: 'policy-context',
        targetMode: 'local',
        repoRoot,
        outputPath: 'workflows/generated/policy-context.ts',
        relevantFiles: [],
      });

      expect(task).toContain('Ricky repo-local workflow policy context');
      expect(task).toContain('# docs/workflows/WORKFLOW_STANDARDS.md');
      expect(task).toContain('Require shadowed squad review loop.');
      expect(task).toContain('# workflows/shared/WORKFLOW_AUTHORING_RULES.md');
      expect(task).toContain('Require live shadow feedback.');
      expect(task).toContain('# workflows/meta/spec/generated-workflow-template.md');
      expect(task).toContain('Require final-reviewer-claude and final-reviewer-codex.');
      expect(task).not.toContain('MISSING: Ricky workflow policy file');
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('defaults to the Agent Relay workflow-writing persona when harness-kit exposes runnable APIs', async () => {
    const calls: string[] = [];
    const resolved = await resolveWorkforcePersonaContextWithModules(
      WORKFORCE_PERSONA_INTENT_CANDIDATES,
      { tier: 'best' },
      {
        source: 'package',
        warnings: [],
        module: {
          useRunnablePersona(intent) {
            calls.push(intent);
            return runnableContext({ personaId: intent });
          },
        },
      },
    );

    expect(calls[0]).toBe('agent-relay-workflow');
    expect(resolved.intent).toBe('agent-relay-workflow');
    expect(resolved.context.selection.personaId).toBe('agent-relay-workflow');
    expect(resolved.context.selection.runtime.harness).toMatch(/^(claude|codex|opencode)$/);
    expect(typeof resolved.context.sendMessage).toBe('function');
  });

  it('parses structured JSON persona output and validates metadata', () => {
    const parsed = parsePersonaWorkflowResponse(JSON.stringify({
      artifact: {
        path: 'workflows/generated/persona.ts',
        content: workflowSource(),
      },
      metadata: {
        workflowName: 'persona',
        agents: ['lead'],
      },
    }), 'workflows/generated/persona.ts');

    expect(parsed.responseFormat).toBe('structured-json');
    expect(parsed.content).toContain('workflow("persona")');
    expect(parsed.metadata).toMatchObject({ workflowName: 'persona' });
  });

  it('parses persona clarification requests without requiring an artifact', () => {
    const parsed = parsePersonaWorkflowResponse(JSON.stringify({
      needs_clarification: {
        status: 'needs_clarification',
        reason: 'Deployment target is unclear.',
        questions: [
          {
            id: 'deployment-target',
            question: 'Should the workflow deploy to staging or production?',
            reason: 'The spec names deployment but not the target environment.',
            blocking: true,
            defaultAssumption: 'Pause before deploy.',
          },
        ],
      },
    }), 'workflows/generated/persona.ts');

    expect(parsed.responseFormat).toBe('needs-clarification');
    expect(parsed.clarification).toMatchObject({
      status: 'needs_clarification',
      questions: [
        {
          id: 'deployment-target',
          question: 'Should the workflow deploy to staging or production?',
          blocking: true,
        },
      ],
    });
  });

  it('parses Sonnet output with prose preamble + unclosed ```json fence', () => {
    // Empirical regression: Claude Sonnet running the agent-relay-workflow
    // persona emits a one-line preamble plus an opening ```json fence with
    // no matching closing fence; the JSON payload is otherwise valid.
    // Captured via the persona-debug dump from the deploy-v1 smoke run.
    const payload = JSON.stringify({
      artifact: { path: 'workflows/generated/persona.ts', content: workflowSource() },
      metadata: { workflowName: 'persona', summary: 'tiny' },
    });
    const sonnetShaped = `Now I have enough context. I'll generate the workflow artifact.\n\n\`\`\`json\n${payload}`;
    const parsed = parsePersonaWorkflowResponse(sonnetShaped, 'workflows/generated/persona.ts');
    expect(parsed.responseFormat).toBe('structured-json');
    expect(parsed.content).toContain('.run({ cwd: process.cwd() })');
    expect(parsed.metadata).toMatchObject({ workflowName: 'persona' });
  });

  it('parses persona output with prose preamble and no fences at all', () => {
    const payload = JSON.stringify({
      artifact: { path: 'workflows/generated/persona.ts', content: workflowSource() },
      metadata: { workflowName: 'persona' },
    });
    const parsed = parsePersonaWorkflowResponse(
      `Here is the workflow you asked for:\n\n${payload}\n\nLet me know if you want me to adjust anything.`,
      'workflows/generated/persona.ts',
    );
    expect(parsed.responseFormat).toBe('structured-json');
    expect(parsed.content).toContain('.run({ cwd: process.cwd() })');
  });

  it('parses fenced TypeScript artifact plus JSON metadata fallback', () => {
    const parsed = parsePersonaWorkflowResponse([
      '```ts',
      workflowSource(),
      '```',
      '```json',
      JSON.stringify({ path: 'workflows/generated/persona.ts', workflowName: 'persona' }),
      '```',
    ].join('\n'), 'workflows/generated/persona.ts');

    expect(parsed.responseFormat).toBe('fenced-artifact');
    expect(parsed.content).toContain('.run({ cwd: process.cwd() })');
    expect(parsed.metadata).toMatchObject({ workflowName: 'persona' });
  });

  it('accepts multiline run options when cwd is explicit', () => {
    const parsed = parsePersonaWorkflowResponse(JSON.stringify({
      artifact: {
        path: 'workflows/generated/persona.ts',
        content: multilineRunSource(),
      },
      metadata: {
        workflowName: 'persona',
        agents: ['lead'],
      },
    }), 'workflows/generated/persona.ts');

    expect(parsed.responseFormat).toBe('structured-json');
    expect(parsed.content).toContain('cwd: process.cwd()');
    expect(parsed.metadata).toMatchObject({ workflowName: 'persona' });
  });

  it('parses persona artifacts without explicit cwd so pre-write validation can repair them', () => {
    const parsed = parsePersonaWorkflowResponse(JSON.stringify({
      artifact: {
        path: 'workflows/generated/persona.ts',
        content: workflowSource().replace('.run({ cwd: process.cwd() });', '.run();'),
      },
      metadata: {
        workflowName: 'persona',
        agents: ['lead'],
      },
    }), 'workflows/generated/persona.ts');

    expect(parsed.responseFormat).toBe('structured-json');
    expect(parsed.content).toContain('.run();');
  });

  it('recovers expected artifact content from disk when structured output omits inline content', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'ricky-persona-response-'));
    const artifactPath = 'workflows/generated/persona.ts';
    const absoluteArtifactPath = join(repoRoot, artifactPath);
    mkdirSync(join(repoRoot, 'workflows/generated'), { recursive: true });
    writeFileSync(absoluteArtifactPath, workflowSource(), 'utf8');

    try {
      const parsed = parsePersonaWorkflowResponse(JSON.stringify({
        artifact: {
          path: artifactPath,
          language: 'typescript',
          content: 'See artifact block above.',
        },
        metadata: {
          workflowName: 'persona',
          agents: ['lead'],
        },
      }), artifactPath, { repoRoot });

      expect(parsed.responseFormat).toBe('structured-json');
      expect(parsed.content).toContain('workflow("persona")');
      expect(parsed.content).toContain('.run({ cwd: process.cwd() })');
      expect(parsed.metadata).toMatchObject({ workflowName: 'persona' });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  describe('truncated-stdout disk fallback', () => {
    // The claude CLI buffers a full --print response then emits it; for
    // large workflow artifacts the LLM's max_output_tokens cap kicks in
    // and the JSON gets cut off mid-emit. The writer typically *did*
    // succeed at writing the workflow to disk via the Write tool (now that
    // bypass-permissions makes that reliable in headless mode), so the
    // parser should fall back to reading the file rather than hard-failing.

    const truncatedJsonOutput = [
      'I need to author a workflow that ships this PR. Let me produce the structured JSON response.',
      '',
      '```json',
      '{',
      '  "artifact": {',
      '    "path": "workflows/generated/persona.ts",',
      '    "language": "typescript",',
      // cut off here — no `content` field, no closing braces
    ].join('\n');

    it('recovers from truncated stdout by reading a fresh file at expectedPath', () => {
      const artifactPath = 'workflows/generated/persona.ts';
      const writerInvokedAtMs = 100;
      const parsed = parsePersonaWorkflowResponse(truncatedJsonOutput, artifactPath, {
        repoRoot: '/tmp/repo',
        writerInvokedAtMs,
        statFile: (path) => path.endsWith('persona.ts') ? { mtimeMs: writerInvokedAtMs + 1_000 } : undefined,
        readFileText: () => workflowSource(),
      });
      expect(parsed.responseFormat).toBe('structured-json');
      expect(parsed.content).toContain('workflow("persona")');
      expect(parsed.metadata).toMatchObject({ recoveredFromDisk: true });
    });

    it('does NOT fall back to a STALE file (mtime older than writerInvokedAtMs)', () => {
      const artifactPath = 'workflows/generated/persona.ts';
      const writerInvokedAtMs = 1_000;
      expect(() =>
        parsePersonaWorkflowResponse(truncatedJsonOutput, artifactPath, {
          repoRoot: '/tmp/repo',
          writerInvokedAtMs,
          statFile: () => ({ mtimeMs: writerInvokedAtMs - 1 }),
          readFileText: () => workflowSource(),
        }),
      ).toThrow(/structured JSON or include fenced TypeScript artifact/);
    });

    it('does NOT fall back when `writerInvokedAtMs` is absent (preserves prior behavior for callers that have not opted in)', () => {
      const artifactPath = 'workflows/generated/persona.ts';
      expect(() =>
        parsePersonaWorkflowResponse(truncatedJsonOutput, artifactPath, {
          repoRoot: '/tmp/repo',
          // writerInvokedAtMs intentionally omitted
          statFile: () => ({ mtimeMs: Date.now() }),
          readFileText: () => workflowSource(),
        }),
      ).toThrow(/structured JSON or include fenced TypeScript artifact/);
    });

    it('does NOT fall back when no file exists at expectedPath (stat returns undefined)', () => {
      const artifactPath = 'workflows/generated/persona.ts';
      expect(() =>
        parsePersonaWorkflowResponse(truncatedJsonOutput, artifactPath, {
          repoRoot: '/tmp/repo',
          writerInvokedAtMs: 100,
          statFile: () => undefined,
          readFileText: () => workflowSource(),
        }),
      ).toThrow(/structured JSON or include fenced TypeScript artifact/);
    });

    it('does NOT fall back when the on-disk file fails structural validation (re-raises original parser error)', () => {
      const artifactPath = 'workflows/generated/persona.ts';
      expect(() =>
        parsePersonaWorkflowResponse(truncatedJsonOutput, artifactPath, {
          repoRoot: '/tmp/repo',
          writerInvokedAtMs: 100,
          statFile: () => ({ mtimeMs: 200 }),
          // File on disk is not a valid workflow (no `workflow(` call) — fallback should refuse it.
          readFileText: () => 'export const broken = 1;',
        }),
      ).toThrow(/structured JSON or include fenced TypeScript artifact/);
    });

    // Regression: when the writer is prompted to use the Write tool, claude
    // sometimes emits a complete ```typescript fence whose body is a
    // *placeholder* ("// (full source above — file written to disk)")
    // followed by a complete ```json metadata fence. Both fences parse,
    // so the parser took the fenced-response path and threw "does not
    // call workflow()" — even though the actual workflow source had just
    // been written to disk and the rest of the response was structurally
    // fine. Result: ~25 minutes of writer work discarded, and 3 more
    // 25-minute repair attempts burned chasing the same symptom. The
    // parser must treat the placeholder-fence case as a stdout-format
    // mismatch and prefer the freshly-written file on disk, exactly like
    // it already does for outright truncated stdout.
    const placeholderFenceOutput = [
      'The file is complete and correct. Here is the response contract output:',
      '',
      '```typescript',
      '// workflows/generated/persona.ts',
      '// (full source above — file written to disk)',
      '```',
      '',
      '```json',
      JSON.stringify({
        artifact: {
          path: 'workflows/generated/persona.ts',
          language: 'typescript',
          linesOfCode: 513,
          writtenToDisk: true,
        },
        metadata: { workflowName: 'persona', agents: ['lead'] },
      }, null, 2),
      '```',
    ].join('\n');

    it('recovers from a placeholder ```typescript fence + complete ```json metadata fence', () => {
      const artifactPath = 'workflows/generated/persona.ts';
      const writerInvokedAtMs = 100;
      const parsed = parsePersonaWorkflowResponse(placeholderFenceOutput, artifactPath, {
        repoRoot: '/tmp/repo',
        writerInvokedAtMs,
        statFile: (path) => path.endsWith('persona.ts') ? { mtimeMs: writerInvokedAtMs + 1_000 } : undefined,
        readFileText: () => workflowSource(),
      });
      expect(parsed.responseFormat).toBe('fenced-artifact');
      expect(parsed.content).toContain('workflow("persona")');
      expect(parsed.metadata).toMatchObject({ recoveredFromDisk: true, reason: 'fenced-ts-placeholder' });
    });

    it('does NOT recover from a placeholder fence when the on-disk file is STALE (mtime <= writerInvokedAtMs)', () => {
      // Regression guard for the bypass identified during review: when
      // `recoverArtifactFromTruncatedOutput` correctly rejects a stale
      // on-disk file, the placeholder-fence helper used to return
      // `undefined` and the parser fell through to
      // `validateStructuredResponse` → `recoverExpectedArtifactContent`,
      // which has no mtime check and would silently surface the stale
      // artifact as if it were the current writer's output. The helper
      // must now throw the original "does not call workflow()" error so
      // no fallthrough is possible.
      const artifactPath = 'workflows/generated/persona.ts';
      const writerInvokedAtMs = 1_000;
      expect(() =>
        parsePersonaWorkflowResponse(placeholderFenceOutput, artifactPath, {
          repoRoot: '/tmp/repo',
          writerInvokedAtMs,
          statFile: () => ({ mtimeMs: writerInvokedAtMs - 1 }),
          // Even though the on-disk file is a valid workflow, the mtime
          // says it predates this writer run — must NOT be accepted.
          readFileText: () => workflowSource(),
        }),
      ).toThrow(/does not call workflow\(\)/);
    });

    it('placeholder fence path falls through to disk recovery only when `writerInvokedAtMs` is provided', () => {
      // Without `writerInvokedAtMs` the disk-recovery freshness guard
      // short-circuits, so the placeholder-fence helper has no fresh
      // file to fall back to and must re-throw the original
      // "does not call workflow()" error rather than returning a
      // misleading shape or silently consuming a stale artifact.
      const artifactPath = 'workflows/generated/persona.ts';
      expect(() =>
        parsePersonaWorkflowResponse(placeholderFenceOutput, artifactPath, {
          repoRoot: '/tmp/repo',
          // writerInvokedAtMs intentionally omitted
          statFile: () => ({ mtimeMs: Date.now() }),
          readFileText: () => workflowSource(),
        }),
      ).toThrow(/does not call workflow\(\)/);
    });

    it('does NOT recover from a placeholder fence when on-disk content also lacks `workflow(` (no silent bypass)', () => {
      const artifactPath = 'workflows/generated/persona.ts';
      expect(() =>
        parsePersonaWorkflowResponse(placeholderFenceOutput, artifactPath, {
          repoRoot: '/tmp/repo',
          writerInvokedAtMs: 100,
          statFile: () => ({ mtimeMs: 200 }),
          readFileText: () => 'export const broken = 1;',
        }),
      ).toThrow(/does not call workflow\(\)/);
    });

    it('placeholder fence path re-validates fenced metadata against the recovered disk content (mismatched path still throws)', () => {
      // Regression guard for CodeRabbit's metadata concern: after the
      // helper recovers content from disk, it must re-run the full
      // fenced-response validator on the recovered content + metadata
      // so metadata-level issues (mismatched `path`) still surface.
      const artifactPath = 'workflows/generated/persona.ts';
      const writerInvokedAtMs = 100;
      const mismatchedFenceOutput = [
        '```typescript',
        '// (file written to disk)',
        '```',
        '',
        '```json',
        JSON.stringify({
          path: 'workflows/generated/SOMETHING-ELSE.ts',
          workflowName: 'persona',
        }, null, 2),
        '```',
      ].join('\n');
      expect(() =>
        parsePersonaWorkflowResponse(mismatchedFenceOutput, artifactPath, {
          repoRoot: '/tmp/repo',
          writerInvokedAtMs,
          statFile: (path) => path.endsWith('persona.ts') ? { mtimeMs: writerInvokedAtMs + 1_000 } : undefined,
          readFileText: () => workflowSource(),
        }),
      ).toThrow(/fenced metadata path .* did not match expected output path/);
    });
  });

  it('invokes the spawned harness non-interactively (no TUI flag, structured-response contract)', async () => {
    const base = generate({
      spec: spec({
        description: 'Implement a strict Agent Relay workflow with tests and review.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/non-interactive.ts',
    });
    expect(base.success).toBe(true);
    const sendMessageOptions: Array<Record<string, unknown>> = [];
    const resolver: WorkforcePersonaResolver = async () => ({
      source: 'package',
      intent: 'agent-relay-workflow',
      warnings: [],
      context: {
        selection: {
          personaId: 'agent-relay-workflow',
          tier: 'best',
          runtime: { harness: 'codex', model: 'codex/test' },
        },
        sendMessage(_task, options) {
          sendMessageOptions.push((options ?? {}) as Record<string, unknown>);
          return execution(JSON.stringify({
            artifact: {
              path: 'workflows/generated/non-interactive.ts',
              content: base.artifact!.content,
            },
            metadata: { workflowName: 'non-interactive' },
          }));
        },
      },
    });

    const result = await generateWithWorkforcePersona({
      spec: spec({
        description: 'Implement a strict Agent Relay workflow with tests and review.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/non-interactive.ts',
      workforcePersonaWriter: {
        repoRoot: '/repo',
        workflowName: 'non-interactive',
        targetMode: 'local',
        installSkills: false,
        resolver,
        review: false,
      },
    });

    expect(result.success).toBe(true);
    expect(sendMessageOptions).toHaveLength(1);
    const passed = sendMessageOptions[0];
    expect(passed.workingDirectory).toBe('/repo');
    expect(passed.installSkills).toBe(false);
    expect(passed.mode).toBe('one-shot');
    expect(passed.responseFormat).toBe('structured-json-or-fenced-artifact');
    // Non-interactive contract: no TUI / interactive flag set on sendMessage.
    expect(passed).not.toHaveProperty('tty');
    expect(passed).not.toHaveProperty('interactive');
    expect(passed).not.toHaveProperty('stdio');
    expect((passed.inputs as Record<string, unknown>).outputPath).toBe(
      'workflows/generated/non-interactive.ts',
    );
  });

  it('runs the Workforce persona writer for master execution workflows', async () => {
    const masterSpec = spec({
      description: [
        'Implement nested runner, runtime policy, telemetry, evals, and insights',
        'as smaller workflows run by a master executor.',
      ].join(' '),
      targetFiles: [
        'src/runtime/nested-runner.ts',
        'src/runtime/policy.ts',
        'src/telemetry/events.ts',
        'src/evals/harness.ts',
      ],
    });
    const base = generate({
      spec: masterSpec,
      artifactPath: 'workflows/generated/runtime-master.ts',
    });
    expect(base.success).toBe(true);
    expect(base.masterExecutionPlan).toBeDefined();
    const calls: Array<{ task: string; options: Record<string, unknown> | undefined }> = [];
    const personaContent = base.artifact!.content.replace(
      'RICKY_MASTER_EXECUTOR_WORKFLOW',
      'RICKY_MASTER_EXECUTOR_WORKFLOW\n// WORKFORCE_PERSONA_MASTER_AUTHORING',
    );
    const resolver: WorkforcePersonaResolver = async (_intents, options) => ({
      source: 'package',
      intent: 'agent-relay-workflow',
      warnings: [],
      context: {
        selection: {
          personaId: 'agent-relay-workflow',
          tier: options?.tier ?? 'best',
          runtime: { harness: 'codex', model: 'codex/test' },
        },
        sendMessage(task, sendOptions) {
          calls.push({ task, options: sendOptions as Record<string, unknown> | undefined });
          return execution(personaResponse('workflows/generated/runtime-master.ts', personaContent));
        },
      },
    });

    const result = await generateWithWorkforcePersona({
      spec: masterSpec,
      artifactPath: 'workflows/generated/runtime-master.ts',
      workforcePersonaWriter: {
        repoRoot: '/repo',
        workflowName: 'runtime-master',
        targetMode: 'local',
        resolver,
        review: false,
      },
    });

    expect(result.success).toBe(true);
    expect(result.masterExecutionPlan).toBeDefined();
    expect(calls).toHaveLength(1);
    expect(calls[0].task).toContain('"outputPath": "workflows/generated/runtime-master.ts"');
    expect(calls[0].options?.mode).toBe('one-shot');
    expect(result.workforcePersona).toMatchObject({
      personaId: 'agent-relay-workflow',
      selectedIntent: 'agent-relay-workflow',
      outputPath: 'workflows/generated/runtime-master.ts',
    });
    expect(result.artifact?.content).toContain('WORKFORCE_PERSONA_MASTER_AUTHORING');
  });

  it('falls back to deterministic rendering with a visible warning when the harness returns malformed text', async () => {
    // Regression: previously this returned success: false and discarded the
    // valid baseResult.artifact entirely. The auto-fix loop then chased a
    // phantom artifact (retryBaseRequest promotes response.artifacts[0].path
    // → request.specPath → workflowFileForRoute returns it → gate skips
    // generation → precheck fails INVALID_ARTIFACT every retry until the
    // auto-fix budget burns). We now mirror the existing pre-write
    // validation fallback: success: true with the deterministic render and
    // a warning that surfaces the persona writer failure.
    const resolver: WorkforcePersonaResolver = async () => ({
      source: 'package',
      intent: 'agent-relay-workflow',
      warnings: [],
      context: {
        selection: {
          personaId: 'agent-relay-workflow',
          tier: 'best',
          runtime: { harness: 'codex', model: 'codex/test' },
        },
        sendMessage() {
          return execution('not a workflow at all — no fences, no JSON, no workflow() call');
        },
      },
    });

    const result = await generateWithWorkforcePersona({
      spec: spec(),
      artifactPath: 'workflows/generated/malformed.ts',
      workforcePersonaWriter: {
        repoRoot: '/repo',
        workflowName: 'malformed',
        targetMode: 'local',
        resolver,
        review: false,
      },
    });

    expect(result.success).toBe(true);
    expect(result.artifact).not.toBeNull();
    expect(result.artifact?.artifactPath).toBe('workflows/generated/malformed.ts');
    // The fallback artifact is the deterministic render, not the malformed
    // persona output.
    expect(result.artifact?.content).toContain('workflow(');
    // The persona writer failure is surfaced as a warning so users notice
    // even though Ricky kept their run unblocked.
    const warningText = result.validation.warnings.join(' | ');
    expect(warningText).toMatch(/workforce persona writer failed/i);
    expect(result.workforcePersona?.warnings.join(' | ')).toMatch(/workforce persona writer failed/i);
  });

  it('returns persona clarification questions instead of falling back to deterministic rendering', async () => {
    const resolver: WorkforcePersonaResolver = async () => ({
      source: 'package',
      intent: 'agent-relay-workflow',
      warnings: [],
      context: {
        selection: {
          personaId: 'agent-relay-workflow',
          tier: 'best',
          runtime: { harness: 'codex', model: 'codex/test' },
        },
        sendMessage() {
          return execution(JSON.stringify({
            needs_clarification: {
              status: 'needs_clarification',
              reason: 'Approval boundary is missing.',
              questions: [
                {
                  id: 'side-effects',
                  question: 'Should commits and pushes require approval?',
                  reason: 'The workflow could otherwise perform irreversible side effects.',
                  blocking: true,
                },
              ],
            },
          }));
        },
      },
    });

    const result = await generateWithWorkforcePersona({
      spec: spec({ description: 'Generate a workflow for risky implementation work.' }),
      artifactPath: 'workflows/generated/clarify.ts',
      workforcePersonaWriter: {
        repoRoot: '/repo',
        workflowName: 'clarify',
        targetMode: 'local',
        resolver,
        review: false,
      },
    });

    expect(result.success).toBe(false);
    expect(result.artifact).toBeNull();
    expect(result.clarificationQuestions).toEqual([
      expect.objectContaining({
        id: 'side-effects',
        question: 'Should commits and pushes require approval?',
        blocking: true,
      }),
    ]);
    expect(result.validation.errors.join('\n')).toContain('needs clarification');
  });

  it('runs pre-write validation and asks the persona to repair invalid workflow syntax before succeeding', async () => {
    const base = generate({
      spec: spec({
        description: 'Implement a strict Agent Relay workflow with tests and review.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/prewrite-repair.ts',
    });
    expect(base.success).toBe(true);
    const tasks: string[] = [];
    const resolver: WorkforcePersonaResolver = async () => ({
      source: 'package',
      intent: 'agent-relay-workflow',
      warnings: [],
      context: {
        selection: {
          personaId: 'agent-relay-workflow',
          tier: 'best',
          runtime: { harness: 'codex', model: 'codex/test' },
        },
        sendMessage(task) {
          tasks.push(task);
          const content = tasks.length === 1
            ? `${base.artifact!.content}\n}`
            : base.artifact!.content;
          return execution(personaResponse('workflows/generated/prewrite-repair.ts', content));
        },
      },
    });

    const result = await generateWithWorkforcePersona({
      spec: spec({
        description: 'Implement a strict Agent Relay workflow with tests and review.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/prewrite-repair.ts',
      workforcePersonaWriter: {
        repoRoot: '/repo',
        workflowName: 'prewrite-repair',
        targetMode: 'local',
        resolver,
        review: false,
      },
    });

    expect(result.success).toBe(true);
    expect(result.artifact?.content).toBe(base.artifact!.content);
    expect(tasks).toHaveLength(2);
    expect(tasks[1]).toContain('Ricky pre-write validation failed');
    expect(tasks[1]).toContain('Rendered artifact has unbalanced braces');
    expect(tasks[1]).toContain('Previous rejected artifact');
    expect(result.workforcePersona?.warnings).toContain(
      'Ricky pre-write validation repaired the Workforce persona artifact before writing.',
    );
  });

  it('runs pre-write validation and asks the persona to repair missing explicit cwd before writing', async () => {
    const base = generate({
      spec: spec({
        description: 'Implement a strict Agent Relay workflow with tests and review.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/prewrite-cwd-repair.ts',
    });
    expect(base.success).toBe(true);
    const tasks: string[] = [];
    const resolver: WorkforcePersonaResolver = async () => ({
      source: 'package',
      intent: 'agent-relay-workflow',
      warnings: [],
      context: {
        selection: {
          personaId: 'agent-relay-workflow',
          tier: 'best',
          runtime: { harness: 'codex', model: 'codex/test' },
        },
        sendMessage(task) {
          tasks.push(task);
          const content = tasks.length === 1
            ? replaceLast(base.artifact!.content, '.run({ cwd: process.cwd() });', '.run();')
            : base.artifact!.content;
          return execution(personaResponse('workflows/generated/prewrite-cwd-repair.ts', content));
        },
      },
    });

    const result = await generateWithWorkforcePersona({
      spec: spec({
        description: 'Implement a strict Agent Relay workflow with tests and review.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/prewrite-cwd-repair.ts',
      workforcePersonaWriter: {
        repoRoot: '/repo',
        workflowName: 'prewrite-cwd-repair',
        targetMode: 'local',
        resolver,
        review: false,
      },
    });

    expect(result.success).toBe(true);
    expect(result.artifact?.content).toContain('.run({ cwd: process.cwd() })');
    expect(tasks).toHaveLength(2);
    expect(tasks[1]).toContain('Ricky pre-write validation failed');
    expect(tasks[1]).toContain('Rendered workflow does not run with explicit cwd');
    expect(result.workforcePersona?.warnings).toContain(
      'Ricky pre-write validation repaired the Workforce persona artifact before writing.',
    );
  });

  it('threads failed pre-write repair attempts into later persona repairs and escalates attempt four to best', async () => {
    const base = generate({
      spec: spec({
        description: 'Implement a strict Agent Relay workflow with tests and review.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/prewrite-learning.ts',
    });
    expect(base.success).toBe(true);
    const tasks: string[] = [];
    const resolverOptions: Array<Record<string, unknown> | undefined> = [];
    const resolver: WorkforcePersonaResolver = async (_intents, options) => {
      resolverOptions.push(options);
      return {
        source: 'package',
        intent: 'agent-relay-workflow',
        warnings: [],
        context: {
          selection: {
            personaId: 'agent-relay-workflow',
            tier: options?.tier ?? 'best',
            runtime: { harness: 'codex', model: 'codex/test' },
          },
          sendMessage(task) {
            tasks.push(task);
            const content = tasks.length < 5
              ? `${base.artifact!.content}\n}`
              : base.artifact!.content;
            return execution(personaResponse('workflows/generated/prewrite-learning.ts', content));
          },
        },
      };
    };

    const result = await generateWithWorkforcePersona({
      spec: spec({
        description: 'Implement a strict Agent Relay workflow with tests and review.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/prewrite-learning.ts',
      workforcePersonaWriter: {
        repoRoot: '/repo',
        workflowName: 'prewrite-learning',
        targetMode: 'local',
        tier: 'minimum',
        repairAttempts: 4,
        resolver,
        review: false,
      },
    });

    expect(result.success).toBe(true);
    expect(tasks).toHaveLength(5);
    expect(tasks[4]).toContain('Previous pre-write repair attempts that still failed');
    expect(tasks[4]).toContain('"attempt": 3');
    expect(tasks[4]).toContain('Use those failed repair attempts as negative evidence');
    expect(resolverOptions.map((options) => options?.tier)).toEqual([
      'minimum',
      'minimum',
      'minimum',
      'minimum',
      'best',
    ]);
  });

  it('falls back to Ricky deterministic rendering when persona pre-write repair is still invalid', async () => {
    const base = generate({
      spec: spec({
        description: 'Implement a strict Agent Relay workflow with tests and review.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/prewrite-fallback.ts',
    });
    expect(base.success).toBe(true);
    const resolver: WorkforcePersonaResolver = async () => ({
      source: 'package',
      intent: 'agent-relay-workflow',
      warnings: [],
      context: {
        selection: {
          personaId: 'agent-relay-workflow',
          tier: 'best',
          runtime: { harness: 'codex', model: 'codex/test' },
        },
        sendMessage() {
          return execution(personaResponse(
            'workflows/generated/prewrite-fallback.ts',
            `${base.artifact!.content}\n}`,
          ));
        },
      },
    });

    const result = await generateWithWorkforcePersona({
      spec: spec({
        description: 'Implement a strict Agent Relay workflow with tests and review.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/prewrite-fallback.ts',
      workforcePersonaWriter: {
        repoRoot: '/repo',
        workflowName: 'prewrite-fallback',
        targetMode: 'local',
        resolver,
        review: false,
      },
    });

    expect(result.success).toBe(true);
    expect(result.artifact?.content).toBe(base.artifact!.content);
    expect(result.validation.warnings.join('\n')).toContain('used Ricky deterministic renderer instead');
    expect(result.workforcePersona?.warnings.join('\n')).toContain('used Ricky deterministic renderer instead');
  });

  it('adapts harness-kit useRunnablePersona into the sendMessage context Ricky expects', async () => {
    const calls: Array<{ intent: string; options: Record<string, unknown> | undefined }> = [];
    const resolved = await resolveWorkforcePersonaContextWithModules(
      ['agent-relay-workflow'],
      { tier: 'best', installRoot: '/state/ricky/persona-skills' },
      {
        source: 'package',
        warnings: [],
        module: {
          useRunnablePersona(intent, options) {
            calls.push({ intent, options: options as Record<string, unknown> | undefined });
            return runnableContext();
          },
        },
      },
    );

    expect(resolved.source).toBe('package');
    expect(resolved.intent).toBe('agent-relay-workflow');
    expect(calls).toEqual([
      {
        intent: 'agent-relay-workflow',
        options: { tier: 'best', installRoot: '/state/ricky/persona-skills' },
      },
    ]);
    const result = await resolved.context.sendMessage('task');
    expect(result.status).toBe('completed');
  });

  it('uses workload-router only for selection metadata when harness-kit needs useRunnableSelection', async () => {
    const selections: unknown[] = [];
    const selectionOptionsCalls: unknown[] = [];
    const resolved = await resolveWorkforcePersonaContextWithModules(
      ['relay-orchestrator'],
      { installRoot: '/state/ricky/persona-skills' },
      {
        source: 'package',
        warnings: [],
        module: {
          useRunnableSelection(selection, options) {
            selections.push({ selection, options });
            return runnableContext({ personaId: 'relay-orchestrator' });
          },
        },
      },
      async () => ({
        source: 'package',
        warnings: [],
        module: {
          usePersona(intent, options) {
            selectionOptionsCalls.push(options);
            return {
              selection: {
                personaId: intent,
                tier: 'best',
                runtime: { harness: 'claude', model: 'claude/test' },
                skills: [],
                rationale: 'test metadata',
              },
            };
          },
        },
      }),
    );

    expect(resolved.context.selection.personaId).toBe('relay-orchestrator');
    expect(selectionOptionsCalls).toEqual([undefined]);
    expect(selections).toHaveLength(1);
    expect(selections[0]).toMatchObject({
      selection: { personaId: 'relay-orchestrator' },
      options: { installRoot: '/state/ricky/persona-skills' },
    });
  });

  it('invokes the selected Workforce persona through runnable sendMessage and persists metadata', async () => {
    const base = generate({
      spec: spec({
        description: 'Implement a strict Agent Relay workflow with tests and review.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/workforce-writer.ts',
    });
    expect(base.success).toBe(true);

    const calls: Array<{ intents: readonly string[]; task: string }> = [];
    const resolver: WorkforcePersonaResolver = async (intents) => ({
      source: 'package',
      intent: 'agent-relay-workflow',
      warnings: ['resolver warning'],
      context: {
        selection: {
          personaId: 'agent-relay-workflow',
          tier: 'best',
          runtime: {
            harness: 'codex',
            model: 'openai-codex/gpt-5.3-codex',
            harnessSettings: { timeoutSeconds: 1200, reasoning: 'high' },
          },
        },
        sendMessage(task) {
          calls.push({ intents, task });
          return execution(JSON.stringify({
            artifact: {
              path: 'workflows/generated/workforce-writer.ts',
              content: base.artifact!.content,
            },
            metadata: {
              workflowName: 'workforce-writer',
              evidence: ['typecheck', 'tests'],
            },
          }));
        },
      },
    });

    const result = await generateWithWorkforcePersona({
      spec: spec({
        description: 'Implement a strict Agent Relay workflow with tests and review.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/workforce-writer.ts',
      workforcePersonaWriter: {
        repoRoot: '/repo',
        workflowName: 'workforce-writer',
        targetMode: 'local',
        resolver,
        // Writer-in-isolation test: the post-write reviewer pass is exercised
        // separately in pipeline-review.test.ts.
        review: false,
      },
    });

    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].intents).toEqual(WORKFORCE_PERSONA_INTENT_CANDIDATES);
    expect(calls[0].task).toContain('"repoRoot": "/repo"');
    expect(calls[0].task).toContain('"outputPath": "workflows/generated/workforce-writer.ts"');
    expect(calls[0].task).toContain('"loadedSkills"');
    expect(calls[0].task).toContain('choosing-swarm-patterns');
    expect(calls[0].task).toContain('Quick Decision Framework');
    expect(result.workforcePersona).toMatchObject({
      personaId: 'agent-relay-workflow',
      tier: 'best',
      harness: 'codex',
      model: 'openai-codex/gpt-5.3-codex',
      runId: 'persona-run-001',
      source: 'package',
      selectedIntent: 'agent-relay-workflow',
      responseFormat: 'structured-json',
      outputPath: 'workflows/generated/workforce-writer.ts',
    });
    expect(result.workforcePersona?.promptDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.workforcePersona?.warnings).toEqual(['resolver warning']);
    expect(result.artifact?.content).toBe(base.artifact!.content);
  });

  it('lets the Workforce router choose the default writer tier unless callers override it', async () => {
    const base = generate({
      spec: spec({
        description: 'Implement a strict Agent Relay workflow with tests and review.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/router-tier.ts',
    });
    expect(base.success).toBe(true);

    const resolverOptions: Array<Record<string, unknown> | undefined> = [];
    const resolver: WorkforcePersonaResolver = async (_intents, options) => {
      resolverOptions.push(options);
      return {
        source: 'package',
        intent: 'agent-relay-workflow',
        warnings: [],
        context: {
          selection: {
            personaId: 'agent-relay-workflow',
            tier: 'best-value',
            runtime: {
              harness: 'opencode',
              model: 'opencode/gpt-5-nano',
              harnessSettings: { timeoutSeconds: 900, reasoning: 'medium' },
            },
          },
          sendMessage() {
            return execution(personaResponse('workflows/generated/router-tier.ts', base.artifact!.content));
          },
        },
      };
    };

    const result = await generateWithWorkforcePersona({
      spec: spec({
        description: 'Implement a strict Agent Relay workflow with tests and review.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/router-tier.ts',
      workforcePersonaWriter: {
        repoRoot: '/repo',
        workflowName: 'router-tier',
        targetMode: 'local',
        resolver,
        review: false,
      },
    });

    expect(result.success).toBe(true);
    expect(resolverOptions).toEqual([{}]);
    expect(result.workforcePersona).toMatchObject({
      personaId: 'agent-relay-workflow',
      tier: 'best-value',
      harness: 'opencode',
      model: 'opencode/gpt-5-nano',
    });
  });

  it('uses a runnable usePersona(...).sendMessage seam when harness-kit is unavailable', async () => {
    const selectionOptionsCalls: unknown[] = [];
    const resolved = await resolveWorkforcePersonaContextWithModules(
      ['agent-relay-workflow'],
      { tier: 'best', installRoot: '/state/ricky/persona-skills' },
      {
        source: 'package',
        warnings: ['harness-kit unavailable'],
        module: {},
      },
      async () => ({
        source: 'package',
        warnings: ['using packaged workload-router fallback'],
        module: {
          usePersona(intent, options) {
            selectionOptionsCalls.push(options);
            return runnableContext({ personaId: intent, tier: options?.tier ?? 'minimum' });
          },
        },
      }),
    );

    expect(resolved.source).toBe('package');
    expect(resolved.intent).toBe('agent-relay-workflow');
    expect(resolved.context.selection).toMatchObject({
      personaId: 'agent-relay-workflow',
      tier: 'best',
    });
    expect(selectionOptionsCalls).toEqual([
      { tier: 'best', installRoot: '/state/ricky/persona-skills' },
    ]);
    expect(resolved.warnings).toEqual([
      'harness-kit unavailable',
      'using packaged workload-router fallback',
    ]);
    const result = await resolved.context.sendMessage('task');
    expect(result.status).toBe('completed');
  });

  it('retries the runnable usePersona fallback without installRoot when the selected harness rejects it', async () => {
    const selectionOptionsCalls: unknown[] = [];
    const resolved = await resolveWorkforcePersonaContextWithModules(
      ['agent-relay-workflow'],
      { installRoot: '/state/ricky/persona-skills' },
      {
        source: 'package',
        warnings: ['harness-kit unavailable'],
        module: {},
      },
      async () => ({
        source: 'package',
        warnings: [],
        module: {
          usePersona(intent, options) {
            selectionOptionsCalls.push(options);
            if (options?.installRoot) {
              throw new Error('installRoot is only supported for the claude harness (got: opencode)');
            }
            return runnableContext({ personaId: intent, tier: 'best-value' });
          },
        },
      }),
    );

    expect(resolved.context.selection).toMatchObject({
      personaId: 'agent-relay-workflow',
      tier: 'best-value',
    });
    expect(selectionOptionsCalls).toEqual([
      { installRoot: '/state/ricky/persona-skills' },
      undefined,
    ]);
    expect(resolved.warnings).toContain(
      'Workforce persona selected a non-claude harness; retrying runnable context without installRoot.',
    );
  });

  it('preserves npm load failure wording when harness-kit cannot be imported', async () => {
    const failImport = async () => {
      throw new Error('simulated package load failure');
    };

    await expect(loadWorkforcePersonaModule(failImport)).rejects.toMatchObject({
      name: 'WorkforcePersonaWriterError',
      message: expect.stringContaining('@agentworkforce/harness-kit could not be loaded'),
      warnings: [expect.stringContaining('simulated package load failure')],
    });
  });

  it('preserves missing-export wording when harness-kit imports but lacks runnable APIs', async () => {
    const importWrongShape = async () => ({
      buildInteractiveSpec() {
        return {};
      },
    });

    await expect(loadWorkforcePersonaModule(importWrongShape)).rejects.toMatchObject({
      name: 'WorkforcePersonaWriterError',
      message: expect.stringContaining('does not expose the runnable persona API'),
      warnings: [expect.stringContaining('exports: buildInteractiveSpec')],
    });
  });

  it('preserves npm load failure wording when workload-router cannot be imported', async () => {
    const failImport = async () => {
      throw new Error('simulated router load failure');
    };

    await expect(loadWorkforceSelectionModule(failImport)).rejects.toMatchObject({
      name: 'WorkforcePersonaWriterError',
      message: expect.stringContaining('@agentworkforce/workload-router could not be loaded'),
      warnings: [expect.stringContaining('simulated router load failure')],
    });
  });

  it('preserves missing-export wording when workload-router imports but lacks usePersona', async () => {
    const importWrongShape = async () => ({
      resolvePersona() {
        return {};
      },
    });

    await expect(loadWorkforceSelectionModule(importWrongShape)).rejects.toMatchObject({
      name: 'WorkforcePersonaWriterError',
      message: expect.stringContaining('does not expose the persona selection API'),
      warnings: [expect.stringContaining('exports: resolvePersona')],
    });
  });
});

describe('writer-wait watchdog (waitForWriterWithWatchdog)', () => {
  // The watchdog protects callers from a harness-kit stall in which the
  // subprocess exits but `finish()` never resolves because the stdio pipe
  // stayed half-open. Tests exercise both directions: settled-before-watchdog
  // (happy path) and watchdog-fires (the production hang).

  it('returns the settled value when the run resolves before the watchdog window', async () => {
    const expected = { status: 'completed', output: 'ok', stderr: '', exitCode: 0, durationMs: 10 } as unknown as Awaited<ReturnType<typeof makeRun>>;
    const run = makeRun(Promise.resolve(expected), Promise.resolve('run-1'));

    // Watchdog at (1 + 90) * 1000 = 91 000ms; the run resolves immediately,
    // so the watchdog never fires.
    const [result, runId] = await waitForWriterWithWatchdog(run, 1, ['resolver-warning-A']);

    expect(result).toBe(expected);
    expect(runId).toBe('run-1');
  });

  it('rejects with a WorkforcePersonaWriterError when the run never settles, after timeoutSeconds + grace', async () => {
    // A `run` that never resolves simulates the production hang: the
    // subprocess exited but the harness-kit promise stays pending.
    const hangingRun = makeHangingRun();
    // Use a 0s `timeoutSeconds` to trigger the watchdog as fast as possible
    // (the fallback in waitForWriterWithWatchdog defaults to 60min when the
    // input is non-positive; we provide a small positive override path via
    // a tiny grace-only window).
    const originalGrace = 90;
    void originalGrace;

    // Build the watchdog with a tiny effective window by stubbing out the
    // grace constant. We can't easily monkey-patch the constant, so we lean
    // on `vi.useFakeTimers` to advance time past the watchdog deadline.
    vi.useFakeTimers();
    try {
      const settledPromise = waitForWriterWithWatchdog(hangingRun, 1, ['resolver-warning-B']);
      const captured = settledPromise.catch((error) => error);
      // Advance past 1s + 90s grace + a margin.
      await vi.advanceTimersByTimeAsync(92_000);
      const error = await captured;
      expect(error).toBeInstanceOf(WorkforcePersonaWriterError);
      expect((error as WorkforcePersonaWriterError).message).toMatch(/did not settle within 91s/);
      expect((error as WorkforcePersonaWriterError).message).toMatch(/half-open/);
      // Resolver warnings flow into the thrown error so debug surfaces them.
      expect((error as WorkforcePersonaWriterError).warnings).toEqual(['resolver-warning-B']);
      // Watchdog called run.cancel() to release subprocess handles.
      expect(hangingRun.cancel).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does NOT call run.cancel() when the run resolves before the watchdog fires', async () => {
    const expected = { status: 'completed', output: 'ok', stderr: '', exitCode: 0, durationMs: 10 } as unknown as Awaited<ReturnType<typeof makeRun>>;
    const run = makeRun(Promise.resolve(expected), Promise.resolve('run-2'));
    run.cancel = vi.fn();

    await waitForWriterWithWatchdog(run, 1, []);

    expect(run.cancel).not.toHaveBeenCalled();
  });

  it('does not wait on a stuck `runId` promise once `run` itself has settled (coderabbit #114-0002)', async () => {
    // Reproduces the failure mode coderabbit flagged: if `run` resolves
    // with a valid result but `runId` never settles (the metadata side of
    // the promise hangs), the original `Promise.all([run, run.runId])`
    // would have blocked indefinitely. The watchdog races runId against
    // run.then(() => null) so a completed run forces runId to yield null
    // immediately when the runId side is stuck.
    const expected = { status: 'completed', output: 'ok', stderr: '', exitCode: 0, durationMs: 10 } as unknown as Awaited<ReturnType<typeof makeRun>>;
    const neverSettlingRunId = new Promise<string | null>(() => {
      // never resolves — simulates a stuck runId promise
    });
    const run = makeRun(Promise.resolve(expected), neverSettlingRunId);

    // No fake timers needed: the race resolves as soon as `run` settles.
    const [result, runId] = await waitForWriterWithWatchdog(run, 1, []);

    expect(result).toBe(expected);
    expect(runId).toBeNull();
    // run.cancel must not fire when the run itself completed successfully.
    expect(run.cancel).not.toHaveBeenCalled();
  });

  function makeRun(resolveTo: Promise<unknown>, runIdResolveTo: Promise<string | null>): WorkforcePersonaExecution & { cancel: ReturnType<typeof vi.fn> } {
    const promise = resolveTo as WorkforcePersonaExecution;
    Object.defineProperty(promise, 'runId', { value: runIdResolveTo });
    (promise as { cancel: () => void }).cancel = vi.fn();
    return promise as WorkforcePersonaExecution & { cancel: ReturnType<typeof vi.fn> };
  }

  function makeHangingRun(): WorkforcePersonaExecution & { cancel: ReturnType<typeof vi.fn> } {
    const promise = new Promise<unknown>(() => {
      // never resolves — simulates the half-open-pipe hang from production
    }) as WorkforcePersonaExecution;
    Object.defineProperty(promise, 'runId', { value: new Promise<string | null>(() => {}) });
    (promise as { cancel: () => void }).cancel = vi.fn();
    return promise as WorkforcePersonaExecution & { cancel: ReturnType<typeof vi.fn> };
  }
});

describe('workforce persona writer task summarization', () => {
  it('elides the raw spec payload text on every summarization', () => {
    const longDescription = 'A'.repeat(50);
    const summarized = summarizeSpecForPersona(spec({ description: longDescription }));
    const rawPayload = summarized.spec.sourceSpec.rawPayload;
    expect(rawPayload.kind).toBe('natural_language');
    if (rawPayload.kind === 'natural_language') {
      expect(rawPayload.text).toContain('<<elided');
      expect(rawPayload.text).not.toContain(longDescription);
    }
    expect(summarized.spec.sourceSpec.description).toBe('<<elided: see top-level description field>>');
  });

  it('preserves description when it fits under the cap and reports truncated=false', () => {
    const summarized = summarizeSpecForPersona(spec({ description: 'small description body' }));
    expect(summarized.spec.description).toBe('small description body');
    expect(summarized.descriptionTruncated).toBe(false);
  });

  it('truncates oversized descriptions with a head + tail elision marker', () => {
    const huge = `${'X'.repeat(40_000)}\n--- middle landmark ---\n${'Y'.repeat(40_000)}`;
    const summarized = summarizeSpecForPersona(spec({ description: huge }));
    expect(summarized.descriptionTruncated).toBe(true);
    expect(summarized.spec.description).toContain('<<truncated');
    // Head from the start AND tail from the end both survive.
    expect(summarized.spec.description.startsWith('XXXX')).toBe(true);
    expect(summarized.spec.description.endsWith('YYYY')).toBe(true);
    // Whole summarized spec must fit under ~64KB even though input was 80KB.
    const serialized = JSON.stringify(summarized.spec);
    expect(serialized.length).toBeLessThan(64 * 1024);
  });

  it('caps relevant file contents per-file and reports per-file omission counts', () => {
    const big = 'A'.repeat(20_000);
    const result = summarizeRelevantFilesForPersona([
      { path: 'a.ts', content: big },
      { path: 'b.ts', content: 'tiny' },
    ]);
    expect(result.includedCount).toBe(2);
    expect(result.files[0].content).toContain('<<truncated');
    expect(result.files[0].bytesOmitted).toBeGreaterThan(0);
    expect(result.files[1].content).toBe('tiny');
    expect(result.files[1].bytesOmitted).toBeUndefined();
  });

  it('drops file contents past the total relevant-file budget but keeps the path entry', () => {
    const big = 'A'.repeat(8 * 1024);
    const files = Array.from({ length: 30 }, (_, idx) => ({ path: `file-${idx}.ts`, content: big }));
    const result = summarizeRelevantFilesForPersona(files);
    expect(result.files).toHaveLength(30);
    const omitted = result.files.filter((file) => file.omitted === true);
    expect(omitted.length).toBeGreaterThan(0);
    omitted.forEach((entry) => expect(entry.content).toBeNull());
  });

  it('references the spec file by path and notes truncation when description is oversized', () => {
    const huge = 'A'.repeat(60_000);
    const task = buildWorkflowPersonaTask(spec({ description: huge }), {
      workflowName: 'reference-spec-by-path',
      targetMode: 'local',
      repoRoot: '/repo',
      outputPath: 'workflows/generated/reference-spec.ts',
      relevantFiles: [],
      specPath: '/repo/docs/plans/big-spec.md',
    });
    expect(task).toContain('Spec source file');
    expect(task).toContain('/repo/docs/plans/big-spec.md');
    expect(task).toContain('Read the spec file for full content');
    expect(task).toContain('<<truncated');
    // Top-level "Normalized spec JSON" wording should reflect the truncation note.
    expect(task).toContain('description/targetContext truncated when oversized; raw spec payload elided');
    // Total task body must be well under 200 KB regardless of input size.
    expect(task.length).toBeLessThan(200 * 1024);
  });

  it('keeps the original raw spec text out of the writer task body', () => {
    // Place the sentinel in the middle of an oversized description so that
    // head/tail truncation excludes it from the inlined description AND so
    // that raw-payload elision is the only path that could surface it.
    const sentinel = 'SECRET-RAW-SPEC-SENTINEL';
    const description = `${'A'.repeat(80_000)}${sentinel}${'B'.repeat(80_000)}`;
    const task = buildWorkflowPersonaTask(spec({ description }), {
      workflowName: 'elision',
      targetMode: 'local',
      repoRoot: '/repo',
      outputPath: 'workflows/generated/elision.ts',
      relevantFiles: [],
      specPath: '/repo/docs/plans/big-spec.md',
    });
    // The unique sentinel must not appear verbatim because both description
    // and rawPayload.text are summarized/elided.
    expect(task).not.toContain(sentinel);
    expect(task).toContain('<<elided');
  });
});

describe('workforce persona reviewer verdict parsing', () => {
  it('prefers the LAST ```json fenced verdict over an earlier draft block', async () => {
    const { parseReviewerVerdict } = await import('./workforce-persona-reviewer.js');
    const output = [
      'First, a draft assessment:',
      '```json',
      JSON.stringify({ verdict: 'fix', summary: 'draft', fixes: [{ severity: 'critical', area: 'x', finding: 'y', requestedChange: 'z' }] }),
      '```',
      '',
      'After reviewing more carefully, my final verdict:',
      '```json',
      JSON.stringify({ verdict: 'pass', summary: 'final approval', fixes: [] }),
      '```',
    ].join('\n');
    const result = parseReviewerVerdict(output);
    expect(result.verdict).toBe('pass');
    expect(result.summary).toBe('final approval');
    expect(result.fixes).toEqual([]);
  });

  it('ignores ```json blocks that nest inside an audited workflow source', async () => {
    const { parseReviewerVerdict } = await import('./workforce-persona-reviewer.js');
    // A reviewer audit response that includes the workflow source the
    // reviewer is auditing (inside ```ts) MUST NOT pick up any nested
    // json-looking content from the workflow body. The mdast walker only
    // returns top-level fenced code blocks with lang=json, so the inner
    // workflow source is invisible.
    const output = [
      'Audit of the generated workflow:',
      '```ts',
      'const example = { "verdict": "fix", "summary": "this is INSIDE the workflow source, not a verdict" };',
      '```',
      '',
      'My verdict:',
      '```json',
      JSON.stringify({ verdict: 'pass', summary: 'all good', fixes: [] }),
      '```',
    ].join('\n');
    const result = parseReviewerVerdict(output);
    expect(result.verdict).toBe('pass');
    expect(result.summary).toBe('all good');
  });

  it('falls through to trailing balanced-JSON when no fenced block carries a verdict', async () => {
    const { parseReviewerVerdict } = await import('./workforce-persona-reviewer.js');
    const output = `I reviewed the workflow and here is my verdict:\n\n${JSON.stringify({ verdict: 'fix', summary: 's', fixes: [{ severity: 'important', area: 'a', finding: 'f', requestedChange: 'r' }] })}`;
    const result = parseReviewerVerdict(output);
    expect(result.verdict).toBe('fix');
    expect(result.fixes).toHaveLength(1);
  });

  it('synthesizes block verdict when no candidate parses', async () => {
    const { parseReviewerVerdict } = await import('./workforce-persona-reviewer.js');
    const result = parseReviewerVerdict('I have opinions but no JSON to share today.');
    expect(result.verdict).toBe('block');
    expect(result.summary).toMatch(/Reviewer response did not contain a parseable verdict JSON/);
    expect(result.fixes).toEqual([]);
  });
});

describe('workforce persona reviewer pass', () => {
  it('passes the writer artifact through when the reviewer returns verdict=pass', async () => {
    const baseGen = generate({
      spec: spec({
        description: 'Implement a strict Agent Relay workflow with tests and review.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/reviewer-pass.ts',
    });
    expect(baseGen.success).toBe(true);
    const writerArtifact = baseGen.artifact!.content;

    const intentCalls: string[] = [];
    const resolver: WorkforcePersonaResolver = async (intents) => {
      const intent = intents[0];
      intentCalls.push(intent);
      return {
        source: 'package',
        intent,
        warnings: [],
        context: {
          selection: {
            personaId: intent,
            tier: intent === 'review' ? 'best' : 'best-value',
            runtime: { harness: 'claude', model: intent === 'review' ? 'claude-opus-4-7' : 'claude-sonnet-4-6' },
          },
          sendMessage() {
            if (intent === 'review') {
              return execution(JSON.stringify({ verdict: 'pass', summary: 'All checks green.', fixes: [] }));
            }
            return execution(personaResponse('workflows/generated/reviewer-pass.ts', writerArtifact));
          },
        },
      };
    };

    const result = await generateWithWorkforcePersona({
      spec: spec({
        description: 'Implement a strict Agent Relay workflow with tests and review.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/reviewer-pass.ts',
      workforcePersonaWriter: {
        repoRoot: '/repo',
        workflowName: 'reviewer-pass',
        targetMode: 'local',
        resolver,
        review: { personaIntentCandidates: ['review'] },
      },
    });

    expect(result.success).toBe(true);
    expect(intentCalls).toContain('review');
    expect(result.workforcePersona?.review).toMatchObject({
      verdict: 'pass',
      personaId: 'review',
      tier: 'best',
      model: 'claude-opus-4-7',
      selectedIntent: 'review',
      appliedFix: false,
    });
    expect(result.artifact?.content).toBe(writerArtifact);
  });

  it('feeds reviewer fixes back to the writer for a single repair attempt when verdict=fix', async () => {
    const baseGen = generate({
      spec: spec({
        description: 'Implement a strict Agent Relay workflow with tests and review.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/reviewer-fix.ts',
    });
    expect(baseGen.success).toBe(true);
    const writerFirstArtifact = baseGen.artifact!.content;
    const writerRepairArtifact = baseGen.artifact!.content.replace(/Persona generated workflow/g, 'Repaired by reviewer feedback');
    const writerCalls: string[] = [];
    let reviewerInvocations = 0;

    const resolver: WorkforcePersonaResolver = async (intents) => {
      const intent = intents[0];
      return {
        source: 'package',
        intent,
        warnings: [],
        context: {
          selection: {
            personaId: intent,
            tier: intent === 'review' ? 'best' : 'best-value',
            runtime: { harness: 'claude', model: intent === 'review' ? 'claude-opus-4-7' : 'claude-sonnet-4-6' },
          },
          sendMessage(task) {
            if (intent === 'review') {
              reviewerInvocations += 1;
              return execution(JSON.stringify({
                verdict: 'fix',
                summary: 'Swarm pattern does not match the spec Merge DAG.',
                fixes: [{
                  severity: 'critical',
                  area: 'swarm-pattern',
                  finding: 'Pipeline serializes parallel tracks.',
                  requestedChange: 'Switch to a dag pattern with parallel child invocations per Track.',
                }],
              }));
            }
            const isRepair = task.includes('Ricky pre-write validation failed on your previous artifact.');
            writerCalls.push(isRepair ? 'writer-repair' : 'writer-first');
            return execution(personaResponse(
              'workflows/generated/reviewer-fix.ts',
              isRepair ? writerRepairArtifact : writerFirstArtifact,
            ));
          },
        },
      };
    };

    const result = await generateWithWorkforcePersona({
      spec: spec({
        description: 'Implement a strict Agent Relay workflow with tests and review.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/reviewer-fix.ts',
      workforcePersonaWriter: {
        repoRoot: '/repo',
        workflowName: 'reviewer-fix',
        targetMode: 'local',
        resolver,
        review: { personaIntentCandidates: ['review'] },
      },
    });

    expect(result.success).toBe(true);
    expect(reviewerInvocations).toBe(1);
    expect(writerCalls).toEqual(['writer-first', 'writer-repair']);
    expect(result.workforcePersona?.review).toMatchObject({
      verdict: 'fix',
      appliedFix: true,
      fixes: [{ severity: 'critical', area: 'swarm-pattern' }],
    });
    expect(result.artifact?.content).toBe(writerRepairArtifact);
  });

  it('returns verdict=block with no fixes and keeps the writer artifact when reviewer output is unparseable', async () => {
    const baseGen = generate({
      spec: spec({
        description: 'Implement a strict Agent Relay workflow with tests and review.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/reviewer-block.ts',
    });
    expect(baseGen.success).toBe(true);
    const writerArtifact = baseGen.artifact!.content;
    const resolver: WorkforcePersonaResolver = async (intents) => {
      const intent = intents[0];
      return {
        source: 'package',
        intent,
        warnings: [],
        context: {
          selection: {
            personaId: intent,
            tier: intent === 'review' ? 'best' : 'best-value',
            runtime: { harness: 'claude', model: intent === 'review' ? 'claude-opus-4-7' : 'claude-sonnet-4-6' },
          },
          sendMessage() {
            if (intent === 'review') {
              // Reviewer emitted prose with no JSON verdict; pipeline should treat as block.
              return execution('I looked at the workflow and have concerns but no parseable verdict block.');
            }
            return execution(personaResponse('workflows/generated/reviewer-block.ts', writerArtifact));
          },
        },
      };
    };

    const result = await generateWithWorkforcePersona({
      spec: spec({
        description: 'Implement a strict Agent Relay workflow with tests and review.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/reviewer-block.ts',
      workforcePersonaWriter: {
        repoRoot: '/repo',
        workflowName: 'reviewer-block',
        targetMode: 'local',
        resolver,
        review: { personaIntentCandidates: ['review'] },
      },
    });

    expect(result.success).toBe(true);
    expect(result.workforcePersona?.review).toMatchObject({
      verdict: 'block',
      appliedFix: false,
      fixes: [],
    });
    // Block-with-no-fixes path leaves the writer artifact intact.
    expect(result.artifact?.content).toBe(writerArtifact);
  });

  it('skips the review pass when workforcePersonaWriter.review is false', async () => {
    const baseGen = generate({
      spec: spec({
        description: 'Implement a strict Agent Relay workflow with tests and review.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/reviewer-off.ts',
    });
    expect(baseGen.success).toBe(true);
    const writerArtifact = baseGen.artifact!.content;
    const intentCalls: string[] = [];
    const resolver: WorkforcePersonaResolver = async (intents) => {
      const intent = intents[0];
      intentCalls.push(intent);
      return {
        source: 'package',
        intent,
        warnings: [],
        context: {
          selection: {
            personaId: intent,
            tier: 'best-value',
            runtime: { harness: 'claude', model: 'claude-sonnet-4-6' },
          },
          sendMessage() {
            return execution(personaResponse('workflows/generated/reviewer-off.ts', writerArtifact));
          },
        },
      };
    };

    const result = await generateWithWorkforcePersona({
      spec: spec({
        description: 'Implement a strict Agent Relay workflow with tests and review.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/reviewer-off.ts',
      workforcePersonaWriter: {
        repoRoot: '/repo',
        workflowName: 'reviewer-off',
        targetMode: 'local',
        resolver,
        review: false,
      },
    });

    expect(result.success).toBe(true);
    expect(intentCalls).not.toContain('review');
    expect(result.workforcePersona?.review).toBeUndefined();
  });

  it('records verdict=block + non-empty fixes WITHOUT triggering a writer repair', async () => {
    const baseGen = generate({
      spec: spec({
        description: 'Implement a strict Agent Relay workflow with tests and review.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/reviewer-block-with-fixes.ts',
    });
    expect(baseGen.success).toBe(true);
    const writerArtifact = baseGen.artifact!.content;
    const writerCalls: string[] = [];

    const resolver: WorkforcePersonaResolver = async (intents) => {
      const intent = intents[0];
      return {
        source: 'package',
        intent,
        warnings: [],
        context: {
          selection: {
            personaId: intent,
            tier: intent === 'review' ? 'best' : 'best-value',
            runtime: { harness: 'claude', model: intent === 'review' ? 'claude-opus-4-7' : 'claude-sonnet-4-6' },
          },
          sendMessage(task) {
            if (intent === 'review') {
              // `block` + non-empty fixes: pipeline must record the verdict
              // but not feed the fixes back into a writer repair attempt.
              return execution(JSON.stringify({
                verdict: 'block',
                summary: 'Spec is planning-only but writer produced implementation work.',
                fixes: [{ severity: 'critical', area: 'scope', finding: 'Spec drift', requestedChange: 'Stop and re-scope.' }],
              }));
            }
            const isRepair = task.includes('Ricky pre-write validation failed on your previous artifact.');
            writerCalls.push(isRepair ? 'writer-repair' : 'writer-first');
            return execution(personaResponse('workflows/generated/reviewer-block-with-fixes.ts', writerArtifact));
          },
        },
      };
    };

    const result = await generateWithWorkforcePersona({
      spec: spec({
        description: 'Implement a strict Agent Relay workflow with tests and review.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/reviewer-block-with-fixes.ts',
      workforcePersonaWriter: {
        repoRoot: '/repo',
        workflowName: 'reviewer-block-with-fixes',
        targetMode: 'local',
        resolver,
        review: { personaIntentCandidates: ['review'] },
      },
    });

    expect(result.success).toBe(true);
    // Writer must have been called exactly once — `block` short-circuits
    // the repair attempt.
    expect(writerCalls).toEqual(['writer-first']);
    expect(result.workforcePersona?.review).toMatchObject({
      verdict: 'block',
      appliedFix: false,
      fixes: [{ severity: 'critical', area: 'scope' }],
    });
    expect(result.artifact?.content).toBe(writerArtifact);
  });

  it('records verdict=error when the reviewer pass itself throws', async () => {
    const baseGen = generate({
      spec: spec({
        description: 'Implement a strict Agent Relay workflow with tests and review.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/reviewer-crashed.ts',
    });
    expect(baseGen.success).toBe(true);
    const writerArtifact = baseGen.artifact!.content;

    const resolver: WorkforcePersonaResolver = async (intents) => {
      const intent = intents[0];
      if (intent === 'review') {
        // Simulate a reviewer-side crash (e.g. resolver/harness failure).
        // The pipeline catch block must mark the verdict as `error`, not
        // `pass` — otherwise downstream automation misreads "reviewer
        // crashed" as "reviewer approved."
        throw new Error('synthetic reviewer harness failure');
      }
      return {
        source: 'package',
        intent,
        warnings: [],
        context: {
          selection: {
            personaId: intent,
            tier: 'best-value',
            runtime: { harness: 'claude', model: 'claude-sonnet-4-6' },
          },
          sendMessage() {
            return execution(personaResponse('workflows/generated/reviewer-crashed.ts', writerArtifact));
          },
        },
      };
    };

    const result = await generateWithWorkforcePersona({
      spec: spec({
        description: 'Implement a strict Agent Relay workflow with tests and review.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/reviewer-crashed.ts',
      workforcePersonaWriter: {
        repoRoot: '/repo',
        workflowName: 'reviewer-crashed',
        targetMode: 'local',
        resolver,
        review: { personaIntentCandidates: ['review'] },
      },
    });

    expect(result.success).toBe(true);
    expect(result.workforcePersona?.review).toMatchObject({
      verdict: 'error',
      appliedFix: false,
      fixes: [],
    });
    expect(result.workforcePersona?.review?.summary).toContain('synthetic reviewer harness failure');
    expect(result.artifact?.content).toBe(writerArtifact);
  });
});

describe('persona debug dump', () => {
  function dumpInputs(repoRoot: string, overrides: Partial<{ reason: 'noncompletion' | 'parse-error' | 'no-content' | 'success'; output: string; promptDigest: string }> = {}) {
    return {
      kind: 'writer' as const,
      reason: overrides.reason ?? 'parse-error',
      repoRoot,
      promptDigest: overrides.promptDigest ?? 'a'.repeat(64),
      task: 'task body',
      result: {
        status: 'completed' as const,
        output: overrides.output ?? 'free-form sonnet prose',
        stderr: '',
        exitCode: 0,
        durationMs: 4242,
        workflowRunId: 'debug-dump-run',
        stepName: 'agent-relay-workflow',
      },
      selection: {
        personaId: 'agent-relay-workflow',
        tier: 'best-value',
        runtime: { harness: 'claude' as const, model: 'claude-sonnet-4-6' },
      },
      resolved: {
        source: 'package' as const,
        intent: 'agent-relay-workflow',
        warnings: ['Ricky-local Claude persona override resolved for intent "agent-relay-workflow" at tier "best-value".'],
        context: {
          selection: {
            personaId: 'agent-relay-workflow',
            tier: 'best-value',
            runtime: { harness: 'claude' as const, model: 'claude-sonnet-4-6' },
          },
          sendMessage() {
            throw new Error('not invoked in debug-dump tests');
          },
        },
      },
      outputPath: 'workflows/generated/dump.ts',
    };
  }

  let repoRoot: string | undefined;
  afterEach(async () => {
    if (repoRoot) {
      await import('node:fs/promises').then(({ rm }) => rm(repoRoot!, { recursive: true, force: true }));
      repoRoot = undefined;
    }
  });

  it('writes output.raw.txt, task.prompt.txt, and meta.json on the parse-error path', async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'ricky-persona-dump-'));
    await dumpPersonaDebug(dumpInputs(repoRoot, { reason: 'parse-error', output: 'verbatim sonnet output' }));

    const dir = join(repoRoot, '.workflow-artifacts', 'ricky-persona-debug', 'writer', `${'a'.repeat(16)}-parse-error`);
    expect(existsSync(dir)).toBe(true);
    const raw = await readFile(join(dir, 'output.raw.txt'), 'utf8');
    const task = await readFile(join(dir, 'task.prompt.txt'), 'utf8');
    const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as Record<string, unknown>;

    expect(raw).toBe('verbatim sonnet output');
    expect(task).toBe('task body');
    expect(meta).toMatchObject({
      kind: 'writer',
      reason: 'parse-error',
      outputPath: 'workflows/generated/dump.ts',
      selection: { personaId: 'agent-relay-workflow', tier: 'best-value', harness: 'claude', model: 'claude-sonnet-4-6' },
      result: { status: 'completed', exitCode: 0, durationMs: 4242 },
      resolverIntent: 'agent-relay-workflow',
    });
  });

  it('skips the success-path dump unless RICKY_PERSONA_DEBUG=1', async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'ricky-persona-dump-'));
    const originalFlag = process.env.RICKY_PERSONA_DEBUG;
    delete process.env.RICKY_PERSONA_DEBUG;
    try {
      await dumpPersonaDebug(dumpInputs(repoRoot, { reason: 'success' }));
      const dir = join(repoRoot, '.workflow-artifacts', 'ricky-persona-debug', 'writer', `${'a'.repeat(16)}-success`);
      expect(existsSync(dir)).toBe(false);
    } finally {
      if (originalFlag !== undefined) process.env.RICKY_PERSONA_DEBUG = originalFlag;
    }
  });

  it('records the success-path dump when RICKY_PERSONA_DEBUG=1', async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'ricky-persona-dump-'));
    const originalFlag = process.env.RICKY_PERSONA_DEBUG;
    process.env.RICKY_PERSONA_DEBUG = '1';
    try {
      await dumpPersonaDebug(dumpInputs(repoRoot, { reason: 'success' }));
      const dir = join(repoRoot, '.workflow-artifacts', 'ricky-persona-debug', 'writer', `${'a'.repeat(16)}-success`);
      expect(existsSync(dir)).toBe(true);
    } finally {
      if (originalFlag === undefined) {
        delete process.env.RICKY_PERSONA_DEBUG;
      } else {
        process.env.RICKY_PERSONA_DEBUG = originalFlag;
      }
    }
  });

  it('silently swallows dump errors when the repo root is unwritable', async () => {
    // /nonexistent-ricky-test-root cannot be created without root; the helper
    // must not throw or noisily log to stderr by default.
    await expect(
      dumpPersonaDebug({
        ...dumpInputs('/nonexistent-ricky-test-root-' + Date.now(), { reason: 'parse-error' }),
      }),
    ).resolves.toBeUndefined();
  });
});

describe('detectSpecIntentMismatch (writer first-emit guard)', () => {
  // Complements `detectWorkflowIntentRegressions` in
  // workforce-persona-repairer.ts: that one catches regressions during
  // repair, this one catches a degenerate first emit so the pre-write
  // repair loop is given a chance to recover the work before the workflow
  // ever reaches disk / runtime-launch.

  it('flags a workflow that omits github-primitive imports when the spec declares a PR-shipping outcome', () => {
    const spec = {
      description: [
        '# Spec: cloud-side cli-login + auth exchange',
        '',
        'Outcome: **one pull request in `cloud` opened against `origin/main`.**',
        '',
        'The workflow must use createGitHubStep from @agent-relay/github-primitive.',
      ].join('\n'),
    };
    const stubWorkflow = [
      'import { workflow } from "@agent-relay/sdk/workflows";',
      'async function main() {',
      '  await workflow("stub")',
      '    .pattern("dag")',
      '    .step("prepare-context", { type: "deterministic", command: "true" })',
      '    .step("lead-plan", { type: "deterministic", command: "true" })',
      '    .step("materialize-child-workflows", { type: "deterministic", command: "true" })',
      '    .step("final-signoff", { type: "deterministic", command: "echo done" })',
      '    .run({ cwd: process.cwd() });',
      '}',
      'main().catch((e) => { console.error(e); process.exitCode = 1; });',
    ].join('\n');
    const mismatches = detectSpecIntentMismatch(spec, stubWorkflow);
    expect(mismatches.some((m) => m.includes('PR-shipping outcome'))).toBe(true);
  });

  it('does NOT flag a workflow that imports @agent-relay/github-primitive even when the spec declares PR shipping', () => {
    const spec = {
      description: 'Outcome: **one pull request in `cloud` opened against `origin/main`.**',
    };
    const realWorkflow = [
      'import { workflow } from "@agent-relay/sdk/workflows";',
      'import { GitHubStepExecutor, createGitHubStep } from "@agent-relay/github-primitive";',
      'async function main() {',
      '  await workflow("real")',
      '    .step("open-pr", createGitHubStep({ action: "openPullRequest", branch: "feat/foo" }))',
      '    .run({ cwd: process.cwd() });',
      '}',
      'main().catch((e) => { console.error(e); process.exitCode = 1; });',
    ].join('\n');
    expect(detectSpecIntentMismatch(spec, realWorkflow)).toEqual([]);
  });

  it('also accepts the `@agent-relay/sdk/github` import path (used by some persona variants)', () => {
    const spec = {
      description: 'Outcome: **one pull request in `cloud` opened against `origin/main`.**',
    };
    const realWorkflow = [
      'import { workflow } from "@agent-relay/sdk/workflows";',
      'import { createGitHubStep } from "@agent-relay/sdk/github";',
      'async function main() {',
      '  await workflow("real").step("open-pr", createGitHubStep({ action: "openPullRequest" })).run({ cwd: process.cwd() });',
      '}',
      'main().catch((e) => { console.error(e); process.exitCode = 1; });',
    ].join('\n');
    expect(detectSpecIntentMismatch(spec, realWorkflow)).toEqual([]);
  });

  it('flags a workflow with fewer than 4 top-level steps when the spec is large (>4 KB)', () => {
    const spec = {
      description: 'Outcome: one PR.\n' + 'detail '.repeat(700), // ~5 KB
    };
    const tinyWorkflow = [
      'import { workflow } from "@agent-relay/sdk/workflows";',
      'import { createGitHubStep } from "@agent-relay/github-primitive";',
      'async function main() {',
      '  await workflow("tiny")',
      '    .step("only-step", createGitHubStep({ action: "openPullRequest" }))',
      '    .run({ cwd: process.cwd() });',
      '}',
      'main().catch((e) => { console.error(e); process.exitCode = 1; });',
    ].join('\n');
    const mismatches = detectSpecIntentMismatch(spec, tinyWorkflow);
    expect(mismatches.some((m) => m.includes('master-executor stub'))).toBe(true);
  });

  it('does NOT trip the step-count floor on a small spec (<4 KB)', () => {
    const spec = {
      description: 'Tiny spec asking for one PR. Outcome: one pull request in cloud.',
    };
    const tinyButValidWorkflow = [
      'import { workflow } from "@agent-relay/sdk/workflows";',
      'import { createGitHubStep } from "@agent-relay/github-primitive";',
      'async function main() {',
      '  await workflow("tiny-spec").step("open-pr", createGitHubStep({ action: "openPullRequest" })).run({ cwd: process.cwd() });',
      '}',
      'main().catch((e) => { console.error(e); process.exitCode = 1; });',
    ].join('\n');
    expect(detectSpecIntentMismatch(spec, tinyButValidWorkflow)).toEqual([]);
  });

  it('uses spec.description length, not combined structured spec text, for the step-count floor', () => {
    const spec = {
      description: 'Small spec asking for one PR. Outcome: one pull request in cloud.',
      constraints: [
        { constraint: 'Structured constraint detail. '.repeat(80) },
        { constraint: 'More structured constraint detail. '.repeat(80) },
      ],
      acceptanceGates: [
        { gate: 'Acceptance gate detail. '.repeat(80) },
      ],
      evidenceRequirements: [
        { requirement: 'Evidence requirement detail. '.repeat(80) },
      ],
    };
    const tinyButValidWorkflow = [
      'import { workflow } from "@agent-relay/sdk/workflows";',
      'import { createGitHubStep } from "@agent-relay/github-primitive";',
      'async function main() {',
      '  await workflow("tiny-structured-spec").step("open-pr", createGitHubStep({ action: "openPullRequest" })).run({ cwd: process.cwd() });',
      '}',
      'main().catch((e) => { console.error(e); process.exitCode = 1; });',
    ].join('\n');

    const mismatches = detectSpecIntentMismatch(spec, tinyButValidWorkflow);

    expect(mismatches.some((m) => m.includes('master-executor stub'))).toBe(false);
  });

  it('does NOT flag PR-shipping mismatch when the spec is silent about PRs', () => {
    const spec = { description: 'A planning-only spec; do not ship anything.' };
    const planOnlyWorkflow = [
      'import { workflow } from "@agent-relay/sdk/workflows";',
      'async function main() {',
      '  await workflow("plan-only").step("draft", { type: "deterministic", command: "echo plan" }).run({ cwd: process.cwd() });',
      '}',
      'main().catch((e) => { console.error(e); process.exitCode = 1; });',
    ].join('\n');
    expect(detectSpecIntentMismatch(spec, planOnlyWorkflow)).toEqual([]);
  });

  it('flags a workflow that hides createGitHubStep inside a comment (#120 devin BUG_0001)', () => {
    // Reviewer concern: raw regex would match `createGitHubStep` inside a
    // `// TODO: createGitHubStep` comment and falsely satisfy the guard.
    // The AST walk only counts Identifier nodes in executable positions.
    const spec = { description: 'Outcome: **one pull request in `cloud` opened against `origin/main`.**' };
    const stubWithCommentDecoy = [
      'import { workflow } from "@agent-relay/sdk/workflows";',
      '// TODO: wire up createGitHubStep + GitHubStepExecutor from @agent-relay/github-primitive in a follow-up',
      'async function main() {',
      '  await workflow("stub").step("only", { type: "deterministic", command: "echo placeholder" }).run({ cwd: process.cwd() });',
      '}',
      'main().catch((e) => { console.error(e); process.exitCode = 1; });',
    ].join('\n');
    const mismatches = detectSpecIntentMismatch(spec, stubWithCommentDecoy);
    expect(mismatches.some((m) => m.includes('PR-shipping outcome'))).toBe(true);
  });

  it('flags a workflow that hides PR-shipping symbols only inside string literals', () => {
    const spec = { description: 'Outcome: **one pull request in `cloud` opened against `origin/main`.**' };
    const stubWithStringDecoy = [
      'import { workflow } from "@agent-relay/sdk/workflows";',
      'async function main() {',
      '  await workflow("stub")',
      '    .step("draft", {',
      '      type: "deterministic",',
      '      // The literal text below is for a child-workflow definition, not an actual import',
      '      command: `cat <<EOF > /tmp/note\\nimport { GitHubStepExecutor, createGitHubStep } from "@agent-relay/github-primitive";\\nEOF`,',
      '    })',
      '    .run({ cwd: process.cwd() });',
      '}',
      'main().catch((e) => { console.error(e); process.exitCode = 1; });',
    ].join('\n');
    const mismatches = detectSpecIntentMismatch(spec, stubWithStringDecoy);
    expect(mismatches.some((m) => m.includes('PR-shipping outcome'))).toBe(true);
  });

  it('counts only top-level .step() chain calls, ignoring .step("...") buried inside string literals (#120 devin BUG_0002)', () => {
    // The motivating failure: master-executor stub with createGitHubStep
    // and many `.step("...")` calls hidden in child-workflow string
    // literals. Raw regex would count them, inflating the count past the
    // <4 threshold and silently passing the guard.
    const spec = {
      description: 'Outcome: one PR.\n' + 'detail '.repeat(700), // ~5 KB
    };
    const stubWithNestedSteps = [
      'import { workflow } from "@agent-relay/sdk/workflows";',
      'import { createGitHubStep } from "@agent-relay/github-primitive";',
      'async function main() {',
      '  await workflow("master")',
      '    .step("prepare-context", { type: "deterministic", command: "true" })',
      '    .step("materialize-child-workflows", {',
      '      type: "deterministic",',
      '      // The string below would contain 12 .step("...") calls inside it as a child workflow definition.',
      '      command: `cat <<\\\'EOF\\\' > /tmp/child.ts\\n',
      '.step("c1", ...) .step("c2", ...) .step("c3", ...) .step("c4", ...) .step("c5", ...)\\n',
      '.step("c6", ...) .step("c7", ...) .step("c8", ...) .step("c9", ...) .step("c10", ...)\\n',
      '.step("c11", ...) .step("c12", ...)\\n',
      'EOF`,',
      '    })',
      '    .step("final-signoff", { type: "deterministic", command: "echo done" })',
      '    .run({ cwd: process.cwd() });',
      '}',
      'main().catch((e) => { console.error(e); process.exitCode = 1; });',
    ].join('\n');
    // Top-level .step() count is 3 (prepare-context, materialize-child-workflows, final-signoff)
    // — even though 12 .step("c*", ...) sequences appear inside the
    // string literal command body. Step-count floor must fire.
    const mismatches = detectSpecIntentMismatch(spec, stubWithNestedSteps);
    expect(mismatches.some((m) => m.includes('master-executor stub'))).toBe(true);
    expect(mismatches.some((m) => /declares only 3 top-level/.test(m))).toBe(true);
  });

  it('flags a spec mentioning @agent-relay/github-primitive — the leading-\\\\b regex fix lands (#120 cubic-dev-ai P2)', () => {
    // Prior regex used a leading `\\b` which is unreachable before `@`
    // (a non-word character must be preceded by a word character for
    // `\\b` to fire). The fix uses `(?<!\\w)` instead. Spec that uses the
    // package name as a PR-shipping marker must now correctly flag the
    // guard.
    const spec = {
      description: 'Use @agent-relay/github-primitive in the generated workflow.',
    };
    const stubWithoutGithubPrimitive = [
      'import { workflow } from "@agent-relay/sdk/workflows";',
      'async function main() { await workflow("x").step("y", { type: "deterministic", command: "true" }).run({ cwd: process.cwd() }); }',
      'main().catch((e) => { process.exitCode = 1; });',
    ].join('\n');
    const mismatches = detectSpecIntentMismatch(spec, stubWithoutGithubPrimitive);
    expect(mismatches.some((m) => m.includes('PR-shipping outcome'))).toBe(true);
  });

  it('reproduces the 2026-05-16 cloud MCP cloud-spawn pr-02 failure mode: 180-line master-executor stub with no github-primitive', () => {
    // Verbatim shape of the failure that prompted this PR. The spec
    // declares `Outcome: one pull request` AND is large (~6 KB). The
    // writer's first emit was a 180-line stub whose top-level steps are
    // just `prepare-context → lead-plan → materialize-child-workflows →
    // final-hard-validation → final-signoff` with createGitHubStep
    // hidden inside nested-string child workflow definitions that ricky's
    // auto-fix loop could not materialize. Both checks fire.
    const spec = {
      description:
        '# Spec: local-sandbox-runner sidecar implementation\n' +
        'Outcome: **one pull request in `cloud` opened against `origin/main`.**\n' +
        'The workflow must use createGitHubStep from @agent-relay/github-primitive.\n' +
        ('## Acceptance\n- impl files exist\n- typecheck green\n- docker builds\n').repeat(80), // pad over 4 KB
    };
    const stub = [
      'import { workflow } from "@agent-relay/sdk/workflows";',
      '// IMPLEMENTATION_WORKFLOW_CONTRACT: master-executor wrapping nested child workflows',
      'async function main() {',
      '  await workflow("stub")',
      '    .step("prepare-context", { type: "deterministic", command: "true" })',
      '    .step("lead-plan", { type: "deterministic", command: "true" })',
      '    .step("materialize-child-workflows", { type: "deterministic", command: "echo defer" })',
      '    .step("final-signoff", { type: "deterministic", command: "echo done" })',
      '    .run({ cwd: process.cwd() });',
      '}',
      'main().catch((e) => { console.error(e); process.exitCode = 1; });',
    ].join('\n');
    const mismatches = detectSpecIntentMismatch(spec, stub);
    expect(mismatches.length).toBeGreaterThanOrEqual(1);
    expect(mismatches.some((m) => m.includes('PR-shipping outcome'))).toBe(true);
  });

  it('flags workflows that ignore a spec-declared worktree setup contract', () => {
    const spec = {
      description: [
        'Outcome: one pull request in cloud opened against origin/main.',
        'Worktree: /private/tmp/cloud-relay-slack-bridge-outbound-streaming',
        'Target branch: feat/relay-slack-bridge-outbound-streaming',
      ].join('\n'),
    };
    const workflowWithoutWorktreeSetup = [
      'import { workflow } from "@agent-relay/sdk/workflows";',
      'import { createGitHubStep } from "@agent-relay/github-primitive";',
      'async function main() {',
      '  await workflow("missing-worktree")',
      '    .step("implement", { type: "deterministic", command: "npm test" })',
      '    .step("open-pr", createGitHubStep({ action: "openPullRequest" }))',
      '    .run({ cwd: process.cwd() });',
      '}',
      'main().catch((e) => { console.error(e); process.exitCode = 1; });',
    ].join('\n');

    const mismatches = detectSpecIntentMismatch(spec, workflowWithoutWorktreeSetup);

    expect(mismatches).toEqual(
      expect.arrayContaining([
        expect.stringContaining('no executable workflow step command contains that exact worktree path'),
        expect.stringContaining('no runtime git worktree add setup step'),
        expect.stringContaining('no executable workflow step command contains that exact branch name'),
      ]),
    );
  });

  it('flags workflows that hide worktree setup only inside comments or heredoc bodies', () => {
    const spec = {
      description: [
        'Outcome: one pull request in cloud opened against origin/main.',
        'Worktree: /private/tmp/cloud-relay-slack-bridge-outbound-streaming',
        'Target branch: feat/relay-slack-bridge-outbound-streaming',
      ].join('\n'),
    };
    const workflowWithDecoyWorktreeSetup = [
      'import { workflow } from "@agent-relay/sdk/workflows";',
      'import { createGitHubStep } from "@agent-relay/github-primitive";',
      'async function main() {',
      '  await workflow("decoy-worktree")',
      '    .step("write-notes", {',
      '      type: "deterministic",',
      '      command: `# git worktree add /private/tmp/cloud-relay-slack-bridge-outbound-streaming feat/relay-slack-bridge-outbound-streaming\\ncat <<\\\'EOF\\\' > /tmp/note\\ngit worktree add /private/tmp/cloud-relay-slack-bridge-outbound-streaming feat/relay-slack-bridge-outbound-streaming\\nEOF`,',
      '    })',
      '    .step("implement", { type: "deterministic", command: "npm test" })',
      '    .step("open-pr", createGitHubStep({ action: "openPullRequest" }))',
      '    .run({ cwd: process.cwd() });',
      '}',
      'main().catch((e) => { console.error(e); process.exitCode = 1; });',
    ].join('\n');

    const mismatches = detectSpecIntentMismatch(spec, workflowWithDecoyWorktreeSetup);

    expect(mismatches).toEqual(
      expect.arrayContaining([
        expect.stringContaining('no executable workflow step command contains that exact worktree path'),
        expect.stringContaining('no runtime git worktree add setup step'),
        expect.stringContaining('no executable workflow step command contains that exact branch name'),
      ]),
    );
  });

  it('extracts declared worktree fields from markdown text without reading fenced examples as declarations', () => {
    const spec = {
      description: [
        '```text',
        'Worktree: /private/tmp/example-only',
        'Target branch: feat/example-only',
        '```',
        '- Worktree: `/private/tmp/cloud-relay-slack-bridge-outbound-streaming`',
        '- Target branch: `feat/relay-slack-bridge-outbound-streaming`',
      ].join('\n'),
    };
    const workflowWithWorktreeSetup = [
      'import { workflow } from "@agent-relay/sdk/workflows";',
      'import { createGitHubStep } from "@agent-relay/github-primitive";',
      'async function main() {',
      '  await workflow("with-worktree")',
      '    .step("setup-worktree", { type: "deterministic", command: "git worktree add /private/tmp/cloud-relay-slack-bridge-outbound-streaming feat/relay-slack-bridge-outbound-streaming" })',
      '    .step("implement", { type: "deterministic", command: "git -C /private/tmp/cloud-relay-slack-bridge-outbound-streaming status --short" })',
      '    .step("open-pr", createGitHubStep({ action: "openPullRequest" }))',
      '    .run({ cwd: process.cwd() });',
      '}',
      'main().catch((e) => { console.error(e); process.exitCode = 1; });',
    ].join('\n');

    expect(detectSpecIntentMismatch(spec, workflowWithWorktreeSetup)).toEqual([]);
  });

  it('flags implementation steps that use the declared worktree before setup', () => {
    const spec = {
      description: [
        'Outcome: one pull request in cloud opened against origin/main.',
        'Worktree: /private/tmp/cloud-relay-slack-bridge-outbound-streaming',
        'Target branch: feat/relay-slack-bridge-outbound-streaming',
      ].join('\n'),
    };
    const workflowWithLateWorktreeSetup = [
      'import { workflow } from "@agent-relay/sdk/workflows";',
      'import { createGitHubStep } from "@agent-relay/github-primitive";',
      'async function main() {',
      '  await workflow("late-worktree")',
      '    .step("implement", { type: "deterministic", command: "git -C /private/tmp/cloud-relay-slack-bridge-outbound-streaming status --short" })',
      '    .step("setup-worktree", { type: "deterministic", command: "git worktree add /private/tmp/cloud-relay-slack-bridge-outbound-streaming feat/relay-slack-bridge-outbound-streaming" })',
      '    .step("open-pr", createGitHubStep({ action: "openPullRequest" }))',
      '    .run({ cwd: process.cwd() });',
      '}',
      'main().catch((e) => { console.error(e); process.exitCode = 1; });',
    ].join('\n');

    const mismatches = detectSpecIntentMismatch(spec, workflowWithLateWorktreeSetup);

    expect(mismatches.some((m) => m.includes('implement uses the declared worktree before'))).toBe(true);
  });

  it('flags git commands using the declared worktree before setup even when the step label is generic', () => {
    const spec = {
      description: [
        'Outcome: one pull request in cloud opened against origin/main.',
        'Worktree: /private/tmp/cloud-relay-slack-bridge-outbound-streaming',
        'Target branch: feat/relay-slack-bridge-outbound-streaming',
      ].join('\n'),
    };
    const workflowWithGenericPreSetupGitUse = [
      'import { workflow } from "@agent-relay/sdk/workflows";',
      'import { createGitHubStep } from "@agent-relay/github-primitive";',
      'async function main() {',
      '  await workflow("generic-worktree-use")',
      '    .step("inspect", { type: "deterministic", command: "git -C /private/tmp/cloud-relay-slack-bridge-outbound-streaming status --short" })',
      '    .step("setup-worktree", { type: "deterministic", command: "git worktree add /private/tmp/cloud-relay-slack-bridge-outbound-streaming feat/relay-slack-bridge-outbound-streaming" })',
      '    .step("open-pr", createGitHubStep({ action: "openPullRequest" }))',
      '    .run({ cwd: process.cwd() });',
      '}',
      'main().catch((e) => { console.error(e); process.exitCode = 1; });',
    ].join('\n');

    const mismatches = detectSpecIntentMismatch(spec, workflowWithGenericPreSetupGitUse);

    expect(mismatches.some((m) => m.includes('inspect uses the declared worktree before'))).toBe(true);
  });

  it('rejects unrelated worktree add commands before declared worktree usage', () => {
    const spec = {
      description: [
        'Outcome: one pull request in cloud opened against origin/main.',
        'Worktree: /private/tmp/cloud-relay-slack-bridge-outbound-streaming',
        'Target branch: feat/relay-slack-bridge-outbound-streaming',
      ].join('\n'),
    };
    const workflowWithWrongWorktreeSetup = [
      'import { workflow } from "@agent-relay/sdk/workflows";',
      'import { createGitHubStep } from "@agent-relay/github-primitive";',
      'async function main() {',
      '  await workflow("wrong-worktree")',
      '    .step("setup-worktree", { type: "deterministic", command: "git worktree add /private/tmp/other-worktree feat/other-branch" })',
      '    .step("implement", { type: "deterministic", command: "git -C /private/tmp/cloud-relay-slack-bridge-outbound-streaming status --short && echo feat/relay-slack-bridge-outbound-streaming" })',
      '    .step("open-pr", createGitHubStep({ action: "openPullRequest" }))',
      '    .run({ cwd: process.cwd() });',
      '}',
      'main().catch((e) => { console.error(e); process.exitCode = 1; });',
    ].join('\n');

    const mismatches = detectSpecIntentMismatch(spec, workflowWithWrongWorktreeSetup);

    expect(mismatches).toEqual(
      expect.arrayContaining([
        expect.stringContaining('no runtime git worktree add setup step'),
      ]),
    );
  });

  it('allows test -f gates for common extensionless files', () => {
    const spec = {
      description: [
        'Outcome: one pull request in cloud opened against origin/main.',
        'Worktree: /private/tmp/cloud-relay-slack-bridge-outbound-streaming',
        'Target branch: feat/relay-slack-bridge-outbound-streaming',
      ].join('\n'),
    };
    const workflowWithExtensionlessFiles = [
      'import { workflow } from "@agent-relay/sdk/workflows";',
      'import { createGitHubStep } from "@agent-relay/github-primitive";',
      'async function main() {',
      '  await workflow("extensionless-file-gates")',
      '    .step("setup-worktree", { type: "deterministic", command: "git worktree add /private/tmp/cloud-relay-slack-bridge-outbound-streaming feat/relay-slack-bridge-outbound-streaming" })',
      '    .step("file-gates", { type: "deterministic", command: "test -f packages/web/Dockerfile && test -f services/api/Makefile && test -f README" })',
      '    .step("open-pr", createGitHubStep({ action: "openPullRequest" }))',
      '    .run({ cwd: process.cwd() });',
      '}',
      'main().catch((e) => { console.error(e); process.exitCode = 1; });',
    ].join('\n');

    expect(detectSpecIntentMismatch(spec, workflowWithExtensionlessFiles)).toEqual([]);
  });

  it('accepts workflows that create the declared worktree before implementation', () => {
    const spec = {
      description: [
        'Outcome: one pull request in cloud opened against origin/main.',
        'Worktree: /private/tmp/cloud-relay-slack-bridge-outbound-streaming',
        'Target branch: feat/relay-slack-bridge-outbound-streaming',
      ].join('\n'),
    };
    const workflowWithWorktreeSetup = [
      'import { workflow } from "@agent-relay/sdk/workflows";',
      'import { createGitHubStep } from "@agent-relay/github-primitive";',
      'async function main() {',
      '  await workflow("with-worktree")',
      '    .step("setup-worktree", { type: "deterministic", command: "git worktree add /private/tmp/cloud-relay-slack-bridge-outbound-streaming feat/relay-slack-bridge-outbound-streaming" })',
      '    .step("implement", { type: "deterministic", command: "git -C /private/tmp/cloud-relay-slack-bridge-outbound-streaming status --short && test -d /private/tmp/cloud-relay-slack-bridge-outbound-streaming" })',
      '    .step("open-pr", createGitHubStep({ action: "openPullRequest" }))',
      '    .run({ cwd: process.cwd() });',
      '}',
      'main().catch((e) => { console.error(e); process.exitCode = 1; });',
    ].join('\n');

    expect(detectSpecIntentMismatch(spec, workflowWithWorktreeSetup)).toEqual([]);
  });

  it('flags test -f gates over declared worktree directories and glob paths', () => {
    const spec = {
      description: [
        'Outcome: one pull request in cloud opened against origin/main.',
        'Worktree: /private/tmp/cloud-relay-slack-bridge-outbound-streaming',
        'Target branch: feat/relay-slack-bridge-outbound-streaming',
      ].join('\n'),
    };
    const workflowWithBadFileGates = [
      'import { workflow } from "@agent-relay/sdk/workflows";',
      'import { createGitHubStep } from "@agent-relay/github-primitive";',
      'async function main() {',
      '  await workflow("bad-file-gates")',
      '    .step("setup-worktree", { type: "deterministic", command: "git worktree add /private/tmp/cloud-relay-slack-bridge-outbound-streaming feat/relay-slack-bridge-outbound-streaming" })',
      '    .step("bad-directory-gate", { type: "deterministic", command: "test -f /private/tmp/cloud-relay-slack-bridge-outbound-streaming" })',
      '    .step("bad-glob-gate", { type: "deterministic", command: "test -f packages/web/app/api/v1/slack/*" })',
      '    .step("bad-api-directory-gate", { type: "deterministic", command: "test -f packages/web/app/api/v1/slack" })',
      '    .step("open-pr", createGitHubStep({ action: "openPullRequest" }))',
      '    .run({ cwd: process.cwd() });',
      '}',
      'main().catch((e) => { console.error(e); process.exitCode = 1; });',
    ].join('\n');

    const mismatches = detectSpecIntentMismatch(spec, workflowWithBadFileGates);

    expect(mismatches.some((m) => m.includes('declared worktree directory'))).toBe(true);
    expect(mismatches.some((m) => m.includes('glob path'))).toBe(true);
    expect(mismatches.some((m) => m.includes('directory-looking path packages/web/app/api/v1/slack'))).toBe(true);
  });
});

describe('stripGlobalGithubExecutorForMixedWorkflow', () => {
  it('removes a GitHubStepExecutor global run executor from mixed workflows', () => {
    const mixedWorkflow = [
      'import { workflow } from "@agent-relay/sdk/workflows";',
      'import { GitHubStepExecutor, createGitHubStep } from "@agent-relay/github-primitive";',
      'const githubStepExecutor = new GitHubStepExecutor();',
      'async function main() {',
      '  await workflow("mixed")',
      '    .step("implement", { type: "agent", agent: "coder", prompt: "Edit files" })',
      '    .step("open-pr", createGitHubStep({ action: "openPullRequest", branch: "feat/foo" }))',
      '    .run({ cwd: process.cwd(), executor: githubStepExecutor });',
      '}',
      'main().catch((e) => { console.error(e); process.exitCode = 1; });',
    ].join('\n');

    const result = stripGlobalGithubExecutorForMixedWorkflow(mixedWorkflow);

    expect(result.stripped).toBe(true);
    expect(result.content).toContain('.run({ cwd: process.cwd() });');
    expect(result.content).not.toContain('executor: githubStepExecutor');
    expect(result.content).toContain('createGitHubStep({ action: "openPullRequest"');
  });

  it('keeps a GitHub-only workflow run executor intact', () => {
    const githubOnlyWorkflow = [
      'import { workflow } from "@agent-relay/sdk/workflows";',
      'import { GitHubStepExecutor, createGitHubStep } from "@agent-relay/github-primitive";',
      'const githubStepExecutor = new GitHubStepExecutor();',
      'async function main() {',
      '  await workflow("github-only")',
      '    .step("open-pr", createGitHubStep({ action: "openPullRequest", branch: "feat/foo" }))',
      '    .run({ cwd: process.cwd(), executor: githubStepExecutor });',
      '}',
      'main().catch((e) => { console.error(e); process.exitCode = 1; });',
    ].join('\n');

    expect(stripGlobalGithubExecutorForMixedWorkflow(githubOnlyWorkflow)).toEqual({
      content: githubOnlyWorkflow,
      stripped: false,
    });
  });

  it('keeps a GitHub-only workflow with identifier-backed GitHub steps intact', () => {
    const githubOnlyWorkflow = [
      'import { workflow } from "@agent-relay/sdk/workflows";',
      'import { GitHubStepExecutor, createGitHubStep } from "@agent-relay/github-primitive";',
      'const githubStepExecutor = new GitHubStepExecutor();',
      'const openPrStep = createGitHubStep({ action: "openPullRequest", branch: "feat/foo" });',
      'async function main() {',
      '  await workflow("github-only")',
      '    .step("open-pr", openPrStep)',
      '    .run({ cwd: process.cwd(), executor: githubStepExecutor });',
      '}',
      'main().catch((e) => { console.error(e); process.exitCode = 1; });',
    ].join('\n');

    expect(stripGlobalGithubExecutorForMixedWorkflow(githubOnlyWorkflow)).toEqual({
      content: githubOnlyWorkflow,
      stripped: false,
    });
  });

  it('removes an arbitrary-name GitHubStepExecutor run executor from mixed workflows', () => {
    const mixedWorkflow = [
      'import { workflow } from "@agent-relay/sdk/workflows";',
      'import { GitHubStepExecutor, createGitHubStep } from "@agent-relay/github-primitive";',
      'const executor = new GitHubStepExecutor();',
      'async function main() {',
      '  await workflow("mixed")',
      '    .step("implement", { type: "agent", agent: "coder", prompt: "Edit files" })',
      '    .step("open-pr", createGitHubStep({ action: "openPullRequest", branch: "feat/foo" }))',
      '    .run({ cwd: process.cwd(), executor });',
      '}',
      'main().catch((e) => { console.error(e); process.exitCode = 1; });',
    ].join('\n');

    const result = stripGlobalGithubExecutorForMixedWorkflow(mixedWorkflow);

    expect(result.stripped).toBe(true);
    expect(result.content).toContain('.run({ cwd: process.cwd() });');
    expect(result.content).not.toContain('executor });');
  });

  it('resolves same-named step variables by lexical scope instead of file-wide name', () => {
    const githubOnlyWorkflow = [
      'import { workflow } from "@agent-relay/sdk/workflows";',
      'import { GitHubStepExecutor, createGitHubStep } from "@agent-relay/github-primitive";',
      'const githubStepExecutor = new GitHubStepExecutor();',
      'async function main() {',
      '  const openPrStep = createGitHubStep({ action: "openPullRequest", branch: "feat/foo" });',
      '  await workflow("github-only")',
      '    .step("open-pr", openPrStep)',
      '    .run({ cwd: process.cwd(), executor: githubStepExecutor });',
      '}',
      'async function unrelated() {',
      '  const openPrStep = { type: "deterministic", command: "true" };',
      '  return openPrStep;',
      '}',
      'main().catch((e) => { console.error(e); process.exitCode = 1; });',
    ].join('\n');

    expect(stripGlobalGithubExecutorForMixedWorkflow(githubOnlyWorkflow)).toEqual({
      content: githubOnlyWorkflow,
      stripped: false,
    });
  });

  it('resolves same-named executor variables by lexical scope instead of file-wide name', () => {
    const mixedWorkflow = [
      'import { workflow } from "@agent-relay/sdk/workflows";',
      'import { GitHubStepExecutor, createGitHubStep } from "@agent-relay/github-primitive";',
      'async function main() {',
      '  const executor = new GitHubStepExecutor();',
      '  await workflow("mixed")',
      '    .step("implement", { type: "agent", agent: "coder", prompt: "Edit files" })',
      '    .step("open-pr", createGitHubStep({ action: "openPullRequest", branch: "feat/foo" }))',
      '    .run({ cwd: process.cwd(), executor });',
      '}',
      'async function unrelated() {',
      '  const executor = { run() { return undefined; } };',
      '  return executor;',
      '}',
      'main().catch((e) => { console.error(e); process.exitCode = 1; });',
    ].join('\n');

    const result = stripGlobalGithubExecutorForMixedWorkflow(mixedWorkflow);

    expect(result.stripped).toBe(true);
    expect(result.content).toContain('.run({ cwd: process.cwd() });');
    expect(result.content).not.toContain('executor });');
  });

  it('does not treat same-named imports from unrelated modules as GitHub primitives', () => {
    const lookalikeWorkflow = [
      'import { workflow } from "@agent-relay/sdk/workflows";',
      'import { GitHubStepExecutor, createGitHubStep } from "@example/not-github";',
      'const executor = new GitHubStepExecutor();',
      'async function main() {',
      '  await workflow("lookalike")',
      '    .step("implement", { type: "agent", agent: "coder", prompt: "Edit files" })',
      '    .step("not-github", createGitHubStep({ action: "openPullRequest", branch: "feat/foo" }))',
      '    .run({ cwd: process.cwd(), executor });',
      '}',
      'main().catch((e) => { console.error(e); process.exitCode = 1; });',
    ].join('\n');

    expect(stripGlobalGithubExecutorForMixedWorkflow(lookalikeWorkflow)).toEqual({
      content: lookalikeWorkflow,
      stripped: false,
    });
  });
  it('removes inline GitHubStepExecutor global run executors from mixed workflows', () => {
    const mixedWorkflow = [
      'import { workflow } from "@agent-relay/sdk/workflows";',
      'import { GitHubStepExecutor, createGitHubStep } from "@agent-relay/github-primitive";',
      'async function main() {',
      '  await workflow("mixed")',
      '    .step("implement", { type: "deterministic", command: "true" })',
      '    .step("open-pr", createGitHubStep({ action: "openPullRequest" }))',
      '    .run({',
      '      cwd: process.cwd(),',
      '      executor: new GitHubStepExecutor(),',
      '    });',
      '}',
      'main().catch((e) => { console.error(e); process.exitCode = 1; });',
    ].join('\n');

    const result = stripGlobalGithubExecutorForMixedWorkflow(mixedWorkflow);

    expect(result.stripped).toBe(true);
    expect(result.content).toContain('    .run({\n      cwd: process.cwd()\n    });');
    expect(result.content).not.toContain('executor: new GitHubStepExecutor()');
  });
});

function runnableContext(overrides: Partial<{
  personaId: string;
  tier: string;
  harness: string;
  model: string;
}> = {}) {
  return {
    selection: {
      personaId: overrides.personaId ?? 'agent-relay-workflow',
      tier: overrides.tier ?? 'best',
      runtime: {
        harness: overrides.harness ?? 'codex',
        model: overrides.model ?? 'codex/test',
      },
    },
    sendMessage() {
      return execution(JSON.stringify({
        artifact: {
          path: 'workflows/generated/persona.ts',
          content: workflowSource(),
        },
        metadata: { workflowName: 'persona' },
      }));
    },
  };
}

function execution(output: string): WorkforcePersonaExecution {
  const promise = Promise.resolve({
    status: 'completed' as const,
    output,
    stderr: '',
    exitCode: 0,
    durationMs: 42,
    workflowRunId: 'persona-run-001',
    stepName: 'agent-relay-workflow',
  }) as WorkforcePersonaExecution;
  Object.defineProperty(promise, 'runId', { value: Promise.resolve('persona-run-001') });
  promise.cancel = () => {};
  return promise;
}

function personaResponse(path: string, content: string): string {
  return JSON.stringify({
    artifact: {
      path,
      content,
    },
    metadata: { workflowName: path.split('/').pop()?.replace(/\.ts$/, '') },
  });
}

function replaceLast(value: string, search: string, replacement: string): string {
  const index = value.lastIndexOf(search);
  expect(index).toBeGreaterThanOrEqual(0);
  return `${value.slice(0, index)}${replacement}${value.slice(index + search.length)}`;
}

function workflowSource(): string {
  return [
    'import { workflow } from "@agent-relay/sdk/workflows";',
    '',
    'async function main() {',
    '  await workflow("persona")',
    '    .description("Persona generated workflow")',
    '    .pattern("pipeline")',
    '    .channel("wf-ricky-persona")',
    '    .step("verify", { type: "deterministic", command: "echo ok", verification: { type: "exit_code" } })',
    '    .run({ cwd: process.cwd() });',
    '}',
    '',
    'main().catch((error) => {',
    '  console.error(error);',
    '  process.exitCode = 1;',
    '});',
    '',
  ].join('\n');
}

function multilineRunSource(): string {
  return workflowSource().replace(
    '    .run({ cwd: process.cwd() });',
    [
      '    .run({',
      '      cwd: process.cwd(),',
      '      timeoutMs: 120000,',
      '    });',
    ].join('\n'),
  );
}

function spec(overrides: { description?: string; targetFiles?: string[] } = {}): NormalizedWorkflowSpec {
  const description = overrides.description ?? 'Generate a workflow for deterministic product work.';
  const rawPayload: RawSpecPayload = {
    kind: 'natural_language',
    surface: 'cli',
    receivedAt: RECEIVED_AT,
    requestId: 'workforce-writer-test',
    text: description,
  };
  const providerContext = {
    surface: 'cli' as const,
    requestId: rawPayload.requestId,
    metadata: {},
  };
  const targetFiles = overrides.targetFiles ?? ['src/product/generation/workforce-persona-writer.ts'];
  return {
    intent: 'generate',
    description,
    targetRepo: null,
    targetContext: null,
    targetFiles,
    desiredAction: {
      kind: 'generate',
      summary: description,
      specText: description,
      targetFiles,
    },
    constraints: [{ constraint: 'Must include deterministic validation.', category: 'quality' }],
    evidenceRequirements: [{ requirement: 'Record typecheck and tests.', verificationType: 'output_contains' }],
    requiredEvidence: [{ requirement: 'Record typecheck and tests.', verificationType: 'output_contains' }],
    acceptanceGates: [{ gate: 'npx tsc --noEmit', kind: 'deterministic' }],
    acceptanceCriteria: [{ gate: 'npx tsc --noEmit', kind: 'deterministic' }],
    providerContext,
    sourceSpec: {
      surface: 'cli',
      intent: { primary: 'generate', signals: ['test fixture'] },
      description,
      targetRepo: undefined,
      targetContext: undefined,
      targetFiles,
      constraints: ['Must include deterministic validation.'],
      evidenceRequirements: ['Record typecheck and tests.'],
      acceptanceGates: ['npx tsc --noEmit'],
      providerContext,
      rawPayload,
      parseConfidence: 'high',
      parseWarnings: [],
    },
    executionPreference: 'auto',
  };
}
