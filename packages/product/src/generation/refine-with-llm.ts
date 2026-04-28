import type { NormalizedWorkflowSpec } from '../spec-intake/types.js';
import type { GenerationValidationResult, RefinementMetadata, RenderedArtifact } from './types.js';

export interface RefinementEdit {
  region: 'task_descriptions' | 'acceptance_gates';
  find: string;
  replace: string;
}

export interface RefinementClientResult {
  text: string;
  elapsedMs?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface RefinementClient {
  refine(input: { model: string; spec: string; artifact: string }): RefinementClientResult;
}

export interface RefineWithLlmOptions {
  model?: string;
  timeoutMs?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  client?: RefinementClient;
  validate?: (artifact: RenderedArtifact) => GenerationValidationResult;
}

const DEFAULT_MODEL = 'sonnet';
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_INPUT_TOKENS = 50_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 8_000;
const ALLOWED_REGIONS = new Set<RefinementEdit['region']>(['task_descriptions', 'acceptance_gates']);

export function refineWithLlm(
  spec: NormalizedWorkflowSpec,
  artifact: RenderedArtifact,
  options: RefineWithLlmOptions = {},
): { artifact: RenderedArtifact; metadata: RefinementMetadata } {
  const model = options.model ?? DEFAULT_MODEL;
  const inputTokens = estimateTokens(`${spec.description}\n${artifact.content}`);
  const maxInputTokens = options.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS;
  const maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;

  if (inputTokens > maxInputTokens) {
    return unchanged(artifact, {
      model,
      inputTokens,
      outputTokens: 0,
      warning: `Refinement skipped because input token estimate ${inputTokens} exceeded max ${maxInputTokens}.`,
    });
  }

  if ((options.timeoutMs ?? DEFAULT_TIMEOUT_MS) <= 0) {
    return unchanged(artifact, {
      model,
      inputTokens,
      outputTokens: 0,
      warning: 'Refinement timed out after 0 ms.',
    });
  }

  try {
    const clientResult = options.client
      ? options.client.refine({ model, spec: spec.description, artifact: artifact.content })
      : heuristicRefinement(spec, artifact);
    const elapsedMs = clientResult.elapsedMs ?? 0;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (elapsedMs > timeoutMs) {
      return unchanged(artifact, {
        model,
        inputTokens: clientResult.inputTokens ?? inputTokens,
        outputTokens: clientResult.outputTokens ?? estimateTokens(clientResult.text),
        warning: `Refinement timed out after ${elapsedMs} ms (max ${timeoutMs}).`,
      });
    }

    const outputTokens = clientResult.outputTokens ?? estimateTokens(clientResult.text);
    if (outputTokens > maxOutputTokens) {
      return unchanged(artifact, {
        model,
        inputTokens: clientResult.inputTokens ?? inputTokens,
        outputTokens,
        warning: `Refinement skipped because output token estimate ${outputTokens} exceeded max ${maxOutputTokens}.`,
      });
    }

    const edits = parseEdits(clientResult.text);
    if (edits.some((edit) => !ALLOWED_REGIONS.has(edit.region))) {
      return unchanged(artifact, {
        model,
        inputTokens: clientResult.inputTokens ?? inputTokens,
        outputTokens,
        warning: 'Refinement rejected because it edited outside the allowlisted regions.',
      });
    }

    const refined = applyEdits(artifact, edits);
    const validation = options.validate?.(refined);
    if (validation && !validation.valid) {
      return unchanged(artifact, {
        model,
        inputTokens: clientResult.inputTokens ?? inputTokens,
        outputTokens,
        warning: `Refinement rejected because validator failed: ${validation.errors[0] ?? 'unknown error'}.`,
      });
    }

    return {
      artifact: refined,
      metadata: {
        model,
        input_tokens: clientResult.inputTokens ?? inputTokens,
        output_tokens: outputTokens,
        edited_regions: [...new Set(edits.map((edit) => edit.region))],
        diff_size: edits.reduce((total, edit) => total + Math.abs(edit.replace.length - edit.find.length), 0),
        validator_passed: validation?.valid ?? true,
        applied: edits.length > 0,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return unchanged(artifact, {
      model,
      inputTokens,
      outputTokens: 0,
      warning: `Refinement skipped because the model call failed: ${message}`,
    });
  }
}

function heuristicRefinement(spec: NormalizedWorkflowSpec, artifact: RenderedArtifact): RefinementClientResult {
  const versionGate = versionAcceptanceCommand(spec);
  if (!versionGate) return { text: JSON.stringify({ edits: [] }) };

  const edits: RefinementEdit[] = artifact.gates
    .filter((gate) => gate.name === 'post-implementation-file-gate' || gate.name === 'post-fix-verification-gate')
    .map((gate) => ({
      region: 'acceptance_gates',
      find: gate.command,
      replace: versionGate,
    }));

  return {
    text: JSON.stringify({ edits }),
    inputTokens: estimateTokens(`${spec.description}\n${artifact.content}`),
    outputTokens: estimateTokens(JSON.stringify({ edits })),
  };
}

function versionAcceptanceCommand(spec: NormalizedWorkflowSpec): string | null {
  const text = [spec.description, ...spec.acceptanceGates.map((gate) => gate.gate)].join('\n');
  if (!/dist\/bin\/ricky\.js/i.test(text) || !/--version|\bversion\b/i.test(text)) return null;
  return "test -f 'dist/bin/ricky.js' && node dist/bin/ricky.js --version | grep -Eq '^ricky [0-9]+\\.[0-9]+\\.[0-9]+$'";
}

function parseEdits(text: string): RefinementEdit[] {
  const parsed = JSON.parse(text) as { edits?: RefinementEdit[] };
  return Array.isArray(parsed.edits) ? parsed.edits : [];
}

function applyEdits(artifact: RenderedArtifact, edits: RefinementEdit[]): RenderedArtifact {
  let content = artifact.content;
  const gates = artifact.gates.map((gate) => ({ ...gate }));

  for (const edit of edits) {
    content = content.split(edit.find).join(edit.replace);
    content = content.split(JSON.stringify(edit.find)).join(JSON.stringify(edit.replace));
    if (edit.region === 'acceptance_gates') {
      for (const gate of gates) {
        if (gate.command === edit.find) gate.command = edit.replace;
      }
    }
  }

  return {
    ...artifact,
    content,
    gates,
  };
}

function unchanged(
  artifact: RenderedArtifact,
  values: { model: string; inputTokens: number; outputTokens: number; warning: string },
): { artifact: RenderedArtifact; metadata: RefinementMetadata } {
  return {
    artifact,
    metadata: {
      model: values.model,
      input_tokens: values.inputTokens,
      output_tokens: values.outputTokens,
      edited_regions: [],
      diff_size: 0,
      validator_passed: false,
      applied: false,
      warning: values.warning,
    },
  };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
