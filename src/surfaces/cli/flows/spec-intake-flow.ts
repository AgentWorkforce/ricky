import { basename, extname, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

import type { RawHandoff } from '../../../local/request-normalizer.js';
import type { LocalPreflightResult } from './local-workflow-flow.js';

export type SpecIntakeSource = 'spec-file' | 'editor' | 'goal' | 'workflow-artifact';

export interface CapturedWorkflowSpec {
  source: SpecIntakeSource;
  workflowName: string;
  spec: string;
  specPath?: string;
  artifactPath?: string;
  generatedFromGoal?: {
    goal: string;
    clarifications: string[];
    approved: boolean;
  };
}

export interface SpecIntakePrompts {
  selectSpecSource(input: { suggestions: string[] }): Promise<SpecIntakeSource>;
  inputSpecFilePath(input: { suggestions: string[]; defaultPath?: string }): Promise<string>;
  editSpec(input: { initialValue?: string; message: string }): Promise<string>;
  inputWorkflowName(input: { defaultName: string }): Promise<string>;
  inputGoal(): Promise<string>;
  inputGoalClarification?(input: { goal: string; question: string }): Promise<string>;
  approveGeneratedSpec(input: { spec: string; goal: string }): Promise<'approve' | 'edit'>;
  inputWorkflowArtifactPath(input: { suggestions: string[] }): Promise<string>;
}

export interface SpecIntakeFlowDeps {
  prompts: SpecIntakePrompts;
  cwd: string;
  preflight?: LocalPreflightResult;
  readFileText?: (path: string) => Promise<string>;
}

export async function runSpecIntakeFlow(deps: SpecIntakeFlowDeps): Promise<CapturedWorkflowSpec> {
  const suggestions = deps.preflight?.specLocations.map((location) => location.path) ?? [];
  const source = await deps.prompts.selectSpecSource({ suggestions });

  if (source === 'spec-file') {
    return captureSpecFile(deps, suggestions);
  }

  if (source === 'editor') {
    return captureEditorSpec(deps);
  }

  if (source === 'goal') {
    return captureGoalSpec(deps);
  }

  return captureWorkflowArtifact(deps);
}

export function specCaptureToHandoff(
  capture: CapturedWorkflowSpec,
  invocationRoot: string,
  options: { stageMode?: 'generate' | 'run' | 'generate-and-run'; outputPath?: string } = {},
): RawHandoff {
  if (capture.source === 'workflow-artifact') {
    return {
      source: 'workflow-artifact',
      artifactPath: capture.artifactPath ?? capture.specPath ?? capture.spec,
      invocationRoot,
      mode: 'local',
      stageMode: options.stageMode ?? 'run',
      metadata: {
        workflowName: capture.workflowName,
        guidedSource: capture.source,
      },
    };
  }

  return {
    source: 'cli',
    spec: {
      intent: 'generate',
      description: capture.spec,
      workflowName: capture.workflowName,
      name: capture.workflowName,
      ...(options.outputPath ? { artifactPath: options.outputPath } : {}),
    },
    specFile: capture.specPath,
    invocationRoot,
    mode: 'local',
    stageMode: options.stageMode ?? 'generate',
    cliMetadata: {
      handoff: capture.source,
      workflowName: capture.workflowName,
      ...(capture.generatedFromGoal ? { generatedFromGoal: capture.generatedFromGoal } : {}),
    },
  };
}

export function defaultWorkflowNameFromPath(path: string): string {
  const name = basename(path, extname(path));
  return sanitizeWorkflowName(name || 'local-workflow');
}

export function sanitizeWorkflowName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'local-workflow';
}

export function buildSpecFromGoal(goal: string, clarifications: string[] = []): string {
  const cleanGoal = goal.trim();
  const usefulClarifications = clarifications.map((item) => item.trim()).filter(Boolean);
  return [
    `Goal: ${cleanGoal}`,
    '',
    'Desired outcome:',
    `- ${cleanGoal}`,
    '',
    'Execution mode:',
    '- Run locally through Agent Relay.',
    '',
    'Evidence:',
    '- Persist logs, generated artifacts, validation evidence, and a final outcome summary.',
    '',
    'Safety:',
    '- Apply only bounded, non-destructive fixes automatically.',
    '- Pause before credentials, destructive actions, dependency upgrades, commits, or pushes.',
    ...(usefulClarifications.length > 0
      ? ['', 'Additional context:', ...usefulClarifications.map((item) => `- ${item}`)]
      : []),
  ].join('\n');
}

function needsClarification(goal: string): boolean {
  const words = goal.trim().split(/\s+/).filter(Boolean);
  if (words.length < 5) return true;
  return !/\b(verify|test|build|generate|fix|implement|release|deploy|audit|check|prove)\b/i.test(goal);
}

async function captureSpecFile(deps: SpecIntakeFlowDeps, suggestions: string[]): Promise<CapturedWorkflowSpec> {
  const defaultPath = suggestions[0];
  const specPath = await deps.prompts.inputSpecFilePath({ suggestions, defaultPath });
  const resolvedPath = resolve(deps.cwd, specPath);
  const readText = deps.readFileText ?? ((path: string) => readFile(path, 'utf8'));
  const spec = await readText(resolvedPath);
  const workflowName = await deps.prompts.inputWorkflowName({
    defaultName: defaultWorkflowNameFromPath(specPath),
  });

  return {
    source: 'spec-file',
    workflowName: sanitizeWorkflowName(workflowName),
    spec,
    specPath: resolvedPath,
  };
}

async function captureEditorSpec(deps: SpecIntakeFlowDeps): Promise<CapturedWorkflowSpec> {
  const spec = await deps.prompts.editSpec({
    message: 'Write or paste the workflow spec.',
  });
  const workflowName = await deps.prompts.inputWorkflowName({ defaultName: 'local-workflow' });
  return {
    source: 'editor',
    workflowName: sanitizeWorkflowName(workflowName),
    spec,
  };
}

async function captureGoalSpec(deps: SpecIntakeFlowDeps): Promise<CapturedWorkflowSpec> {
  const goal = await deps.prompts.inputGoal();
  const clarifications: string[] = [];
  if (needsClarification(goal) && deps.prompts.inputGoalClarification) {
    clarifications.push(await deps.prompts.inputGoalClarification({
      goal,
      question: 'What should prove the workflow succeeded?',
    }));
  }

  const draftSpec = buildSpecFromGoal(goal, clarifications);
  const approval = await deps.prompts.approveGeneratedSpec({ spec: draftSpec, goal });
  const spec = approval === 'edit'
    ? await deps.prompts.editSpec({ initialValue: draftSpec, message: 'Edit the generated spec before Ricky writes the workflow.' })
    : draftSpec;
  const workflowName = await deps.prompts.inputWorkflowName({
    defaultName: sanitizeWorkflowName(goal).slice(0, 60) || 'goal-workflow',
  });

  return {
    source: 'goal',
    workflowName: sanitizeWorkflowName(workflowName),
    spec,
    generatedFromGoal: {
      goal,
      clarifications,
      approved: approval === 'approve',
    },
  };
}

async function captureWorkflowArtifact(deps: SpecIntakeFlowDeps): Promise<CapturedWorkflowSpec> {
  const suggestions = deps.preflight?.workflowArtifacts ?? [];
  const artifactPath = await deps.prompts.inputWorkflowArtifactPath({ suggestions });
  return {
    source: 'workflow-artifact',
    workflowName: defaultWorkflowNameFromPath(artifactPath),
    spec: artifactPath,
    artifactPath,
    specPath: artifactPath,
  };
}
