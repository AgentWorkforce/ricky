import type { NormalizedWorkflowSpec } from '../spec-intake/types.js';
import type { GenerationIssue, SkillApplicationEvidence, SkillContext, SkillDescriptor, TemplateDescriptor } from './types.js';
import { loadSkillRegistry, matchSkills } from './skill-matcher.js';

const TEMPLATE_REGISTRY: TemplateDescriptor[] = [
  {
    name: 'relay-typescript-workflow',
    path: 'embedded:packages/product/src/generation/template-renderer.ts',
    loaded: true,
    missingPrerequisites: [],
  },
];

export function loadSkills(spec: NormalizedWorkflowSpec, skillOverrides?: string[], templateOverride?: string): SkillContext {
  const registry = loadSkillRegistry();
  const matches = skillOverrides && skillOverrides.length > 0
    ? skillOverrides.map((name) => overrideMatch(name, registry))
    : matchSkills(spec, { registry });
  const skills = matches.map((match) => resolveSkill(match, Boolean(skillOverrides?.length)));
  const templates = resolveTemplates(templateOverride);
  const issues = buildIssues(skills, templates, registry.length);
  const loadWarnings = issues.filter((issue) => issue.severity !== 'info').map((issue) => issue.message);
  const applicationEvidence = buildGenerationTimeEvidence(skills);

  return {
    skills,
    templates,
    loadWarnings,
    applicableSkillNames: skills.filter((skill) => skill.loaded).map((skill) => skill.name),
    applicationEvidence,
    matches,
    issues,
  };
}

function overrideMatch(name: string, registry: ReturnType<typeof loadSkillRegistry>): ReturnType<typeof matchSkills>[number] {
  const descriptor = registry.find((candidate) => candidate.id === name || candidate.name === name);
  if (!descriptor) {
    return {
      id: name,
      name,
      path: '',
      confidence: 1,
      reason: 'Skill explicitly requested by override but was not found in the registry.',
      evidence: [{ trigger: name, source: 'override', detail: 'Skill override requested by caller.' }],
    };
  }
  return {
    id: descriptor.id,
    name: descriptor.name,
    path: descriptor.path,
    confidence: 1,
    reason: 'Skill explicitly requested by override.',
    evidence: [{ trigger: name, source: 'override', detail: 'Skill override requested by caller.' }],
    updatedAt: descriptor.updatedAt,
    preferredRunner: descriptor.preferredRunner,
    preferredModel: descriptor.preferredModel,
  };
}

function resolveSkill(match: ReturnType<typeof matchSkills>[number], forcedByOverride: boolean): SkillDescriptor {
  if (!match.path) {
    return {
      name: match.name,
      path: '',
      loaded: false,
      applicable: forcedByOverride,
      prerequisitesMet: false,
      missingPrerequisites: [`Unknown skill: ${match.name}`],
      confidence: match.confidence,
      matchReason: match.reason,
      preferredRunner: match.preferredRunner,
      preferredModel: match.preferredModel,
    };
  }

  return {
    name: match.name,
    path: match.path,
    loaded: true,
    applicable: true,
    prerequisitesMet: true,
    missingPrerequisites: [],
    confidence: match.confidence,
    matchReason: match.reason,
    preferredRunner: match.preferredRunner,
    preferredModel: match.preferredModel,
  };
}

function resolveTemplates(templateOverride?: string): TemplateDescriptor[] {
  if (!templateOverride) return TEMPLATE_REGISTRY;

  const template = TEMPLATE_REGISTRY.find((candidate) => candidate.name === templateOverride);
  if (template) return [template];

  return [
    {
      name: templateOverride,
      path: '',
      loaded: false,
      missingPrerequisites: [`Unknown template: ${templateOverride}`],
    },
  ];
}

function buildIssues(skills: SkillDescriptor[], templates: TemplateDescriptor[], registrySize: number): GenerationIssue[] {
  const registryIssues: GenerationIssue[] = registrySize === 0
    ? [
        {
          severity: 'warning',
          stage: 'skill_loading',
          code: 'SKILL_REGISTRY_EMPTY',
          message: 'No installed workflow-generation skills were found in the skill registry.',
          field: 'skillRegistry',
          fixHint: 'Install project or user skills to enable skill-aware workflow generation.',
          blocking: false,
        },
      ]
    : [];
  const skillIssues = skills.flatMap((skill): GenerationIssue[] => {
    if (skill.loaded || !skill.applicable) return [];

    return [
      {
        severity: skill.name === 'writing-agent-relay-workflows' ? 'error' : 'warning',
        stage: 'skill_loading',
        code: skill.path ? 'SKILL_PREREQUISITE_MISSING' : 'SKILL_UNKNOWN',
        message: skill.path
          ? `Skill ${skill.name} could not be loaded because prerequisites are missing: ${skill.missingPrerequisites.join(', ')}.`
          : `Skill ${skill.name} is not registered for workflow generation.`,
        field: 'skillOverrides',
        fixHint: skill.path ? 'Install or expose the missing prerequisite before generation signoff.' : 'Use a known workflow-generation skill name.',
        blocking: skill.name === 'writing-agent-relay-workflows',
      },
    ];
  });

  const templateIssues = templates.flatMap((template): GenerationIssue[] => {
    if (template.loaded) return [];
    return [
      {
        severity: 'error',
        stage: 'template_resolution',
        code: 'TEMPLATE_MISSING',
        message: `Template ${template.name} could not be resolved.`,
        field: 'templateOverride',
        fixHint: 'Use the embedded relay-typescript-workflow template or register a concrete template before rendering.',
        blocking: true,
      },
    ];
  });

  return [...registryIssues, ...skillIssues, ...templateIssues];
}

function buildGenerationTimeEvidence(skills: SkillDescriptor[]): SkillApplicationEvidence[] {
  return skills.flatMap((skill): SkillApplicationEvidence[] => {
    if (!skill.loaded) return [];

    return [
      {
        skillName: skill.name,
        stage: 'generation_selection',
        effect: 'workflow_contract',
        behavior: 'generation_time_only',
        runtimeEmbodiment: false,
        evidence: `Selected ${skill.name} during workflow generation. ${skill.matchReason ?? 'Registry matcher marked it applicable to the normalized spec.'}`,
      },
      {
        skillName: skill.name,
        stage: 'generation_loading',
        effect: 'metadata',
        behavior: 'generation_time_only',
        runtimeEmbodiment: false,
        evidence: `Loaded ${skill.name} descriptor before template rendering.`,
      },
    ];
  });
}
