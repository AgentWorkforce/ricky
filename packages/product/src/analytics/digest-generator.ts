import type {
  DigestFinding,
  FindingCategory,
  FindingSeverity,
  HealthDigest,
  HealthFinding,
  HealthReport,
  Recommendation,
  RecommendationPriority,
} from './types.js';

export function generateDigest(report: HealthReport): HealthDigest {
  const findings = report.findings.map(toDigestFinding);
  const recommendations = deduplicateRecommendations(findings).sort(compareRecommendations);

  return {
    generatedAt: report.analyzedAt,
    topLineStatus: topLineStatus(report),
    topLineSummary: topLineSummary(report, findings),
    healthScore: report.overallHealthScore,
    findings,
    recommendations,
    report,
  };
}

function toDigestFinding(finding: HealthFinding): DigestFinding {
  return {
    id: finding.id,
    category: finding.category,
    severity: finding.severity,
    workflowName: finding.workflowName,
    summary: finding.summary,
    evidence: finding.evidence,
    recommendedAction: recommendedAction(finding),
  };
}

function deduplicateRecommendations(findings: DigestFinding[]): Recommendation[] {
  const groups = new Map<string, DigestFinding[]>();

  for (const finding of findings) {
    const key = `${finding.workflowName}::${finding.category}`;
    const group = groups.get(key) ?? [];
    group.push(finding);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    if (group.length === 1) {
      return toRecommendation(group[0]);
    }
    return mergeRecommendations(group);
  });
}

function mergeRecommendations(group: DigestFinding[]): Recommendation {
  const primary = group[0];
  const highestSeverity = group.reduce<FindingSeverity>(
    (best, finding) => (severityWeight(finding.severity) > severityWeight(best) ? finding.severity : best),
    primary.severity,
  );

  return {
    id: `recommendation.${primary.id}`,
    priority: priorityForSeverity(highestSeverity),
    title: recommendationTitle(primary),
    description: group.map((finding) => finding.summary).join(' '),
    relatedFindings: group.map((finding) => finding.id),
    workflowNames: [...new Set(group.map((finding) => finding.workflowName))],
    suggestedAction: primary.recommendedAction,
  };
}

function toRecommendation(finding: DigestFinding): Recommendation {
  return {
    id: `recommendation.${finding.id}`,
    priority: priorityForSeverity(finding.severity),
    title: recommendationTitle(finding),
    description: finding.summary,
    relatedFindings: [finding.id],
    workflowNames: [finding.workflowName],
    suggestedAction: finding.recommendedAction,
  };
}

function recommendedAction(finding: HealthFinding): string {
  const leadingSignal = finding.evidence[0]?.message;
  const signalSuffix = leadingSignal ? ` Signal: ${leadingSignal}` : '';

  switch (finding.category) {
    case 'failure_distribution':
      return `Inspect the dominant classifier signals for ${finding.workflowName}, then fix the repeated failure class before rerunning the workflow.${signalSuffix}`;
    case 'retry_rate':
      return `Reduce retry pressure in ${finding.workflowName}: split the repeatedly retried step or add an earlier validation gate before expensive agent work.${signalSuffix}`;
    case 'timeout_rate':
      return `Split long-running steps in ${finding.workflowName} or raise the timeout only after the slow step has a bounded verification gate.${signalSuffix}`;
    case 'weak_verification':
      return `Add deterministic gates to ${finding.workflowName}; use exit_code or file_exists checks after agent-edited artifacts are expected to exist.${signalSuffix}`;
    case 'missing_hard_gate':
      return `Add a final hard gate to ${finding.workflowName} that fails on missing files or non-zero validation commands.${signalSuffix}`;
    case 'oversized_step':
      return `Split the oversized step in ${finding.workflowName} into bounded substeps with separate verification gates.${signalSuffix}`;
    case 'pattern_choice':
      return `Review the selected swarm pattern for ${finding.workflowName} and switch to the pattern that matches the observed dependency shape.${signalSuffix}`;
    case 'flaky_workflow':
      return `Stabilize ${finding.workflowName} by isolating non-deterministic steps and adding gates around environment-dependent work.${signalSuffix}`;
    case 'duration_outlier':
      return `Compare the outlier run in ${finding.workflowName} with normal runs and check for resource contention, retry loops, or step scope drift.${signalSuffix}`;
  }
}

function recommendationTitle(finding: DigestFinding): string {
  const labels: Record<FindingCategory, string> = {
    failure_distribution: 'Fix recurring failure class',
    retry_rate: 'Reduce excessive retries',
    timeout_rate: 'Reduce recurring timeouts',
    weak_verification: 'Add deterministic verification',
    missing_hard_gate: 'Add final hard gate',
    oversized_step: 'Split oversized step',
    pattern_choice: 'Correct workflow pattern',
    flaky_workflow: 'Stabilize flaky workflow',
    duration_outlier: 'Investigate duration outlier',
  };

  return `${labels[finding.category]}: ${finding.workflowName}`;
}

function topLineStatus(report: HealthReport): HealthDigest['topLineStatus'] {
  if (report.findings.some((finding) => finding.severity === 'critical') || report.overallHealthScore < 40) {
    return 'unhealthy';
  }

  if (report.findings.some((finding) => finding.severity === 'high') || report.overallHealthScore < 70) {
    return 'degraded';
  }

  return 'healthy';
}

function topLineSummary(report: HealthReport, findings: DigestFinding[]): string {
  if (findings.length === 0) {
    return `Health score ${report.overallHealthScore}: no workflow health findings across ${report.totalRuns} analyzed runs.`;
  }

  const top = findings[0];
  return `Health score ${report.overallHealthScore}: top issue is ${top.category} in ${top.workflowName}. ${top.recommendedAction}`;
}

function priorityForSeverity(severity: FindingSeverity): RecommendationPriority {
  if (severity === 'critical' || severity === 'high') {
    return 'immediate';
  }

  if (severity === 'medium') {
    return 'soon';
  }

  return 'backlog';
}

function compareRecommendations(a: Recommendation, b: Recommendation): number {
  return (
    priorityRank(a.priority) - priorityRank(b.priority) ||
    a.workflowNames[0].localeCompare(b.workflowNames[0]) ||
    a.id.localeCompare(b.id)
  );
}

function priorityRank(priority: RecommendationPriority): number {
  const rank: Record<RecommendationPriority, number> = {
    immediate: 0,
    soon: 1,
    backlog: 2,
  };

  return rank[priority];
}

function severityWeight(severity: FindingSeverity): number {
  const weights: Record<FindingSeverity, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
    info: 0,
  };
  return weights[severity];
}
