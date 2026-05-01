import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { chooseBannerVariant, renderBanner, shouldShowBanner, RICKY_BANNER } from '../ascii-art.js';
import {
  MODE_OPTIONS,
  renderCompactHeader,
  renderModeResult,
  renderModeSelector,
  type ModeOption,
  type OnboardingChoice,
} from '../mode-selector.js';
import { renderCloudGuidance, renderHandoffGuidance, renderOnboarding, renderRecoveryGuidance, renderSuggestedNextAction } from '../onboarding.js';
import { renderWelcome } from '../welcome.js';
import { parseArgs, renderHelp } from '../../commands/cli-main.js';

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
  | 'narrow-terminal-fallback'
  | 'default-journey'
  | 'local-journey'
  | 'setup-journey'
  | 'welcome-journey'
  | 'status-journey'
  | 'generate-journey'
  | 'fixture-inline-spec'
  | 'fixture-spec-file'
  | 'fixture-stdin'
  | 'fixture-missing-spec'
  | 'fixture-missing-file-recovery';

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
  'src/surfaces/cli/cli/ascii-art.ts',
  'src/surfaces/cli/cli/welcome.ts',
  'src/surfaces/cli/cli/mode-selector.ts',
  'src/surfaces/cli/cli/onboarding.ts',
  'src/surfaces/cli/cli/index.ts',
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

function implementationFileExists(file: string): boolean {
  return existsSync(resolve(process.cwd(), file)) || existsSync(resolve(process.cwd(), '..', '..', file));
}

export function getOnboardingProofCases(): OnboardingProofCase[] {
  return [
    {
      name: 'implementation-modules-present',
      description: 'Required CLI onboarding modules exist so proof exercises real implementation code.',
      specSection: '17. Recommended implementation files',
      evaluate: () => {
        const missing = REQUIRED_IMPLEMENTATION_FILES.filter((file) => !implementationFileExists(file));

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
              'Ricky generates workflow artifacts for your repo.',
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
              'writes a workflow artifact into workflows/generated/ in your repo',
              'Execution (opt-in only)',
              'Nothing is executed at this stage.',
              'No Cloud credentials required.',
              'CLI help',
            ]),
            excludesAll(localResult, ['npx ricky generate --spec', 'npx ricky debug --workflow', 'npx ricky setup']),
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
              'hand workflow generation requests to AgentWorkforce Cloud',
              'does not stream Cloud execution evidence',
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
      description: 'Onboarding supports CLI handoff language without overclaiming MCP/Claude surfaces.',
      specSection: '11. Claude / CLI / MCP handoff story',
      evaluate: () => {
        const handoff = renderHandoffGuidance();

        return result(
          'cli-mcp-handoff-language',
          [
            containsAll(handoff, [
              'Give Ricky a spec',
              'Generation does not execute anything',
              'Direct CLI handoff:',
              'Generate only (default)',
              'MCP handoff:',
              'ricky.generate',
            ]),
            excludesAll(handoff, ['npx ricky generate --spec', 'npx ricky generate --spec-file', 'spec-stdin']),
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
              'Blocked: agent-relay is missing',
              'Fix the issue above',
            ]),
            containsAll(generic, ['Setup interrupted?', 'Cloud blocked?', 'Continue locally']),
            excludesAll(`${blocked}\n${generic}`, ['TypeError:', '\n    at ', '\n  at ']),
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

    // -----------------------------------------------------------------------
    // Journey proof cases — default, local, setup, welcome, status, generate
    // -----------------------------------------------------------------------

    {
      name: 'default-journey',
      description: 'Default (no args) journey parses to `run` and surfaces help/version/run as the only commands.',
      specSection: 'CLI command surface — default journey',
      evaluate: () => {
        const parsed = parseArgs([]);
        const helpParsed = parseArgs(['help']);
        const versionParsed = parseArgs(['version']);
        const helpLines = renderHelp();
        const helpText = helpLines.join('\n');

        return result(
          'default-journey',
          [
            parsed.command === 'run',
            parsed.mode === undefined,
            parsed.spec === undefined,
            helpParsed.command === 'help',
            versionParsed.command === 'version',
            helpText.includes('ricky'),
            !helpText.includes('npx ricky generate'),
            !helpText.includes('npx ricky debug'),
          ],
          [
            `default parse: command=${parsed.command}`,
            `help parse: command=${helpParsed.command}`,
            `version parse: command=${versionParsed.command}`,
            `help mentions ricky: ${helpText.includes('ricky')}`,
            `no invented commands: ${!helpText.includes('npx ricky generate')}`,
          ],
        );
      },
    },
    {
      name: 'local-journey',
      description: 'Local mode journey parses --mode local correctly and surfaces local handoff options.',
      specSection: 'CLI command surface — local journey',
      evaluate: () => {
        const parsed = parseArgs(['--mode', 'local']);
        const withSpec = parseArgs(['--mode', 'local', '--spec', 'build a workflow']);
        const localResult = renderModeResult('local');
        const nextAction = renderSuggestedNextAction('local');

        return result(
          'local-journey',
          [
            parsed.command === 'run',
            parsed.mode === 'local',
            withSpec.mode === 'local',
            withSpec.spec === 'build a workflow',
            localResult.includes('Local / BYOH mode selected'),
            localResult.includes('No Cloud credentials required'),
            nextAction.includes('--spec'),
          ],
          [
            `local parse: mode=${parsed.mode}`,
            `local+spec parse: spec=${withSpec.spec}`,
            `local result contains handoff guidance: ${localResult.includes('--spec')}`,
            compactEvidence('next action', nextAction),
          ],
        );
      },
    },
    {
      name: 'setup-journey',
      description: 'Setup journey verifies first-run onboarding renders mode selector and all five choices per the simplified CLI spec.',
      specSection: 'CLI command surface — setup journey',
      evaluate: () => {
        const output = renderOnboarding({ isFirstRun: true, isTTY: true, choice: 'local', env: {} });
        const selector = renderModeSelector();

        return result(
          'setup-journey',
          [
            output.includes('Welcome to Ricky'),
            output.includes('How would you like to use Ricky?'),
            selector.includes('[1] Local / BYOH'),
            selector.includes('[2] Cloud'),
            selector.includes('[3] Status'),
            selector.includes('[4] Connect tools'),
            selector.includes('[5] Exit'),
            selector.includes('Choice [1]:'),
          ],
          [
            `first-run includes welcome: true`,
            `selector has all 4 choices: true`,
            `selector has all 5 simplified-CLI choices: true`,
            compactEvidence('selector', selector),
          ],
        );
      },
    },
    {
      name: 'welcome-journey',
      description: 'Welcome journey verifies first-run and returning user welcome text are distinct.',
      specSection: 'CLI command surface — welcome journey',
      evaluate: () => {
        const firstRun = renderWelcome({ isFirstRun: true });
        const returning = renderWelcome({ isFirstRun: false });

        return result(
          'welcome-journey',
          [
            firstRun.includes('Welcome to Ricky'),
            firstRun.includes('generates workflow artifacts'),
            returning.includes('Ricky is ready'),
            !returning.includes('Welcome to Ricky'),
            firstRun !== returning,
          ],
          [
            compactEvidence('first-run welcome', firstRun),
            compactEvidence('returning welcome', returning),
          ],
        );
      },
    },
    {
      name: 'status-journey',
      description: 'Status journey verifies compact header renders mode and provider status correctly.',
      specSection: 'CLI command surface — status journey',
      evaluate: () => {
        const localHeader = renderCompactHeader('local');
        const cloudConnected = renderCompactHeader('cloud', { google: { connected: true }, github: { connected: false } });
        const cloudDisconnected = renderCompactHeader('cloud', { google: { connected: false }, github: { connected: false } });
        const bothConnected = renderCompactHeader('both', { google: { connected: true }, github: { connected: false } });
        const bothDisconnected = renderCompactHeader('both', { google: { connected: false }, github: { connected: false } });

        return result(
          'status-journey',
          [
            localHeader === 'ricky · local mode · ready',
            cloudConnected.includes('google connected'),
            cloudDisconnected.includes('google not connected'),
            bothConnected.includes('cloud connected'),
            bothDisconnected.includes('cloud not connected'),
          ],
          [
            `local: ${localHeader}`,
            `cloud+google: ${cloudConnected}`,
            `cloud-google: ${cloudDisconnected}`,
            `both+google: ${bothConnected}`,
            `both-google: ${bothDisconnected}`,
          ],
        );
      },
    },
    {
      name: 'generate-journey',
      description: 'Generate journey verifies spec handoff parsing and help text reference the generate example.',
      specSection: 'CLI command surface — generate journey',
      evaluate: () => {
        const genSpec = parseArgs(['--mode', 'local', '--spec', 'generate a workflow for package checks']);
        const helpText = renderHelp().join('\n');
        const localResult = renderModeResult('local');

        return result(
          'generate-journey',
          [
            genSpec.command === 'run',
            genSpec.mode === 'local',
            genSpec.spec === 'generate a workflow for package checks',
            helpText.includes('generate a workflow for package checks'),
            localResult.includes('generate a workflow for package checks'),
            !helpText.includes('npx ricky generate'),
          ],
          [
            `generate spec parsed: ${genSpec.spec}`,
            `help references generate example: ${helpText.includes('generate a workflow for package checks')}`,
            `local result references generate: ${localResult.includes('generate a workflow for package checks')}`,
            `no invented generate command: ${!helpText.includes('npx ricky generate')}`,
          ],
        );
      },
    },

    // -----------------------------------------------------------------------
    // Fixture proof cases — inline spec, spec file, stdin, missing spec, missing file recovery
    // -----------------------------------------------------------------------

    {
      name: 'fixture-inline-spec',
      description: 'Inline --spec flag parses correctly and creates a run command with spec text.',
      specSection: 'CLI spec fixtures — inline spec',
      evaluate: () => {
        const simple = parseArgs(['--spec', 'hello world']);
        const withMode = parseArgs(['--mode', 'local', '--spec', 'build a workflow']);
        const empty = parseArgs(['--spec']);

        return result(
          'fixture-inline-spec',
          [
            simple.command === 'run',
            simple.spec === 'hello world',
            withMode.mode === 'local',
            withMode.spec === 'build a workflow',
            empty.errors !== undefined,
            empty.errors?.[0]?.includes('--spec requires a value') === true,
          ],
          [
            `simple inline: spec=${simple.spec}`,
            `with mode: mode=${withMode.mode}, spec=${withMode.spec}`,
            `empty --spec errors: ${JSON.stringify(empty.errors)}`,
          ],
        );
      },
    },
    {
      name: 'fixture-spec-file',
      description: '--spec-file and --file flags parse to specFile field correctly.',
      specSection: 'CLI spec fixtures — spec file',
      evaluate: () => {
        const specFile = parseArgs(['--spec-file', './spec.md']);
        const fileAlias = parseArgs(['--file', './workflow.md']);
        const missingValue = parseArgs(['--spec-file']);
        const withMode = parseArgs(['--mode', 'local', '--spec-file', './path/to/spec.md']);

        return result(
          'fixture-spec-file',
          [
            specFile.command === 'run',
            specFile.specFile === './spec.md',
            fileAlias.specFile === './workflow.md',
            missingValue.errors !== undefined,
            missingValue.errors?.[0]?.includes('--spec-file requires a value') === true,
            withMode.mode === 'local',
            withMode.specFile === './path/to/spec.md',
          ],
          [
            `--spec-file: ${specFile.specFile}`,
            `--file alias: ${fileAlias.specFile}`,
            `missing value errors: ${JSON.stringify(missingValue.errors)}`,
            `with mode: mode=${withMode.mode}, specFile=${withMode.specFile}`,
          ],
        );
      },
    },
    {
      name: 'fixture-stdin',
      description: '--stdin flag parses correctly and sets stdin=true.',
      specSection: 'CLI spec fixtures — stdin',
      evaluate: () => {
        const stdinOnly = parseArgs(['--stdin']);
        const stdinWithMode = parseArgs(['--mode', 'local', '--stdin']);
        const noStdin = parseArgs(['--mode', 'local']);

        return result(
          'fixture-stdin',
          [
            stdinOnly.command === 'run',
            stdinOnly.stdin === true,
            stdinWithMode.mode === 'local',
            stdinWithMode.stdin === true,
            noStdin.stdin === undefined,
          ],
          [
            `stdin only: stdin=${stdinOnly.stdin}`,
            `stdin+mode: mode=${stdinWithMode.mode}, stdin=${stdinWithMode.stdin}`,
            `no stdin flag: stdin=${noStdin.stdin}`,
          ],
        );
      },
    },
    {
      name: 'fixture-missing-spec',
      description: 'Missing spec (no --spec, --spec-file, or --stdin) results in a run command with no spec fields.',
      specSection: 'CLI spec fixtures — missing spec',
      evaluate: () => {
        const noSpec = parseArgs([]);
        const modeOnly = parseArgs(['--mode', 'local']);
        const recoveryText = renderOnboarding({ isFirstRun: false, isTTY: true, noBanner: true, mode: 'local' });

        return result(
          'fixture-missing-spec',
          [
            noSpec.command === 'run',
            noSpec.spec === undefined,
            noSpec.specFile === undefined,
            noSpec.stdin === undefined,
            modeOnly.spec === undefined,
            modeOnly.specFile === undefined,
            modeOnly.stdin === undefined,
            recoveryText.includes('--spec') || recoveryText.includes('spec'),
          ],
          [
            `no args: spec=${noSpec.spec}, specFile=${noSpec.specFile}, stdin=${noSpec.stdin}`,
            `mode only: spec=${modeOnly.spec}, specFile=${modeOnly.specFile}`,
            `recovery mentions spec: true`,
          ],
        );
      },
    },
    {
      name: 'fixture-missing-file-recovery',
      description: 'Missing file value for --spec-file and --file flags produce actionable error messages.',
      specSection: 'CLI spec fixtures — missing file recovery',
      evaluate: () => {
        const missingSpecFile = parseArgs(['--spec-file']);
        const missingFile = parseArgs(['--file']);
        const missingSpec = parseArgs(['--spec']);
        const recoveryGuidance = renderRecoveryGuidance();

        return result(
          'fixture-missing-file-recovery',
          [
            missingSpecFile.errors !== undefined,
            missingSpecFile.errors?.[0]?.includes('--spec-file requires a value') === true,
            missingFile.errors !== undefined,
            missingFile.errors?.[0]?.includes('--file requires a value') === true,
            missingSpec.errors !== undefined,
            missingSpec.errors?.[0]?.includes('--spec requires a value') === true,
            recoveryGuidance.includes('Recovery:'),
            recoveryGuidance.includes('Continue locally'),
          ],
          [
            `--spec-file error: ${JSON.stringify(missingSpecFile.errors)}`,
            `--file error: ${JSON.stringify(missingFile.errors)}`,
            `--spec error: ${JSON.stringify(missingSpec.errors)}`,
            compactEvidence('generic recovery', recoveryGuidance),
          ],
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
