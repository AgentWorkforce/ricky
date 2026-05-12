import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  defaultWorkforcePersonaResolver as packageWorkforcePersonaResolver,
  WorkforcePersonaWriterError,
  type ResolvedWorkforcePersonaContext,
  type WorkforcePersonaContext,
  type WorkforcePersonaResolver,
  type WorkforcePersonaModule,
} from './workforce-persona-writer.js';

/**
 * Tiers accepted by Ricky-local persona specs. Mirrors the workload-router
 * 0.19 `PersonaTier` tuple. We hardcode it instead of importing because the
 * Ricky-local resolver must keep loading even when `@agentworkforce/workload-router`
 * is unavailable (the test path stubs the package out).
 */
export const RICKY_LOCAL_PERSONA_TIERS = ['best', 'best-value', 'minimum'] as const;
export type RickyLocalPersonaTier = (typeof RICKY_LOCAL_PERSONA_TIERS)[number];

const DEFAULT_RICKY_LOCAL_TIER: RickyLocalPersonaTier = 'best-value';

export interface RickyLocalPersonaSpec {
  id: string;
  intent: string;
  tags: string[];
  description: string;
  skills: Array<{ id: string; source: string; description: string }>;
  inputs?: Record<string, { description?: string; default?: string; optional?: boolean }>;
  tiers: Record<RickyLocalPersonaTier, RickyLocalPersonaRuntime>;
  defaultTier?: RickyLocalPersonaTier;
  env?: Record<string, string>;
}

export interface RickyLocalPersonaRuntime {
  harness: 'claude' | 'codex' | 'opencode';
  model: string;
  systemPrompt: string;
  harnessSettings: {
    reasoning?: string;
    timeoutSeconds?: number;
  };
  claudeMd?: string;
  agentsMd?: string;
}

/** Absolute path to the Ricky-local persona directory inside the repo. */
export function rickyLocalPersonaDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', 'personas');
}

interface LoadedPersonaCache {
  byIntent: Map<string, RickyLocalPersonaSpec>;
}

let cachedPersonas: Promise<LoadedPersonaCache> | undefined;

/**
 * Returns the Ricky-local persona for `intent`, or `null` when no Ricky-local
 * override exists. Reads `personas/*.json` lazily on first call and memoizes
 * across the process lifetime.
 */
export async function loadRickyLocalPersona(intent: string): Promise<RickyLocalPersonaSpec | null> {
  const cache = await (cachedPersonas ??= loadAllRickyLocalPersonas(rickyLocalPersonaDir()));
  return cache.byIntent.get(intent) ?? null;
}

/** Test seam: forget any cached Ricky-local persona specs so subsequent loads re-read from disk. */
export function resetRickyLocalPersonaCacheForTests(): void {
  cachedPersonas = undefined;
}

/**
 * Loads every `personas/*.json` Ricky-local spec from `dir`. Files that fail
 * to parse are skipped with a warning rather than throwing; the resolver
 * should treat a missing or malformed override as "fall through to the
 * package resolver" rather than hard-failing the writer.
 */
export async function loadAllRickyLocalPersonas(dir: string): Promise<LoadedPersonaCache> {
  const byIntent = new Map<string, RickyLocalPersonaSpec>();
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { byIntent };
    }
    throw error;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const path = join(dir, entry);
    try {
      const text = await readFile(path, 'utf8');
      const spec = JSON.parse(text) as RickyLocalPersonaSpec;
      if (!isRickyLocalPersonaSpec(spec)) {
        continue;
      }
      byIntent.set(spec.intent, spec);
    } catch {
      // Skip unreadable or invalid persona JSONs; the resolver falls through.
    }
  }
  return { byIntent };
}

function isRickyLocalPersonaSpec(value: unknown): value is RickyLocalPersonaSpec {
  if (!value || typeof value !== 'object') return false;
  const spec = value as Partial<RickyLocalPersonaSpec>;
  if (typeof spec.id !== 'string' || typeof spec.intent !== 'string') return false;
  if (!spec.tiers || typeof spec.tiers !== 'object') return false;
  return RICKY_LOCAL_PERSONA_TIERS.every((tier) => {
    const runtime = spec.tiers?.[tier];
    return (
      runtime !== undefined &&
      typeof runtime.harness === 'string' &&
      typeof runtime.model === 'string' &&
      typeof runtime.systemPrompt === 'string'
    );
  });
}

/**
 * Resolves the tier to use for a given Ricky-local persona. Honors
 * `options.tier` first, then the persona's own `defaultTier`, then
 * `'best-value'` (the system-wide default). Falls back to `'best-value'`
 * when the requested tier isn't declared on the spec.
 */
export function resolveRickyLocalPersonaTier(
  spec: RickyLocalPersonaSpec,
  options: { tier?: string } = {},
): RickyLocalPersonaTier {
  const requested = options.tier && isLocalTier(options.tier) ? options.tier : undefined;
  const declared = requested ?? spec.defaultTier ?? DEFAULT_RICKY_LOCAL_TIER;
  return spec.tiers[declared] ? declared : DEFAULT_RICKY_LOCAL_TIER;
}

function isLocalTier(value: string): value is RickyLocalPersonaTier {
  return (RICKY_LOCAL_PERSONA_TIERS as readonly string[]).includes(value);
}

/**
 * Builds a workload-router-compatible `PersonaSelection` object from a
 * Ricky-local persona spec. The output is typed loosely because workload-router
 * does not export its `PersonaSelection` parser, and Ricky-local personas are
 * hand-validated at load time.
 */
export function buildPersonaSelectionFromRickyLocalSpec(
  spec: RickyLocalPersonaSpec,
  tier: RickyLocalPersonaTier,
): {
  personaId: string;
  tier: RickyLocalPersonaTier;
  runtime: RickyLocalPersonaRuntime;
  skills: RickyLocalPersonaSpec['skills'];
  rationale: string;
  inputs?: RickyLocalPersonaSpec['inputs'];
  env?: RickyLocalPersonaSpec['env'];
} {
  const runtime = spec.tiers[tier];
  return {
    personaId: spec.id,
    tier,
    runtime,
    skills: spec.skills,
    rationale: `Ricky-local Claude persona override for intent "${spec.intent}" (tier ${tier})`,
    ...(spec.inputs ? { inputs: spec.inputs } : {}),
    ...(spec.env ? { env: spec.env } : {}),
  };
}

interface HarnessKitRunnableSelectionModule {
  useRunnableSelection?: WorkforcePersonaModule['useRunnableSelection'];
}

type RunnableSelectionLoader = () => Promise<HarnessKitRunnableSelectionModule>;

async function defaultLoadRunnableSelectionModule(): Promise<HarnessKitRunnableSelectionModule> {
  return (await import('@agentworkforce/harness-kit')) as HarnessKitRunnableSelectionModule;
}

/**
 * Creates a `WorkforcePersonaResolver` that prefers Ricky-local Claude
 * persona overrides (`personas/*.json`) over the package resolver. For any
 * intent that has no Ricky-local override, the resolver falls back to the
 * supplied `fallback` (defaults to {@link packageWorkforcePersonaResolver}),
 * preserving the prior workforce-package behavior end-to-end.
 *
 * The Ricky-local path constructs a `PersonaSelection` by hand and hands
 * it to `@agentworkforce/harness-kit`'s `useRunnableSelection` to obtain a
 * runnable `WorkforcePersonaContext`. This avoids depending on the v3
 * persona-kit shape (which dropped tiers) and stays compatible with the
 * 0.19 router/harness-kit pair pinned by Ricky today.
 */
export function createRickyLocalPersonaResolver(
  options: {
    fallback?: WorkforcePersonaResolver;
    loadRunnableSelectionModule?: RunnableSelectionLoader;
  } = {},
): WorkforcePersonaResolver {
  const fallback = options.fallback ?? packageWorkforcePersonaResolver;
  const load = options.loadRunnableSelectionModule ?? defaultLoadRunnableSelectionModule;

  return async (intents, resolverOptions) => {
    const localWarnings: string[] = [];

    for (const intent of intents) {
      const spec = await loadRickyLocalPersona(intent);
      if (!spec) continue;

      const tier = resolveRickyLocalPersonaTier(spec, resolverOptions);
      const selection = buildPersonaSelectionFromRickyLocalSpec(spec, tier);

      let runnableModule: HarnessKitRunnableSelectionModule;
      try {
        runnableModule = await load();
      } catch (error) {
        localWarnings.push(
          `Ricky-local persona override for "${intent}" could not load @agentworkforce/harness-kit: ${errorMessage(error)}.`,
        );
        break;
      }
      if (typeof runnableModule.useRunnableSelection !== 'function') {
        localWarnings.push(
          `Ricky-local persona override for "${intent}" skipped: @agentworkforce/harness-kit did not export useRunnableSelection().`,
        );
        break;
      }

      try {
        const installRootOption = resolverOptions.installRoot !== undefined ? { installRoot: resolverOptions.installRoot } : {};
        const context = runnableModule.useRunnableSelection(selection, installRootOption);
        if (isUsableContext(context)) {
          return {
            source: 'package',
            intent,
            context,
            warnings: [
              ...localWarnings,
              `Ricky-local Claude persona override resolved for intent "${intent}" at tier "${tier}".`,
            ],
          } satisfies ResolvedWorkforcePersonaContext;
        }
        localWarnings.push(
          `Ricky-local persona override for "${intent}" produced an unusable runnable context; falling through.`,
        );
      } catch (error) {
        localWarnings.push(
          `Ricky-local persona override for "${intent}" failed to build a runnable context: ${errorMessage(error)}.`,
        );
      }
    }

    try {
      const downstream = await fallback(intents, resolverOptions);
      return {
        ...downstream,
        warnings: [...localWarnings, ...downstream.warnings],
      };
    } catch (error) {
      if (error instanceof WorkforcePersonaWriterError) {
        throw new WorkforcePersonaWriterError(error.message, [...localWarnings, ...error.warnings]);
      }
      throw error;
    }
  };
}

function isUsableContext(value: unknown): value is WorkforcePersonaContext {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { selection?: unknown; sendMessage?: unknown };
  return typeof candidate.sendMessage === 'function' && candidate.selection !== undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
