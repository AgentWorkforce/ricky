import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { BUNDLED_RICKY_LOCAL_PERSONAS } from './bundled-personas.js';

const here = dirname(fileURLToPath(import.meta.url));
const personasDir = join(here, '..', '..', '..', 'personas');

describe('bundled personas', () => {
  it('matches every personas/*.json file on disk', async () => {
    const entries = await readdir(personasDir);
    const onDisk = entries.filter((entry) => entry.endsWith('.json')).map((entry) => entry.replace(/\.json$/u, ''));
    const bundledIds = BUNDLED_RICKY_LOCAL_PERSONAS.map((p) => p.id).sort();
    expect(bundledIds).toEqual(onDisk.sort());
  });

  it('parses every bundled persona as a structurally valid RickyLocalPersonaSpec', () => {
    for (const persona of BUNDLED_RICKY_LOCAL_PERSONAS) {
      expect(typeof persona.id).toBe('string');
      expect(typeof persona.intent).toBe('string');
      expect(persona.tiers).toBeDefined();
      expect(persona.tiers['best']).toBeDefined();
      expect(persona.tiers['best-value']).toBeDefined();
      expect(persona.tiers['minimum']).toBeDefined();
    }
  });

  it('is non-empty (regression guard against accidental removal of all entries)', () => {
    expect(BUNDLED_RICKY_LOCAL_PERSONAS.length).toBeGreaterThan(0);
  });
});
