import { describe, expect, it } from 'vitest';

import {
  CLOUD_MODE,
  FIRST_CLASS_RICKY_MODES,
  LOCAL_BYOH_MODE,
  RICKY_ASCII_ART_WELCOME,
  MODE_OPTIONS,
  parseModeChoice,
  renderCloudGuidance,
  renderHandoffGuidance,
  renderModeSelection,
  renderModeResult,
  renderOnboarding,
  renderRecoveryGuidance,
  renderSuggestedNextAction,
  renderWelcome,
} from './index.js';

describe('Ricky CLI onboarding compatibility surface', () => {
  it('renders the deterministic first-run onboarding contract with Local/BYOH before Cloud', () => {
    const output = renderOnboarding({ isFirstRun: true, isTTY: true, env: {} });
    const cloudModeGuidance = renderModeResult('cloud');
    const localOptionIndex = output.indexOf('  > [1] Local / BYOH  — generate workflow artifacts for your local repo');
    const cloudOptionIndex = output.indexOf('    [2] Cloud         — generate workflow artifacts through AgentWorkforce Cloud');
    const localResultIndex = output.indexOf('  Local / BYOH mode selected.');
    const cloudGuidanceIndex = output.indexOf('Cloud provider guidance:');

    expect(output).toContain("Welcome to Ricky! Let's get you set up.");
    expect(output).toContain('Ricky generates workflow artifacts for your repo.');
    expect(output).toContain('  Choice [1]:');
    expect(localOptionIndex).toBeGreaterThanOrEqual(0);
    expect(cloudOptionIndex).toBeGreaterThan(localOptionIndex);
    expect(localResultIndex).toBeGreaterThan(cloudOptionIndex);
    expect(cloudGuidanceIndex).toBeGreaterThan(localResultIndex);
    expect(output).toContain('No Cloud credentials required.');
    expect(output).toContain('npx agent-relay cloud connect google');
    expect(output).toContain('Open your AgentWorkforce Cloud settings -> Integrations -> GitHub');
    expect(cloudModeGuidance).toContain('Cloud dashboard / Nango-backed connection flow.');
    expect(renderSuggestedNextAction('local')).toBe(
      'Next: run a local handoff with `ricky --mode local --spec "<workflow spec>"`, `--spec-file`, or `--stdin`.',
    );
  });

  it('re-exports the stable ASCII welcome and first-run copy', () => {
    const output = renderOnboarding({ isFirstRun: true, isTTY: true, env: {} });

    expect(RICKY_ASCII_ART_WELCOME).toContain('RICKY');
    expect(output).toContain('RRRR');
    expect(output).toContain("Welcome to Ricky! Let's get you set up.");
    expect(output).toContain('Ricky generates workflow artifacts for your repo.');
  });

  it('keeps local/BYOH and Cloud as first-class onboarding modes with local first', () => {
    const modeSelection = renderModeSelection();
    const output = renderOnboarding({ isFirstRun: true, isTTY: true, env: {} });
    const localIndex = output.indexOf('> [1] Local / BYOH');
    const cloudIndex = output.indexOf('[2] Cloud');

    expect(FIRST_CLASS_RICKY_MODES).toEqual([LOCAL_BYOH_MODE, CLOUD_MODE]);
    expect(MODE_OPTIONS[0]).toMatchObject({
      choice: '1',
      value: 'local',
      title: 'Local / BYOH',
    });
    expect(MODE_OPTIONS[1]).toMatchObject({
      choice: '2',
      value: 'cloud',
      title: 'Cloud',
    });
    expect(parseModeChoice('')).toBe('local');
    expect(modeSelection).toContain('  > [1] Local / BYOH  — generate workflow artifacts for your local repo');
    expect(modeSelection).toContain('    [2] Cloud         — generate workflow artifacts through AgentWorkforce Cloud');
    expect(modeSelection).toContain('  Choice [1]:');
    expect(localIndex).toBeGreaterThanOrEqual(0);
    expect(cloudIndex).toBeGreaterThan(localIndex);
    expect(output.indexOf('Local / BYOH mode selected.')).toBeLessThan(output.indexOf('Cloud provider guidance:'));
    expect(output).toContain('No Cloud credentials required.');
  });

  it('keeps Cloud provider guidance assertable at the legacy path without requiring auth', () => {
    const output = `${renderCloudGuidance()}\n${renderModeResult('cloud')}`;

    expect(output).toContain('npx agent-relay cloud connect google');
    expect(output).toContain('Cloud dashboard');
    expect(output).toContain('Nango-backed connection flow');
    expect(output).toContain('Open your AgentWorkforce Cloud settings -> Integrations -> GitHub');
    expect(output).not.toContain('github/connect/local');
  });

  it('keeps local and Cloud next-action contracts stable', () => {
    expect(renderSuggestedNextAction('local')).toBe(
      'Next: run a local handoff with `ricky --mode local --spec "<workflow spec>"`, `--spec-file`, or `--stdin`.',
    );
    expect(renderSuggestedNextAction('cloud')).toContain('connect Google with `npx agent-relay cloud connect google`');
    expect(LOCAL_BYOH_MODE.nextAction).toContain('ricky --mode local --spec');
    expect(CLOUD_MODE.nextAction).toContain('npx agent-relay cloud connect google');
  });

  it('keeps handoff and recovery guidance assertable at the legacy path', () => {
    const output = [
      renderHandoffGuidance(),
      renderRecoveryGuidance('agent-relay is missing'),
      renderSuggestedNextAction('local'),
      renderWelcome({ isFirstRun: false }),
    ].join('\n');

    expect(output).toContain('ricky --mode local --spec "generate a workflow for package checks"');
    expect(output).toContain('ricky --mode local --spec-file ./path/to/spec.md');
    expect(output).toContain('ricky --mode local --stdin');
    expect(output).toMatch(/recovery|missing|blocked/i);
    expect(output).toContain('Fix the issue above, then retry the same command.');
    expect(output).toContain('Ricky is ready.');
  });
});
