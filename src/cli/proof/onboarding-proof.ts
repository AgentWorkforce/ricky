import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { chooseBannerVariant, renderBanner, shouldShowBanner, RICKY_BANNER } from '../ascii-art';
import {
  MODE_OPTIONS,
  renderCompactHeader,
  renderModeResult,
  renderModeSelector,
  type ModeOption,
  type OnboardingChoice,
} from '../mode-selector';
import { renderCloudGuidance, renderHandoffGuidance, renderOnboarding, renderRecoveryGuidance } from '../onboarding';
import { renderWelcome } from '../welcome';

export type ProofCaseName =
  | 'implementation-modules-present'
  | 'first-run-experience'
  | 'returning-user-compact-header'
  | 'local-byoh-path'
  | 'cloud-path'
  | 'google-connect-guidance'
  | 'github-dashboard-nango-guidance'
  | 'cli-mcp-handoff-language'
  | 'recovery-paths'
  | 'banner-suppression'
  | 'narrow-terminal-fallback';

export interface OnboardingProofCase {
  name: ProofCaseName;
  description: string;
  specSection: string;
  evaluate: () => OnboardingProofResult;
}

export interface OnboardingProofResult {
  name: string;
  passed: boolean;
  evidence: string[];
  gaps: string[];
  failures: string[];
}

export interface OnboardingProofSummary {
  passed: boolean;
  failures: string[];
  gaps: string[];
}

const REQUIRED_IMPLEMENTATION_FILES = [
  'src/cli/ascii-art.ts',
  'src/cli/welcome.ts',
  'src/cli/mode-selector.ts',
  'src/cli/onboarding.ts',
  'src/cli/index.ts',
] as const;

function result(
  name: ProofCaseName,
  checks: boolean[],
  evidence: string[],
  gaps: string[] = [],
  failures: string[] = [],
): OnboardingProofResult {
  return {
    name,
    passed: checks.every(Boolean) && failures.length === 0,
    evidence,
    gaps,
    failures,
  };
}

function containsAll(output: string, expected: string[]): boolean {
  return expected.every((text) => output.includes(text));
}

function excludesAll(output: string, forbidden: string[]): boolean {
  return forbidden.every((text) => !output.includes(text));
}

function appearsBefore(output: string, first: string, second: string): boolean {
  const firstIndex = output.indexOf(first);
  const secondIndex = output.indexOf(second);
  return firstIndex >= 0 && secondIndex >= 0 && firstIndex < secondIndex;
}

function hasNoAnsi(output: string): boolean {
  return !/\x1B\[[0-?]*[ -/]*[@-~]/u.test(output);
}

function compactEvidence(label: string, value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return `${label}: ${normalized}`;
}

function optionByTitle(title: string): ModeOption | undefined {
  return MODE_OPTIONS.find((option) => option.title === title);
}

export function getOnboardingProofCases(): OnboardingProofCase[] {
  return [
    {
      name: 'implementation-modules-present',
      description: 'Required CLI onboarding modules exist so proof exercises real implementation code.',
      specSection: '17. Recommended implementation files',
      evaluate: () => {
        const missing = REQUIRED_IMPLEMENTATION_FILES.filter((file) => !existsSync(resolve(process.cwd(), file)));

        return result(
          'implementation-modules-present',
          [missing.length === 0],
          [`required files: ${REQUIRED_IMPLEMENTATION_FILES.join(', ')}`],
          [],
          missing.map((file) => `Missing implementation file: ${file}`),
        );
      },
    },
    {
      name: 'first-run-experience',
      description: 'First run renders the banner, welcome framing, mode choice, handoff, and recovery sections.',
      specSection: '7. First-run flow',
      evaluate: () => {
        const output = renderOnboarding({ isFirstRun: true, isTTY: true, choice: 'local', env: {} });
        const bannerLines = RICKY_BANNER.split('\n');

        return result(
          'first-run-experience',
          [
            containsAll(output, [
              'RICKY',
              'workflow reliability for AgentWorkforce',
              'Welcome to Ricky',
              'Ricky helps you generate, debug, recover, and run workflows.',
              'How would you like to use Ricky?',
              'Local / BYOH',
              'Cloud',
              'Spec handoff:',
              'Recovery:',
            ]),
            bannerLines.length <= 10,
            bannerLines.every((line) => line.length <= 72 && !/\s$/u.test(line)),
            hasNoAnsi(renderBanner({ color: false })),
          ],
          [
            compactEvidence('first run', output),
            `banner lines: ${bannerLines.length}`,
            `banner max width: ${Math.max(...bannerLines.map((line) => line.length))}`,
          ],
        );
      },
    },
    {
      name: 'returning-user-compact-header',
      description: 'Returning users have a compact path distinct from the first-run ASCII banner.',
      specSection: '6.6 Compact header for returning users',
      evaluate: () => {
        const welcome = renderWelcome({ isFirstRun: false });
        const localHeader = renderCompactHeader('local');
        const cloudHeader = renderCompactHeader('cloud', {
          google: { connected: true },
          github: { connected: false },
        });
        const returningOutput = renderOnboarding({ isFirstRun: false, isTTY: true, noBanner: true });

        return result(
          'returning-user-compact-header',
          [
            containsAll(welcome, ['Ricky is ready']),
            localHeader === 'ricky · local mode · ready',
            cloudHeader === 'ricky · cloud mode · google connected',
            !returningOutput.includes(RICKY_BANNER),
          ],
          [
            compactEvidence('returning welcome', welcome),
            `local header: ${localHeader}`,
            `cloud header: ${cloudHeader}`,
          ],
        );
      },
    },
    {
      name: 'local-byoh-path',
      description: 'Local/BYOH is first, concrete, and not hidden behind Cloud.',
      specSection: '8.2 Option 1: Local / BYOH',
      evaluate: () => {
        const selector = renderModeSelector();
        const localResult = renderModeResult('local');
        const localOption = optionByTitle('Local / BYOH');

        return result(
          'local-byoh-path',
          [
            localOption?.choice === '1',
            appearsBefore(selector, 'Local / BYOH', 'Cloud'),
            containsAll(localResult, [
              'generate workflows into your local repo',
              'validate workflows using local tools',
              'run workflows via local agent-relay',
              'No Cloud credentials required.',
              'npx ricky generate --spec',
            ]),
          ],
          [compactEvidence('local selector', selector), compactEvidence('local result', localResult)],
        );
      },
    },
    {
      name: 'cloud-path',
      description: 'Cloud is a first-class mode with hosted execution and provider guidance.',
      specSection: '8.3 Option 2: Cloud',
      evaluate: () => {
        const selector = renderModeSelector();
        const cloudResult = renderModeResult('cloud');

        return result(
          'cloud-path',
          [
            containsAll(selector, ['[2] Cloud', 'AgentWorkforce Cloud']),
            containsAll(cloudResult, [
              'Cloud mode selected.',
              'generate and run workflows on AgentWorkforce Cloud',
              'Connect Google',
              'Connect GitHub',
              'Cloud dashboard',
            ]),
          ],
          [compactEvidence('cloud selector', selector), compactEvidence('cloud result', cloudResult)],
        );
      },
    },
    {
      name: 'google-connect-guidance',
      description: 'Google Cloud guidance uses the real agent-relay command.',
      specSection: '10.2 Google Cloud connect',
      evaluate: () => {
        const cloud = `${renderCloudGuidance()}\n${renderModeResult('cloud')}`;

        return result(
          'google-connect-guidance',
          [
            cloud.includes('npx agent-relay cloud connect google'),
            excludesAll(cloud, ['npx ricky connect google', 'agent-relay connect google']),
          ],
          [compactEvidence('google guidance', cloud)],
        );
      },
    },
    {
      name: 'github-dashboard-nango-guidance',
      description: 'GitHub guidance uses the Cloud dashboard/Nango flow and avoids invented commands or URLs.',
      specSection: '10.3 GitHub app connect',
      evaluate: () => {
        const cloud = `${renderCloudGuidance()}\n${renderModeResult('cloud')}`;

        return result(
          'github-dashboard-nango-guidance',
          [
            containsAll(cloud, ['GitHub', 'Cloud dashboard']),
            excludesAll(cloud, ['npx ricky connect github', 'github/connect/local', 'https://']),
          ],
          [compactEvidence('github guidance', cloud)],
        );
      },
    },
    {
      name: 'cli-mcp-handoff-language',
      description: 'Onboarding supports Claude, CLI, and MCP handoff language.',
      specSection: '11. Claude / CLI / MCP handoff story',
      evaluate: () => {
        const handoff = renderHandoffGuidance();

        return result(
          'cli-mcp-handoff-language',
          [
            containsAll(handoff, [
              'Claude',
              'CLI',
              'MCP',
              'Hand Ricky the spec directly.',
              'npx ricky generate --spec-file',
              'ricky.generate',
            ]),
          ],
          [compactEvidence('handoff', handoff)],
        );
      },
    },
    {
      name: 'recovery-paths',
      description: 'Blocked and generic recovery output is actionable and avoids stack traces.',
      specSection: '14. Happy-path and recovery-path flows',
      evaluate: () => {
        const blocked = renderRecoveryGuidance('agent-relay is missing');
        const generic = renderRecoveryGuidance();

        return result(
          'recovery-paths',
          [
            containsAll(blocked, [
              'blocked: agent-relay is missing',
              'fix the local runtime issue',
              'Cloud setup',
            ]),
            containsAll(generic, ['setup is interrupted', 'Cloud setup is blocked', 'continue in local mode']),
            excludesAll(`${blocked}\n${generic}`, ['TypeError:', 'Error:', '\n    at ', '\n  at ']),
          ],
          [compactEvidence('blocked recovery', blocked), compactEvidence('generic recovery', generic)],
        );
      },
    },
    {
      name: 'banner-suppression',
      description: 'Quiet, no-banner, non-TTY, and env opt-out suppress the banner.',
      specSection: '6.5 Display rules',
      evaluate: () => {
        const envSuppressed =
          shouldShowBanner({ isFirstRun: true, isTTY: true, env: { RICKY_BANNER: '0' } }) === false;

        return result(
          'banner-suppression',
          [
            shouldShowBanner({ isFirstRun: true, isTTY: true, quiet: true }) === false,
            shouldShowBanner({ isFirstRun: true, isTTY: true, noBanner: true }) === false,
            shouldShowBanner({ isFirstRun: true, isTTY: false }) === false,
            shouldShowBanner({ isFirstRun: true, isTTY: true, env: {} }) === true,
            envSuppressed,
          ],
          [
            'quiet: suppressed',
            'noBanner: suppressed',
            'nonTTY: suppressed',
            'RICKY_BANNER=0: suppressed',
          ],
        );
      },
    },
    {
      name: 'narrow-terminal-fallback',
      description: 'Narrow terminals use a compact text-only banner.',
      specSection: '19. Open questions / narrow terminal fallback',
      evaluate: () => {
        const compact = renderBanner('compact');
        const full = renderBanner('full');

        return result(
          'narrow-terminal-fallback',
          [
            chooseBannerVariant(50) === 'compact',
            chooseBannerVariant(60) === 'full',
            chooseBannerVariant(80) === 'full',
            compact === 'ricky · workflow reliability for AgentWorkforce',
            full.includes('workflow reliability for AgentWorkforce'),
          ],
          [`compact banner: ${compact}`],
        );
      },
    },
  ];
}

export function evaluateOnboardingProof(): OnboardingProofResult[] {
  return getOnboardingProofCases().map((proofCase) => proofCase.evaluate());
}

export function evaluateOnboardingProofCase(name: ProofCaseName): OnboardingProofResult {
  const proofCase = getOnboardingProofCases().find((candidate) => candidate.name === name);

  if (!proofCase) {
    throw new Error(`Unknown onboarding proof case: ${name}`);
  }

  return proofCase.evaluate();
}

export function summarizeOnboardingProof(): OnboardingProofSummary {
  const results = evaluateOnboardingProof();
  const failures = results.flatMap((result) =>
    result.passed ? [] : [`${result.name}: ${result.failures.join('; ') || 'contract assertion failed'}`],
  );
  const gaps = results.flatMap((result) => result.gaps.map((gap) => `${result.name}: ${gap}`));

  return {
    passed: failures.length === 0,
    failures,
    gaps,
  };
}
