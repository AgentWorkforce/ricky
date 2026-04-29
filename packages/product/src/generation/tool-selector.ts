import type { NormalizedWorkflowSpec } from '../spec-intake/types.js';
import type { SkillContext, ToolRunner, ToolSelection, ToolSelectionContext, WorkflowTask } from './types.js';

export interface ToolSelectorOptions {
  projectDefaultRunner?: ToolRunner;
  projectDefaultModel?: string;
}

const DEFAULT_RUNNER: ToolRunner = '@agent-relay/sdk';
const RUNNER_HINTS: Array<{ runner: ToolRunner; patterns: RegExp[] }> = [
  { runner: 'claude', patterns: [/\buse\s+claude\b/i, /\bwith\s+claude\b/i, /\bvia\s+claude\b/i] },
  { runner: 'codex', patterns: [/\buse\s+codex\b/i, /\bwith\s+codex\b/i, /\bvia\s+codex\b/i] },
  { runner: 'cursor', patterns: [/\buse\s+cursor\b/i, /\bwith\s+cursor\b/i, /\bvia\s+cursor\b/i] },
  { runner: 'opencode', patterns: [/\buse\s+opencode\b/i, /\bwith\s+opencode\b/i, /\bvia\s+opencode\b/i] },
];

export function selectToolsForSteps(
  spec: NormalizedWorkflowSpec,
  tasks: WorkflowTask[],
  skills: SkillContext,
  options: ToolSelectorOptions = {},
): ToolSelectionContext {
  const defaultRunner = options.projectDefaultRunner ?? DEFAULT_RUNNER;
  const hintText = searchableHintText(spec.description);
  const globalRunner = /\bonly\b/i.test(hintText) ? undefined : explicitRunnerHint(hintText);
  const skillModel = skills.skills.find((skill) => skill.loaded && skill.preferredModel)?.preferredModel;
  const model = explicitModelHint(hintText) ?? skillModel ?? options.projectDefaultModel;
  const skillRunner = skills.skills.find((skill) => skill.loaded && skill.preferredRunner)?.preferredRunner;

  const selections = tasks
    .filter((task) => task.agentRole !== 'deterministic')
    .map((task): ToolSelection => {
      const stepRunner = stepScopedRunnerHint(hintText, task);
      const runner = stepRunner ?? globalRunner ?? skillRunner ?? defaultRunner;
      return {
        stepId: task.id,
        agent: task.agentRole,
        runner,
        ...(model ? { model } : {}),
        concurrency: concurrencyFor(spec, task),
        rule: stepRunner
          ? `step hint matched ${runner}`
          : globalRunner
            ? `spec hint matched ${runner}`
            : skillRunner
              ? `skill preferredRunner matched ${runner}`
              : `project default runner ${defaultRunner}`,
      };
    });

  return {
    selections,
    defaultRunner,
    issues: [],
  };
}

function searchableHintText(text: string): string {
  return text
    .replace(/`[^`]*`/g, ' ')
    .replace(/\([^)]*\be\.g\.[^)]*\)/gi, ' ')
    .replace(/"[^"]*"/g, ' ')
    .replace(/'[^']*'/g, ' ');
}

function explicitRunnerHint(text: string): ToolRunner | undefined {
  for (const candidate of RUNNER_HINTS) {
    if (candidate.patterns.some((pattern) => pattern.test(text))) return candidate.runner;
  }
  return undefined;
}

function stepScopedRunnerHint(text: string, task: WorkflowTask): ToolRunner | undefined {
  const stop = new Set(['with', 'only', 'step', 'task']);
  const stepTerms = [task.id, task.name, task.agentRole]
    .flatMap((term) => term.toLowerCase().split(/[^a-z0-9]+/))
    .filter((term) => term.length >= 4 && !stop.has(term));
  const sentences = text.split(/(?<=[.!?\n])\s+/);
  for (const sentence of sentences) {
    if (!stepTerms.some((term) => sentence.toLowerCase().includes(term))) continue;
    const runner = explicitRunnerHint(sentence);
    if (runner) return runner;
  }
  return undefined;
}

function explicitModelHint(text: string): string | undefined {
  const match = text.match(/\b(?:with|via|model)\s+([A-Za-z0-9._-]*(?:sonnet|opus|haiku|gpt|o[0-9]|gemini)[A-Za-z0-9._-]*(?:\s+[0-9]+(?:\.[0-9]+)?)?)\b/i);
  return match?.[1]?.replace(/\s+/g, '-');
}

function concurrencyFor(spec: NormalizedWorkflowSpec, task: WorkflowTask): number {
  if (/\bparallel|concurrent|fan[- ]?out\b/i.test(spec.description) && /implement|test|review/i.test(task.id)) return 2;
  return 1;
}
