import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { NormalizedWorkflowSpec } from '../spec-intake/types.js';
import type { SkillMatch, SkillMatchEvidence, ToolRunner } from './types.js';

export interface SkillRegistryDescriptor {
  id: string;
  name: string;
  path: string;
  description: string;
  keywords: string[];
  filePatterns: string[];
  updatedAt?: string;
  preferredRunner?: ToolRunner;
  preferredModel?: string;
}

export interface SkillMatcherOptions {
  registry?: SkillRegistryDescriptor[];
  maxMatches?: number;
  threshold?: number;
  defaultSkillId?: string | null;
}

const DEFAULT_MAX_MATCHES = 5;
const DEFAULT_THRESHOLD = 0.4;
const DEFAULT_WORKFLOW_SKILL_IDS = [
  'choosing-swarm-patterns',
  'writing-agent-relay-workflows',
  'relay-80-100-workflow',
];
const PROJECT_SKILL_DIRS = ['.agents/skills', 'skills', '.claude/skills'];
const USER_SKILL_DIRS = ['.claude/skills'];
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

let cachedRegistry: SkillRegistryDescriptor[] | null = null;

export function matchSkills(spec: NormalizedWorkflowSpec, options: SkillMatcherOptions = {}): SkillMatch[] {
  const registry = options.registry ?? loadSkillRegistry();
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const maxMatches = options.maxMatches ?? DEFAULT_MAX_MATCHES;

  if (registry.length === 0) return [];

  const scored = registry
    .map((descriptor) => scoreDescriptor(descriptor, spec))
    .filter((match) => match.confidence >= threshold)
    .sort(compareMatches);

  if (options.defaultSkillId === undefined) {
    const withWorkflowDefaults = appendWorkflowDefaultMatches(scored, registry);
    return trimMatchesPreservingWorkflowDefaults(dedupeMatches(withWorkflowDefaults), maxMatches);
  }

  if (scored.length === 0 && typeof options.defaultSkillId === 'string') {
    const fallback = registry.find((descriptor) => descriptor.id === options.defaultSkillId);
    return fallback ? [fallbackMatch(fallback)] : [];
  }

  return dedupeMatches(scored).slice(0, maxMatches);
}

export function loadSkillRegistry(): SkillRegistryDescriptor[] {
  if (cachedRegistry) return cachedRegistry;
  cachedRegistry = discoverSkillRegistry();
  return cachedRegistry;
}

export function resetSkillRegistryCache(): void {
  cachedRegistry = null;
}

function discoverSkillRegistry(): SkillRegistryDescriptor[] {
  const roots = [
    ...projectSkillRoots(process.cwd()),
    ...packageSkillRoots(),
    ...USER_SKILL_DIRS.map((dir) => join(homedir(), dir)),
  ];
  const seen = new Set<string>();
  const descriptors: SkillRegistryDescriptor[] = [];

  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const skillPath of findSkillFiles(root)) {
      if (seen.has(skillPath)) continue;
      seen.add(skillPath);
      const descriptor = readSkillDescriptor(skillPath);
      if (descriptor) descriptors.push(descriptor);
    }
  }

  return dedupeDescriptors(descriptors);
}

function packageSkillRoots(): string[] {
  return [
    // Source execution: src/product/generation/skill-matcher.ts -> repo root.
    resolve(MODULE_DIR, '../../../.agents/skills'),
    // Bundled npm execution: dist/ricky.js -> package root.
    resolve(MODULE_DIR, '../.agents/skills'),
    // Future direct package layout: module file colocated with bundled skills.
    resolve(MODULE_DIR, '.agents/skills'),
  ];
}

function projectSkillRoots(startDir: string): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();
  let current = resolve(startDir);

  while (true) {
    for (const dir of PROJECT_SKILL_DIRS) {
      const root = resolve(current, dir);
      if (!seen.has(root)) {
        seen.add(root);
        roots.push(root);
      }
    }

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return roots;
}

function findSkillFiles(root: string): string[] {
  const files: string[] = [];
  const entries = safeReadDir(root);
  for (const entry of entries) {
    const path = join(root, entry);
    const stats = safeStat(path);
    if (!stats) continue;
    if (stats.isDirectory()) {
      const skillPath = join(path, 'SKILL.md');
      if (existsSync(skillPath)) files.push(skillPath);
      continue;
    }
    if (entry === 'SKILL.md') files.push(path);
  }
  return files;
}

function readSkillDescriptor(path: string): SkillRegistryDescriptor | null {
  try {
    const text = readFileSync(path, 'utf8');
    const frontmatter = parseFrontmatter(text);
    const dirName = basename(resolve(path, '..'));
    const name = readString(frontmatter, 'name') ?? dirName;
    const description = readString(frontmatter, 'description') ?? firstParagraph(text);
    const stats = statSync(path);
    return {
      id: name,
      name,
      path,
      description,
      keywords: readStringArray(frontmatter, 'keywords'),
      filePatterns: readStringArray(frontmatter, 'filePatterns'),
      preferredRunner: normalizeRunner(readString(frontmatter, 'preferredRunner') ?? readString(frontmatter, 'runner')),
      preferredModel: readString(frontmatter, 'preferredModel') ?? readString(frontmatter, 'model'),
      updatedAt: stats.mtime.toISOString(),
    };
  } catch {
    return null;
  }
}

function scoreDescriptor(descriptor: SkillRegistryDescriptor, spec: NormalizedWorkflowSpec): SkillMatch {
  const text = normalizedSpecText(spec);
  const targetFiles = spec.targetFiles.map((file) => file.toLowerCase());
  const evidence: SkillMatchEvidence[] = [];
  let score = 0;

  for (const phrase of descriptorPhrases(descriptor)) {
    if (phrase.length < 3) continue;
    if (text.includes(phrase)) {
      score += phrase.includes('-') || phrase.includes(' ') ? 0.3 : 0.2;
      evidence.push({ trigger: phrase, source: 'keyword', detail: `Spec text mentions "${phrase}".` });
    }
  }

  for (const keyword of descriptor.keywords.map((keyword) => keyword.toLowerCase())) {
    if (text.includes(keyword)) {
      score += 0.25;
      evidence.push({ trigger: keyword, source: 'keyword', detail: `Skill keyword "${keyword}" matched the spec.` });
    }
  }

  for (const pattern of descriptor.filePatterns) {
    if (targetFiles.some((file) => file.includes(pattern.toLowerCase().replace(/\*/g, '')))) {
      score += 0.25;
      evidence.push({ trigger: pattern, source: 'filename', detail: `Target file matched skill file pattern "${pattern}".` });
    }
  }

  const confidence = Math.min(1, Number(score.toFixed(2)));
  const reason = evidence.length > 0
    ? evidence.map((item) => item.detail).join(' ')
    : 'No registry trigger matched the normalized spec.';

  return {
    id: descriptor.id,
    name: descriptor.name,
    path: descriptor.path,
    confidence,
    reason,
    evidence,
    updatedAt: descriptor.updatedAt,
    preferredRunner: descriptor.preferredRunner,
    preferredModel: descriptor.preferredModel,
  };
}

function fallbackMatch(descriptor: SkillRegistryDescriptor): SkillMatch {
  return {
    id: descriptor.id,
    name: descriptor.name,
    path: descriptor.path,
    confidence: DEFAULT_THRESHOLD,
    reason: 'Project default skill loaded because no stronger registry trigger matched.',
    evidence: [
      {
        trigger: descriptor.id,
        source: 'fallback',
        detail: 'Fallback project workflow-generation skill.',
      },
    ],
    updatedAt: descriptor.updatedAt,
    preferredRunner: descriptor.preferredRunner,
    preferredModel: descriptor.preferredModel,
  };
}

function appendWorkflowDefaultMatches(
  matches: SkillMatch[],
  registry: SkillRegistryDescriptor[],
): SkillMatch[] {
  const present = new Set(matches.map((match) => match.id));
  const defaults = DEFAULT_WORKFLOW_SKILL_IDS
    .filter((id) => !present.has(id))
    .map((id) => registry.find((descriptor) => descriptor.id === id))
    .filter((descriptor): descriptor is SkillRegistryDescriptor => Boolean(descriptor))
    .map(fallbackMatch);

  return [...matches, ...defaults];
}

function trimMatchesPreservingWorkflowDefaults(matches: SkillMatch[], maxMatches: number): SkillMatch[] {
  if (matches.length <= maxMatches) return matches;

  const defaultMatches = matches.filter((match) => DEFAULT_WORKFLOW_SKILL_IDS.includes(match.id));
  const nonDefaultMatches = matches.filter((match) => !DEFAULT_WORKFLOW_SKILL_IDS.includes(match.id));
  return [...defaultMatches, ...nonDefaultMatches].slice(0, maxMatches).sort(compareMatches);
}

function compareMatches(a: SkillMatch, b: SkillMatch): number {
  if (b.confidence !== a.confidence) return b.confidence - a.confidence;
  return a.id.localeCompare(b.id);
}

function dedupeMatches(matches: SkillMatch[]): SkillMatch[] {
  const byId = new Map<string, SkillMatch>();
  for (const match of matches) {
    const existing = byId.get(match.id);
    if (!existing || compareMatches(match, existing) < 0) byId.set(match.id, match);
  }
  return [...byId.values()].sort(compareMatches);
}

function dedupeDescriptors(descriptors: SkillRegistryDescriptor[]): SkillRegistryDescriptor[] {
  const byId = new Map<string, SkillRegistryDescriptor>();
  for (const descriptor of descriptors) {
    if (!byId.has(descriptor.id)) {
      byId.set(descriptor.id, descriptor);
    }
  }
  return [...byId.values()];
}

function normalizedSpecText(spec: NormalizedWorkflowSpec): string {
  return [
    spec.description,
    ...spec.targetFiles,
    ...spec.constraints.map((constraint) => constraint.constraint),
    ...spec.evidenceRequirements.map((requirement) => requirement.requirement),
    ...spec.acceptanceGates.map((gate) => gate.gate),
  ].join('\n').toLowerCase();
}

function descriptorPhrases(descriptor: SkillRegistryDescriptor): string[] {
  const stop = new Set(['when', 'with', 'from', 'that', 'this', 'into', 'use', 'and', 'the', 'for', 'need', 'needs']);
  const source = `${descriptor.id} ${descriptor.name} ${descriptor.description}`.toLowerCase();
  return [...new Set(source.split(/[^a-z0-9@._/-]+/).filter((word) => word.length >= 4 && !stop.has(word)))];
}

function parseFrontmatter(text: string): Record<string, string | string[]> {
  if (!text.startsWith('---')) return {};
  const end = text.indexOf('\n---', 3);
  if (end === -1) return {};
  const lines = text.slice(3, end).split(/\r?\n/);
  const result: Record<string, string | string[]> = {};
  let activeArrayKey: string | null = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const arrayMatch = /^-\s*(.+)$/.exec(line);
    if (arrayMatch && activeArrayKey) {
      const existing = result[activeArrayKey];
      result[activeArrayKey] = [...(Array.isArray(existing) ? existing : []), stripQuotes(arrayMatch[1])];
      continue;
    }
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (value === '') {
      result[key] = [];
      activeArrayKey = key;
      continue;
    }
    result[key] = stripQuotes(value);
    activeArrayKey = null;
  }
  return result;
}

function firstParagraph(text: string): string {
  return text
    .replace(/^---[\s\S]*?\n---/, '')
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .find(Boolean) ?? '';
}

function readString(record: Record<string, string | string[]>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readStringArray(record: Record<string, string | string[]>, key: string): string[] {
  const value = record[key];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    return value.split(',').map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
}

function normalizeRunner(value: string | undefined): ToolRunner | undefined {
  if (value === 'claude' || value === 'codex' || value === 'cursor' || value === 'opencode' || value === '@agent-relay/sdk') {
    return value;
  }
  return undefined;
}

function stripQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, '').trim();
}

function safeReadDir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function safeStat(path: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}
