import { describe, expect, it } from 'vitest';

import {
  buildPersonaSelectionFromRickyLocalSpec,
  DEFAULT_RICKY_LOCAL_CLAUDE_PERMISSIONS,
  type RickyLocalPersonaSpec,
} from './ricky-local-persona-resolver.js';

describe('buildPersonaSelectionFromRickyLocalSpec — permissions wiring', () => {
  it('defaults claude-harness selections to bypassPermissions (headless-safe) when neither spec nor runtime declares permissions', () => {
    const spec = makeClaudeSpec();
    const selection = buildPersonaSelectionFromRickyLocalSpec(spec, 'best-value');
    expect(selection.permissions).toEqual(DEFAULT_RICKY_LOCAL_CLAUDE_PERMISSIONS);
    expect(selection.permissions?.mode).toBe('bypassPermissions');
  });

  it('does NOT inject a default for codex/opencode selections (those harnesses have their own bypass semantics)', () => {
    const opencodeSpec: RickyLocalPersonaSpec = {
      ...makeClaudeSpec(),
      tiers: {
        best: { harness: 'codex', model: 'codex/x', systemPrompt: '', harnessSettings: {} },
        'best-value': { harness: 'opencode', model: 'opencode/x', systemPrompt: '', harnessSettings: {} },
        minimum: { harness: 'opencode', model: 'opencode/y', systemPrompt: '', harnessSettings: {} },
      },
    };
    expect(buildPersonaSelectionFromRickyLocalSpec(opencodeSpec, 'best').permissions).toBeUndefined();
    expect(buildPersonaSelectionFromRickyLocalSpec(opencodeSpec, 'best-value').permissions).toBeUndefined();
    expect(buildPersonaSelectionFromRickyLocalSpec(opencodeSpec, 'minimum').permissions).toBeUndefined();
  });

  it('prefers a tier-level `runtime.permissions` over the top-level spec and the default', () => {
    const spec: RickyLocalPersonaSpec = {
      ...makeClaudeSpec(),
      permissions: { mode: 'default' },
      tiers: {
        ...makeClaudeSpec().tiers,
        'best-value': {
          ...makeClaudeSpec().tiers['best-value'],
          permissions: { mode: 'acceptEdits', allow: ['Edit', 'Read'] },
        },
      },
    };
    const selection = buildPersonaSelectionFromRickyLocalSpec(spec, 'best-value');
    expect(selection.permissions).toEqual({ mode: 'acceptEdits', allow: ['Edit', 'Read'] });
  });

  it('falls back to top-level `spec.permissions` when the tier does not declare its own', () => {
    const spec: RickyLocalPersonaSpec = {
      ...makeClaudeSpec(),
      permissions: { mode: 'plan' },
    };
    const selection = buildPersonaSelectionFromRickyLocalSpec(spec, 'best');
    expect(selection.permissions).toEqual({ mode: 'plan' });
  });

  it('lets a persona opt out of the default by declaring `permissions: {}` (empty object) on the spec', () => {
    const spec: RickyLocalPersonaSpec = {
      ...makeClaudeSpec(),
      permissions: {},
    };
    const selection = buildPersonaSelectionFromRickyLocalSpec(spec, 'best-value');
    // Explicit empty-object opt-out: harness-kit sees "no permission overrides"
    // and applies its own defaults, rather than the resolver's bypass fallback.
    expect(selection.permissions).toEqual({});
  });

  it('lets a tier opt out of the default by declaring `runtime.permissions: {}` (empty object) on just that tier', () => {
    const spec: RickyLocalPersonaSpec = {
      ...makeClaudeSpec(),
      tiers: {
        ...makeClaudeSpec().tiers,
        minimum: {
          ...makeClaudeSpec().tiers.minimum,
          permissions: {},
        },
      },
    };
    expect(buildPersonaSelectionFromRickyLocalSpec(spec, 'minimum').permissions).toEqual({});
    // Other tiers still get the claude default.
    expect(buildPersonaSelectionFromRickyLocalSpec(spec, 'best-value').permissions?.mode).toBe('bypassPermissions');
  });

  it('omits `permissions` from the selection entirely when the resolved policy is undefined (codex/opencode default path)', () => {
    const opencodeSpec: RickyLocalPersonaSpec = {
      ...makeClaudeSpec(),
      tiers: {
        best: { harness: 'opencode', model: 'opencode/x', systemPrompt: '', harnessSettings: {} },
        'best-value': { harness: 'opencode', model: 'opencode/y', systemPrompt: '', harnessSettings: {} },
        minimum: { harness: 'opencode', model: 'opencode/z', systemPrompt: '', harnessSettings: {} },
      },
    };
    const selection = buildPersonaSelectionFromRickyLocalSpec(opencodeSpec, 'best');
    expect('permissions' in selection).toBe(false);
  });
});

function makeClaudeSpec(): RickyLocalPersonaSpec {
  return {
    id: 'agent-relay-workflow',
    intent: 'agent-relay-workflow',
    tags: ['implementation'],
    description: 'test fixture',
    skills: [],
    tiers: {
      best: {
        harness: 'claude',
        model: 'claude-opus-4-7',
        systemPrompt: 'best prompt',
        harnessSettings: { reasoning: 'high', timeoutSeconds: 3600 },
      },
      'best-value': {
        harness: 'claude',
        model: 'claude-sonnet-4-6',
        systemPrompt: 'best-value prompt',
        harnessSettings: { reasoning: 'medium', timeoutSeconds: 3600 },
      },
      minimum: {
        harness: 'claude',
        model: 'claude-haiku-4-5-20251001',
        systemPrompt: 'minimum prompt',
        harnessSettings: { reasoning: 'low', timeoutSeconds: 1800 },
      },
    },
  };
}
