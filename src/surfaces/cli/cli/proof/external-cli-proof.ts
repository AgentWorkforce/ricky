import { constants } from 'node:fs';
import { access, chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export interface ExternalCliProofCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ExternalCliProofRunner {
  run(
    command: string,
    args: string[],
    options: { cwd: string; env?: NodeJS.ProcessEnv },
  ): Promise<ExternalCliProofCommandResult>;
}

export interface ExternalCliProofResult {
  repoDir: string;
  linkedCliPath: string;
  artifactPath: string;
  artifactFullPath: string;
  nextCommand: string;
  nextCommandOutput: string;
  cliOutput: string;
}

export interface ExternalCliProofOptions {
  repoRoot?: string;
  spec?: string;
  tempRepoPrefix?: string;
  runner?: ExternalCliProofRunner;
}

const DEFAULT_SPEC = 'generate a workflow for external CLI proof';
const DEFAULT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');

const DEFAULT_RUNNER: ExternalCliProofRunner = {
  run(command, args, options) {
    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: { ...process.env, ...(options.env ?? {}) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr?.on('data', (chunk) => {
        stderr += chunk;
      });
      child.once('error', rejectPromise);
      child.once('exit', (code, signal) => {
        if (code === null) {
          rejectPromise(new Error(`command exited from signal ${signal ?? 'unknown'}`));
          return;
        }

        resolvePromise({ exitCode: code, stdout, stderr });
      });
    });
  },
};

export async function runExternalCliProof(
  options: ExternalCliProofOptions = {},
): Promise<ExternalCliProofResult> {
  const repoRoot = resolve(options.repoRoot ?? DEFAULT_REPO_ROOT);
  const spec = options.spec ?? DEFAULT_SPEC;
  const runner = options.runner ?? DEFAULT_RUNNER;
  const repoDir = await mkdtemp(join(tmpdir(), options.tempRepoPrefix ?? 'ricky-external-cli-proof-'));

  try {
    await writeExternalRepoPackageJson(repoDir);

    const linkedCliPath = await linkRickyCliIntoExternalRepo(repoRoot, repoDir);
    await installAgentRelayFixture(repoDir);

    const cliInvocation = await runner.run(linkedCliPath, ['--mode', 'local', '--spec', spec, '--no-workforce-persona'], {
      cwd: repoDir,
      env: { INIT_CWD: repoDir },
    });

    if (cliInvocation.exitCode !== 0) {
      throw new Error(
        `Linked Ricky CLI failed from external repo.\nstdout:\n${cliInvocation.stdout}\nstderr:\n${cliInvocation.stderr}`,
      );
    }

    const cliOutput = normalizeOutput(cliInvocation.stdout);
    const artifactPath = parseArtifactPath(cliOutput);
    const nextCommandText = parseOptionalLabeledValue(cliOutput, 'To execute this artifact')
      ?? parseLabeledValue(cliOutput, 'Run');
    const nextCommand = nextCommandText.trim();

    if (isAbsolute(artifactPath) || !artifactPath.startsWith('workflows/generated/')) {
      throw new Error(
        `Printed artifact path must be relative to the external repo under workflows/generated/.\nartifact=${artifactPath}`,
      );
    }

    const artifactFullPath = join(repoDir, artifactPath);

    await access(artifactFullPath, constants.F_OK);

    if (!nextCommand.includes(artifactPath)) {
      throw new Error(
        `Printed next command does not reference the generated artifact path.\nartifact=${artifactPath}\nnext=${nextCommand}`,
      );
    }

    await writeFile(artifactFullPath, deterministicSdkSmokeWorkflow(), 'utf8');

    const nextInvocation = await runner.run('sh', ['-lc', nextCommand], {
      cwd: repoDir,
      env: { INIT_CWD: repoDir, PATH: `${join(repoDir, 'node_modules/.bin')}:${process.env.PATH ?? ''}` },
    });

    if (nextInvocation.exitCode !== 0) {
      throw new Error(
        `Printed next command failed against the external repo fixture.\ncommand=${nextCommand}\nstdout:\n${nextInvocation.stdout}\nstderr:\n${nextInvocation.stderr}`,
      );
    }

    return {
      repoDir,
      linkedCliPath,
      artifactPath,
      artifactFullPath,
      nextCommand,
      nextCommandOutput: normalizeOutput(nextInvocation.stdout),
      cliOutput,
    };
  } catch (error) {
    await rm(repoDir, { recursive: true, force: true });
    throw error;
  }
}

function deterministicSdkSmokeWorkflow(): string {
  return `import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-external-cli-proof-smoke')
    .description('Prove Ricky can execute an artifact through the Relay SDK from an external repo.')
    .pattern('dag')
    .step('sdk-smoke', {
      type: 'deterministic',
      command: "mkdir -p .workflow-artifacts/external-cli-proof && printf '%s\\\\n' SDK_RUN_OK > .workflow-artifacts/external-cli-proof/sdk-run.txt && cat .workflow-artifacts/external-cli-proof/sdk-run.txt",
      captureOutput: true,
      failOnError: true,
    })
    .run({ cwd: process.cwd() });

  console.log(result.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
}

async function writeExternalRepoPackageJson(repoDir: string): Promise<void> {
  await writeFile(
    join(repoDir, 'package.json'),
    JSON.stringify(
      {
        name: 'ricky-external-cli-proof-fixture',
        private: true,
        version: '0.0.0',
      },
      null,
      2,
    ),
    'utf8',
  );
}

async function linkRickyCliIntoExternalRepo(repoRoot: string, repoDir: string): Promise<string> {
  const cliPackagePath = join(repoRoot, 'package.json');
  const cliPackage = JSON.parse(await readFile(cliPackagePath, 'utf8')) as { bin?: Record<string, string> };
  const binRelativePath = cliPackage.bin?.ricky;

  if (!binRelativePath) {
    throw new Error(`Root package.json is missing bin.ricky in ${cliPackagePath}`);
  }

  const targetPath = resolve(repoRoot, binRelativePath);
  await ensureLinkedCliTargetExists(repoRoot, targetPath);
  await chmod(targetPath, 0o755);

  const linkedBinPath = join(repoDir, 'node_modules/.bin/ricky');
  await mkdir(dirname(linkedBinPath), { recursive: true });
  await symlink(targetPath, linkedBinPath);
  return linkedBinPath;
}

async function ensureLinkedCliTargetExists(repoRoot: string, targetPath: string): Promise<void> {
  const bundleResult = await DEFAULT_RUNNER.run('npm', ['run', 'bundle'], { cwd: repoRoot });
  if (bundleResult.exitCode !== 0) {
    throw new Error(
      `Failed to prepare linked Ricky CLI bundle at ${targetPath}.\nstdout:\n${bundleResult.stdout}\nstderr:\n${bundleResult.stderr}`,
    );
  }

  try {
    await access(targetPath, constants.F_OK);
  } catch {
    throw new Error(`Bundled Ricky CLI target was not written: ${targetPath}`);
  }
}

async function installAgentRelayFixture(repoDir: string): Promise<void> {
  await mkdir(join(repoDir, 'node_modules/.bin'), { recursive: true });
}

function normalizeOutput(output: string): string {
  return output.replace(/\r\n/g, '\n').trim();
}

function parseLabeledValue(output: string, label: string): string {
  const value = parseOptionalLabeledValue(output, label);
  if (!value) {
    throw new Error(`Could not find "${label}:" in CLI output.\n${output}`);
  }
  return value;
}

function parseOptionalLabeledValue(output: string, label: string): string | undefined {
  const pattern = new RegExp(`^\\s*${escapeRegExp(label)}:\\s+(.+)$`, 'm');
  const match = output.match(pattern);
  return match?.[1]?.trim();
}

function parseArtifactPath(output: string): string {
  const labeled = parseOptionalLabeledValue(output, 'Artifact');
  if (labeled) return labeled;
  const compactGeneration = output.match(/^Generation:\s+ok\s+[—-]\s+(.+)$/m);
  if (compactGeneration?.[1]) return compactGeneration[1].trim();
  throw new Error(`Could not find generated artifact path in CLI output.\n${output}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
