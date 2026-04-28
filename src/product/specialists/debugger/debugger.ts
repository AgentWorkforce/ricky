import { classifyFailure } from '../../../runtime/failure/classifier.js';
import { diagnose } from './diagnosis.js';
import { recommendFix } from './fix-recommender.js';
import type { DebuggerInput, DebuggerResult, RepairMode } from './types.js';

export function debugWorkflowRun(input: DebuggerInput): DebuggerResult {
  const classification = input.classification ?? classifyFailure(input.evidence);
  const diagnosis = diagnose(classification, input.evidence);
  const recommendation = recommendFix(diagnosis, input.evidence, input.repairPolicy, input.environmentPreflight);
  const repairMode = deriveRepairMode(recommendation.directRepairEligible, recommendation.steps[0]?.action);

  return {
    diagnosis,
    recommendation,
    repairMode,
    summary: `${diagnosis.primaryCause.summary} ${recommendation.summary}`,
    analyzedAt: input.analyzedAt ?? new Date().toISOString(),
  };
}

function deriveRepairMode(directRepairEligible: boolean, firstAction: string | undefined): RepairMode {
  if (directRepairEligible) return 'direct';
  if (firstAction === 'escalate' || firstAction === 'abort' || firstAction === 'restructure_workflow' || firstAction === 'change_pattern') {
    return 'manual';
  }
  return 'guided';
}
