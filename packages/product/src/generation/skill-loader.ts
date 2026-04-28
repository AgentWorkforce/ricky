import type { NormalizedWorkflowSpec } from '../spec-intake/types.js';
import type { GenerationIssue, SkillApplicationEvidence, SkillContext, SkillDescriptor, TemplateDescriptor } from './types.js';

interface SkillRegistryEntry {
  name: string;
  path: string;
  prerequisites: string[];
  isApplicable: (spec: NormalizedWorkflowSpec) => boolean;
}

const AVAILABLE_PREREQUISITES = new Set(['@agent-relay/sdk', 'embedded-relay-typescript-template']);

const SKILL_REGISTRY: SkillRegistryEntry[] = [
  {
    name: 'writing-agent-relay-workflows',
    path: 'skills/skills/writing-agent-relay-workflows/SKILL.md',
    prerequisites: ['@agent-relay/sdk'],
    isApplicable: () => true,
  },
  {
    name: 'choosing-swarm-patterns',
    path: 'skills/skills/choosing-swarm-patterns/SKILL.md',
    prerequisites: [],
    isApplicable: (spec) => spec.targetFiles.length !== 1 || spec.acceptanceGates.length > 0,
  },
  {
    name: 'relay-80-100-workflow',
    path: 'skills/skills/relay-80-100-workflow/SKILL.md',
    prerequisites: ['@agent-relay/sdk'],
    isApplicable: (spec) => requiresStrictValidation(spec),
  },
];

const TEMPLATE_REGISTRY: TemplateDescriptor[] = [
  {
    name: 'relay-typescript-workflow',
    path: 'embedded:packages/product/src/generation/template-renderer.ts',
    loaded: true,
    missingPrerequisites: [],
  },
];

export function loadSkills(spec: NormalizedWorkflowSpec, skillOverrides?: string[], templateOverride?: string): SkillContext {
  const requestedNames = skillOverrides && skillOverrides.length > 0 ? skillOverrides : SKILL_REGISTRY.map((entry) => entry.name);
  const skills = requestedNames.map((name) => resolveSkill(name, spec, Boolean(skillOverrides?.length)));
  const templates = resolveTemplates(templateOverride);
  const issues = buildIssues(skills, templates);
  const loadWarnings = issues.filter((issue) => issue.severity !== 'info').map((issue) => issue.message);
  const applicationEvidence = buildGenerationTimeEvidence(skills);

  return {
    skills,
    templates,
    loadWarnings,
    applicableSkillNames: skills.filter((skill) => skill.loaded).map((skill) => skill.name),
    applicationEvidence,
    issues,
  };
}

function resolveSkill(name: string, spec: NormalizedWorkflowSpec, forcedByOverride: boolean): SkillDescriptor {
  const entry = SKILL_REGISTRY.find((candidate) => candidate.name === name);
  if (!entry) {
    return {
      name,
      path: '',
      loaded: false,
      applicable: forcedByOverride,
      prerequisitesMet: false,
      missingPrerequisites: [`Unknown skill: ${name}`],
    };
  }

  const applicable = forcedByOverride || entry.isApplicable(spec);
  const missingPrerequisites = entry.prerequisites.filter((prerequisite) => !AVAILABLE_PREREQUISITES.has(prerequisite));
  const prerequisitesMet = missingPrerequisites.length === 0;

  return {
    name: entry.name,
    path: entry.path,
    loaded: applicable && prerequisitesMet,
    applicable,
    prerequisitesMet,
    missingPrerequisites,
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

function buildIssues(skills: SkillDescriptor[], templates: TemplateDescriptor[]): GenerationIssue[] {
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

  return [...skillIssues, ...templateIssues];
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
        evidence: `Selected ${skill.name} during workflow generation because it was applicable to the normalized spec.`,
      },
      {
        skillName: skill.name,
        stage: 'generation_loading',
        effect: 'metadata',
        behavior: 'generation_time_only',
        runtimeEmbodiment: false,
        evidence: `Loaded ${skill.name} descriptor from ${skill.path} before template rendering.`,
      },
    ];
  });
}

function requiresStrictValidation(spec: NormalizedWorkflowSpec): boolean {
  const text = [
    spec.description,
    ...spec.constraints.map((constraint) => constraint.constraint),
    ...spec.acceptanceGates.map((gate) => gate.gate),
    ...spec.evidenceRequirements.map((requirement) => requirement.requirement),
  ]
    .join('\n')
    .toLowerCase();

  return (
    spec.targetFiles.some((file) => !/\.(md|mdx|txt|adoc)$/i.test(file)) ||
    /\b(80.?to.?100|strict|proof|deterministic|typecheck|test|production|critical)\b/.test(text)
  );
}
