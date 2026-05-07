import { selectPattern } from '../../product/generation/pattern-selector.js';
import type { NormalizedWorkflowSpec } from '../../product/spec-intake/types.js';
import type { SwarmPattern } from '../../shared/models/workflow-config.js';

export interface BuildLinearWorkflowInput {
  issue: {
    id: string;
    title: string;
    description: string;
    labels: string[];
    comments: string[];
    project?: string;
  };
  repoTarget: { owner: string; repo: string; defaultBranch: string } | null | undefined;
  connectedAgents: ReadonlyArray<{ id: string; name: string; capabilities: string[] }>;
  actor: { linearUserId: string; cloudUserId: string };
}

export interface BuildLinearWorkflowResult {
  artifactPath: string;
  artifactContent: string;
  pattern: 'pipeline' | 'supervisor' | 'dag';
  selectedAgents: ReadonlyArray<string>;
  rationale: string;
}

export function buildLinearWorkflow(input: BuildLinearWorkflowInput): BuildLinearWorkflowResult {
  const repoTarget = normalizeRepoTarget(input.repoTarget);
  const selectedAgents = input.connectedAgents.map((agent) => agent.name);
  const patternOverride = patternForConnectedAgents(input.connectedAgents.length);
  const normalizedSpec = toNormalizedWorkflowSpec(input, repoTarget);
  const patternDecision = selectPattern(normalizedSpec, patternOverride);
  const labelText = input.issue.labels.length > 0 ? input.issue.labels.join(', ') : 'none';
  const rationale = [
    `Selected ${patternDecision.pattern} for ${input.connectedAgents.length} connected agent(s).`,
    `Issue labels: ${labelText}.`,
    patternDecision.reason,
  ].join(' ');

  return {
    artifactPath: `workflows/generated/linear-${slugify(`${input.issue.id}-${input.issue.title}`)}.ts`,
    artifactContent: renderWorkflowArtifact({
      input,
      repoTarget,
      pattern: patternDecision.pattern,
      selectedAgents,
      rationale,
    }),
    pattern: patternDecision.pattern,
    selectedAgents,
    rationale,
  };
}

function normalizeRepoTarget(
  repoTarget: BuildLinearWorkflowInput['repoTarget'],
): { owner: string; repo: string; defaultBranch: string } {
  if (!repoTarget?.owner?.trim() || !repoTarget.repo?.trim() || !repoTarget.defaultBranch?.trim()) {
    throw new Error('Linear workflow generation requires repoTarget with owner, repo, and defaultBranch.');
  }
  return {
    owner: repoTarget.owner.trim(),
    repo: repoTarget.repo.trim(),
    defaultBranch: repoTarget.defaultBranch.trim(),
  };
}

function patternForConnectedAgents(agentCount: number): SwarmPattern {
  if (agentCount >= 3) return 'dag';
  if (agentCount === 2) return 'supervisor';
  return 'pipeline';
}

function toNormalizedWorkflowSpec(
  input: BuildLinearWorkflowInput,
  repoTarget: { owner: string; repo: string; defaultBranch: string },
): NormalizedWorkflowSpec {
  const description = [
    input.issue.title,
    input.issue.description,
    ...input.issue.comments.map((comment) => `Comment: ${comment}`),
  ].filter(Boolean).join('\n\n');

  return {
    intent: 'generate',
    description,
    targetRepo: `${repoTarget.owner}/${repoTarget.repo}`,
    targetContext: input.issue.project ?? null,
    targetFiles: [],
    desiredAction: {
      kind: 'generate',
      summary: `Resolve Linear issue: ${input.issue.title}`,
      specText: description,
      targetFiles: [],
    },
    constraints: [
      { constraint: `Use connected Cloud agents: ${input.connectedAgents.map((agent) => agent.name).join(', ') || 'none'}.`, category: 'scope' },
      { constraint: `Open a GitHub PR against ${repoTarget.owner}/${repoTarget.repo}:${repoTarget.defaultBranch}.`, category: 'technical' },
    ],
    evidenceRequirements: [
      { requirement: 'Capture PR URL or no-change conclusion in Linear AgentActivity.', verificationType: 'artifact_exists' },
    ],
    requiredEvidence: [
      { requirement: 'Capture PR URL or no-change conclusion in Linear AgentActivity.', verificationType: 'artifact_exists' },
    ],
    acceptanceGates: [
      { gate: 'Generated workflow must finish with completed, completed_no_changes, or failed.', kind: 'deterministic' },
    ],
    acceptanceCriteria: [
      { gate: 'Generated workflow must finish with completed, completed_no_changes, or failed.', kind: 'deterministic' },
    ],
    executionPreference: 'cloud',
    providerContext: {
      surface: 'api',
      provider: 'linear',
      userId: input.actor.cloudUserId,
      metadata: {
        linearUserId: input.actor.linearUserId,
        issueLabels: input.issue.labels,
        connectedAgentCount: input.connectedAgents.length,
      },
    },
    sourceSpec: {
      surface: 'api',
      intent: { primary: 'generate', signals: ['linear-agent-session'] },
      description,
      targetRepo: `${repoTarget.owner}/${repoTarget.repo}`,
      targetFiles: [],
      constraints: [],
      evidenceRequirements: [],
      acceptanceGates: [],
      providerContext: {
        surface: 'api',
        provider: 'linear',
        userId: input.actor.cloudUserId,
        metadata: {},
      },
      rawPayload: {
        kind: 'structured_json',
        surface: 'api',
        receivedAt: new Date(0).toISOString(),
        data: { issue: input.issue },
      },
      parseConfidence: 'high',
      parseWarnings: [],
    },
  };
}

function renderWorkflowArtifact(params: {
  input: BuildLinearWorkflowInput;
  repoTarget: { owner: string; repo: string; defaultBranch: string };
  pattern: SwarmPattern;
  selectedAgents: ReadonlyArray<string>;
  rationale: string;
}): string {
  const agentLines = params.input.connectedAgents.map((agent) => (
    `- ${agent.name} (${agent.capabilities.join(', ') || 'general implementation'})`
  ));
  const comments = params.input.issue.comments.map((comment) => `- ${comment}`);
  const labels = params.input.issue.labels.join(', ') || 'none';
  return `// Generated by Ricky Linear surface. Cloud executes this workflow artifact.
export default {
  source: 'linear',
  pattern: ${JSON.stringify(params.pattern)},
  repo: ${JSON.stringify(params.repoTarget)},
  actor: ${JSON.stringify(params.input.actor)},
  selectedAgents: ${JSON.stringify(params.selectedAgents)},
  rationale: ${JSON.stringify(params.rationale)},
  issue: {
    id: ${JSON.stringify(params.input.issue.id)},
    title: ${JSON.stringify(params.input.issue.title)},
    description: ${JSON.stringify(params.input.issue.description)},
    labels: ${JSON.stringify(params.input.issue.labels)},
    project: ${JSON.stringify(params.input.issue.project ?? null)}
  },
  instructions: ${JSON.stringify([
    `Resolve the Linear issue titled "${params.input.issue.title}".`,
    `Use the connected agents: ${agentLines.join('; ') || 'Ricky default implementation agent'}.`,
    `Respect issue labels: ${labels}.`,
    `Review issue comments: ${comments.join('; ') || 'none'}.`,
    `Open a pull request against ${params.repoTarget.owner}/${params.repoTarget.repo}:${params.repoTarget.defaultBranch}, or report completed_no_changes with evidence.`,
  ].join('\n'))}
};
`;
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'issue';
}
