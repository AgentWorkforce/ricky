import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUNDLED_RICKY_LOCAL_PERSONAS } from './bundled-personas.js';
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
  /**
   * Optional top-level permission policy. When the active tier does not
   * declare its own `permissions`, the resolver falls back to this value;
   * when both are unset, the resolver picks a harness-appropriate default
   * (`bypassPermissions` for claude, undefined for codex/opencode — see
   * {@link DEFAULT_RICKY_LOCAL_CLAUDE_PERMISSIONS}). Mirrors the shape
   * `@agentworkforce/harness-kit` reads off the selection in its
   * `useRunnableSelection` entrypoint.
   */
  permissions?: RickyLocalPersonaPermissions;
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
  /** Optional tier-level override of the persona's permission policy. */
  permissions?: RickyLocalPersonaPermissions;
}

/**
 * Shape consumed by harness-kit when it builds the spawn args:
 * - `mode` translates to `--permission-mode <mode>` for the claude harness.
 * - `allow` / `deny` translate to `--allowedTools` / `--disallowedTools`.
 * See `@agentworkforce/harness-kit`'s `harness.ts` for the canonical map.
 */
export interface RickyLocalPersonaPermissions {
  mode?: 'acceptEdits' | 'auto' | 'bypassPermissions' | 'default' | 'dontAsk' | 'plan';
  allow?: readonly string[];
  deny?: readonly string[];
}

/**
 * Default permission policy for Ricky-local personas that target the claude
 * harness. Ricky-local always invokes the writer subprocess **headlessly**
 * (no interactive caller able to grant tool-use approvals), so the default
 * has to be a mode the claude CLI treats as pre-authorized. Without this
 * the writer hangs on the first tool-permission prompt and ricky observes
 * a SIGTERM with empty stdout — exactly the failure mode that motivated
 * this constant.
 *
 * Personas can override this by declaring their own `permissions` block on
 * the spec or any tier; pass `{}` to opt out of bypass while still
 * surfacing tools, or `{ mode: 'default' }` to restore claude's default
 * (interactive) permission behavior for personas that genuinely need it.
 */
export const DEFAULT_RICKY_LOCAL_CLAUDE_PERMISSIONS: RickyLocalPersonaPermissions = Object.freeze({
  mode: 'bypassPermissions',
});

const PERSONA_SENTINEL = join('personas', 'agent-relay-workflow.json');

/**
 * Absolute path to the Ricky-local persona directory. Walks up from this
 * module's URL looking for a directory that contains the sentinel persona
 * file. Works under all the layouts Ricky ships in:
 * - source via tsx (`src/product/generation/...`)
 * - bundled CLI (`dist/ricky.js` adjacent to `personas/`)
 * - npm install (`node_modules/@agentworkforce/ricky/dist/ricky.js`)
 * Falls back to the legacy three-up resolution so tests that mock
 * `import.meta.url` still get a deterministic path.
 */
export function rickyLocalPersonaDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  let current = here;
  // Probe up to 8 parents — covers `dist/ricky.js`, `src/<a>/<b>/<c>.ts`,
  // and `node_modules/@scope/pkg/dist/<file>`.
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(current, PERSONA_SENTINEL))) {
      return join(current, 'personas');
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
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
 * Loads every Ricky-local persona spec available to the resolver. Seeds the
 * cache from {@link BUNDLED_RICKY_LOCAL_PERSONAS} (always present because
 * esbuild inlines them at bundle time), then layers any `personas/*.json`
 * read from `dir` on top so a developer-edited file overrides the bundled
 * default for that intent.
 *
 * The bundled fallback exists because the install-time filesystem layout has
 * proven fragile: between v0.1.38 and v0.1.51 the `files` array in
 * `package.json` did not include `"personas"`, so the published tarball
 * shipped without the directory and every `npm install -g
 * @agentworkforce/ricky` of those versions was silently broken at the writer
 * step. The bundle is the source of truth at runtime; the filesystem is a
 * developer-time override mechanism.
 *
 * Files that fail to parse are skipped silently — the resolver treats a
 * malformed override as "fall back to the bundled spec or the package
 * resolver" rather than hard-failing the writer.
 */
export async function loadAllRickyLocalPersonas(dir: string): Promise<LoadedPersonaCache> {
  const byIntent = new Map<string, RickyLocalPersonaSpec>();
  // Seed from the bundle so we always have at least the published persona
  // set, regardless of install layout or `files`-array drift.
  for (const spec of BUNDLED_RICKY_LOCAL_PERSONAS) {
    if (isRickyLocalPersonaSpec(spec)) {
      byIntent.set(spec.intent, spec);
    }
  }
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
      // Filesystem entries override the bundled spec for the same intent,
      // letting developers test persona changes without rebuilding the CLI.
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
  permissions?: RickyLocalPersonaPermissions;
} {
  const runtime = spec.tiers[tier];
  const permissions = resolvePermissionsForSelection(spec, runtime);
  return {
    personaId: spec.id,
    tier,
    runtime,
    skills: spec.skills,
    rationale: `Ricky-local Claude persona override for intent "${spec.intent}" (tier ${tier})`,
    ...(spec.inputs ? { inputs: spec.inputs } : {}),
    ...(spec.env ? { env: spec.env } : {}),
    ...(permissions ? { permissions } : {}),
  };
}

/**
 * Picks the permission policy attached to a Ricky-local persona selection.
 *
 * Precedence (first non-`undefined` wins):
 * 1. tier-level `runtime.permissions` — lets a persona vary tools per tier
 * 2. top-level `spec.permissions` — persona-wide default
 * 3. harness-appropriate fallback — for claude this is
 *    {@link DEFAULT_RICKY_LOCAL_CLAUDE_PERMISSIONS} (bypass mode) because
 *    Ricky-local always spawns the writer headlessly; for codex/opencode
 *    we return undefined so harness-kit applies its own defaults.
 *
 * Returning the literal empty object `{}` lets a persona explicitly clear
 * the default while still letting harness-kit see "no permission overrides"
 * (rather than the bypass fallback). Use that escape hatch only when the
 * persona genuinely wants claude's default interactive behavior.
 */
function resolvePermissionsForSelection(
  spec: RickyLocalPersonaSpec,
  runtime: RickyLocalPersonaRuntime,
): RickyLocalPersonaPermissions | undefined {
  if (runtime.permissions !== undefined) return runtime.permissions;
  if (spec.permissions !== undefined) return spec.permissions;
  if (runtime.harness === 'claude') return DEFAULT_RICKY_LOCAL_CLAUDE_PERMISSIONS;
  return undefined;
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
