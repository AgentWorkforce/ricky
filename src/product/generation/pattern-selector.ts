import type { NormalizedWorkflowSpec } from '../spec-intake/types.js';
import type { SwarmPattern } from '../../shared/models/workflow-config.js';
import type { GenerationRiskLevel, PatternDecision } from './types.js';

export function selectPattern(spec: NormalizedWorkflowSpec, patternOverride?: SwarmPattern): PatternDecision {
  const signals = collectSignals(spec);
  const riskLevel = assessRisk(spec, signals);

  if (patternOverride) {
    return {
      pattern: patternOverride,
      reason: `Pattern override requested: ${patternOverride}. Base risk assessment was ${riskLevel}.`,
      specSignals: signals,
      riskLevel,
      overrideUsed: true,
    };
  }

  const pattern = choosePattern(spec, riskLevel, signals);
  return {
    pattern,
    reason: explainPattern(pattern, riskLevel, signals),
    specSignals: signals,
    riskLevel,
    overrideUsed: false,
  };
}

function collectSignals(spec: NormalizedWorkflowSpec): string[] {
  const signals: string[] = [];
  const targetCount = spec.targetFiles.length;
  const combinedText = normalizeText([
    spec.description,
    spec.targetContext,
    ...spec.targetFiles,
    ...spec.constraints.map((constraint) => constraint.constraint),
    ...spec.evidenceRequirements.map((requirement) => requirement.requirement),
    ...spec.acceptanceGates.map((gate) => gate.gate),
  ]);

  if (targetCount === 0) signals.push('no explicit target files');
  if (targetCount === 1) signals.push('single target file');
  if (targetCount >= 2 && targetCount <= 5) signals.push('multiple target files');
  if (targetCount > 5) signals.push('many target files');
  if (spec.acceptanceGates.length > 0) signals.push('acceptance gates present');
  if (spec.evidenceRequirements.length > 0) signals.push('evidence requirements present');
  if (/\b(proof|deterministic|evidence|audit)\b/.test(combinedText)) signals.push('proof or deterministic evidence requested');
  if (/\b(critical|production|security|auth|billing|data loss)\b/.test(combinedText)) signals.push('critical or production constraint');
  if (/\b(review|approval|signoff)\b/.test(combinedText)) signals.push('review constraint');
  if (/\b(parallel|fan.?out|independent|many files|across files)\b/.test(combinedText)) signals.push('parallel work suggested');
  if (isDocOnly(spec)) signals.push('doc or spec oriented');
  if (spec.executionPreference === 'cloud') signals.push('cloud execution requested');
  if (spec.providerContext.surface === 'mcp') signals.push('mcp handoff surface');

  return signals.length > 0 ? signals : ['simple generation request'];
}

function assessRisk(spec: NormalizedWorkflowSpec, signals: string[]): GenerationRiskLevel {
  const hasHighRiskSignal = signals.some((signal) =>
    /many target files|proof or deterministic evidence|critical or production/.test(signal),
  );
  if (hasHighRiskSignal) return 'high';

  if (
    spec.targetFiles.length >= 2 ||
    spec.acceptanceGates.length > 0 ||
    signals.some((signal) => /review constraint|cloud execution/.test(signal))
  ) {
    return 'medium';
  }

  return 'low';
}

function choosePattern(spec: NormalizedWorkflowSpec, riskLevel: GenerationRiskLevel, signals: string[]): SwarmPattern {
  if (riskLevel === 'high') return 'dag';
  if (signals.some((signal) => signal === 'parallel work suggested')) return 'dag';
  if (riskLevel === 'medium') return 'supervisor';
  if (isDocOnly(spec) && spec.acceptanceGates.length > 0) return 'supervisor';
  return 'pipeline';
}

function explainPattern(pattern: SwarmPattern, riskLevel: GenerationRiskLevel, signals: string[]): string {
  if (pattern === 'dag') {
    return `Selected dag because the request is ${riskLevel} risk and benefits from parallel implementation, review, and validation gates.`;
  }
  if (pattern === 'supervisor') {
    return `Selected supervisor because the request is ${riskLevel} risk and needs coordinated planning, implementation, and review.`;
  }
  return `Selected pipeline because the request is ${riskLevel} risk and can proceed through a linear reliability ladder.`;
}

function isDocOnly(spec: NormalizedWorkflowSpec): boolean {
  const text = normalizeText([spec.description, ...spec.targetFiles]);
  if (spec.targetFiles.length === 0) return /\b(doc|docs|readme|spec|plan|proposal)\b/.test(text);
  return spec.targetFiles.every((file) => /\.(md|mdx|txt|adoc)$/i.test(file));
}

function normalizeText(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join('\n').toLowerCase();
}
