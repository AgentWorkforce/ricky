import type { NormalizedWorkflowSpec } from '../spec-intake/types.js';
import type { SwarmPattern } from '../../shared/models/workflow-config.js';
import type { GenerationRiskLevel, PatternDecision, SkillContext } from './types.js';

export function selectPattern(
  spec: NormalizedWorkflowSpec,
  patternOverride?: SwarmPattern,
  skillContext?: SkillContext,
): PatternDecision {
  const usesSwarmPatternSkill = skillContext?.applicableSkillNames.includes('choosing-swarm-patterns') ?? false;
  const signals = collectSignals(spec, usesSwarmPatternSkill);
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

  const pattern = usesSwarmPatternSkill
    ? choosePatternWithSwarmSkill(spec, riskLevel, signals)
    : choosePattern(spec, riskLevel, signals);
  return {
    pattern,
    reason: explainPattern(pattern, riskLevel, signals, usesSwarmPatternSkill),
    specSignals: signals,
    riskLevel,
    overrideUsed: false,
  };
}

function collectSignals(spec: NormalizedWorkflowSpec, usesSwarmPatternSkill = false): string[] {
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
  if (/\b(clean ?up|remove|delete|unused|outdated|obsolete|stale)\b/.test(combinedText)) signals.push('deletion or cleanup risk');
  if (isDocOnly(spec)) signals.push('doc or spec oriented');
  if (spec.executionPreference === 'cloud') signals.push('cloud execution requested');
  if (spec.providerContext.surface === 'mcp') signals.push('mcp handoff surface');
  if (usesSwarmPatternSkill) signals.push('choosing-swarm-patterns skill loaded');

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

function choosePatternWithSwarmSkill(
  spec: NormalizedWorkflowSpec,
  riskLevel: GenerationRiskLevel,
  signals: string[],
): SwarmPattern {
  const text = normalizeText([
    spec.description,
    spec.targetContext,
    ...spec.constraints.map((constraint) => constraint.constraint),
    ...spec.evidenceRequirements.map((requirement) => requirement.requirement),
    ...spec.acceptanceGates.map((gate) => gate.gate),
  ]);

  if (/\b(strictly linear|linear|sequential|pipeline|one step after another)\b/.test(text)) return 'pipeline';
  if (signals.some((signal) => signal === 'parallel work suggested' || signal === 'many target files')) return 'dag';
  if (/\b(coordinator|supervisor|lead|review|approval|approve|signoff|gate|handoff|triage|specialist)\b/.test(text)) return 'supervisor';
  if (riskLevel === 'high') return 'dag';
  if (riskLevel === 'medium') return 'supervisor';
  if (isDocOnly(spec) && spec.acceptanceGates.length > 0) return 'supervisor';
  return 'pipeline';
}

function explainPattern(
  pattern: SwarmPattern,
  riskLevel: GenerationRiskLevel,
  signals: string[],
  usesSwarmPatternSkill = false,
): string {
  const skillPrefix = usesSwarmPatternSkill ? ' using choosing-swarm-patterns' : '';
  if (pattern === 'dag') {
    return `Selected dag${skillPrefix} because the request is ${riskLevel} risk and benefits from parallel implementation, review, and validation gates.`;
  }
  if (pattern === 'supervisor') {
    return `Selected supervisor${skillPrefix} because the request is ${riskLevel} risk and needs coordinated planning, implementation, and review.`;
  }
  if (signals.includes('deletion or cleanup risk')) {
    return `Selected pipeline${skillPrefix} because cleanup deletion has false-positive risk and should proceed through a linear evidence ladder.`;
  }
  return `Selected pipeline${skillPrefix} because the request is ${riskLevel} risk and can proceed through a linear reliability ladder.`;
}

function isDocOnly(spec: NormalizedWorkflowSpec): boolean {
  const text = normalizeText([spec.description, ...spec.targetFiles]);
  if (spec.targetFiles.length === 0) return /\b(doc|docs|readme|spec|plan|proposal)\b/.test(text);
  return spec.targetFiles.every((file) => /\.(md|mdx|txt|adoc)$/i.test(file));
}

function normalizeText(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join('\n').toLowerCase();
}
