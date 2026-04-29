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

    const cliInvocation = await runner.run(linkedCliPath, ['--mode', 'local', '--spec', spec], {
      cwd: repoDir,
      env: { INIT_CWD: repoDir },
    });

    if (cliInvocation.exitCode !== 0) {
      throw new Error(
        `Linked Ricky CLI failed from external repo.\nstdout:\n${cliInvocation.stdout}\nstderr:\n${cliInvocation.stderr}`,
      );
    }

    const cliOutput = normalizeOutput(cliInvocation.stdout);
    const artifactPath = parseLabeledValue(cliOutput, 'Artifact');
    const nextCommandText = parseLabeledValue(cliOutput, 'To execute this artifact');
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

    const nextInvocation = await runner.run('sh', ['-lc', nextCommand], {
      cwd: repoDir,
      env: { INIT_CWD: repoDir },
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
  try {
    await access(targetPath, constants.F_OK);
    return;
  } catch {
    const bundleResult = await DEFAULT_RUNNER.run('npm', ['run', 'bundle'], { cwd: repoRoot });
    if (bundleResult.exitCode !== 0) {
      throw new Error(
        `Failed to prepare linked Ricky CLI bundle at ${targetPath}.\nstdout:\n${bundleResult.stdout}\nstderr:\n${bundleResult.stderr}`,
      );
    }
    await access(targetPath, constants.F_OK);
  }
}

async function installAgentRelayFixture(repoDir: string): Promise<void> {
  const fixturePath = join(repoDir, 'node_modules/.bin/agent-relay');
  const fixtureScript = [
    '#!/usr/bin/env node',
    "import { access } from 'node:fs/promises';",
    "import { constants } from 'node:fs';",
    '',
    'const [, , command, workflowPath] = process.argv;',
    "if (command !== 'run' || !workflowPath) {",
    "  console.error('[fixture-agent-relay] expected usage: agent-relay run <workflow-path>');",
    '  process.exit(1);',
    '}',
    '',
    'try {',
    '  await access(workflowPath, constants.F_OK);',
    "  console.log(`[fixture-agent-relay] ran ${workflowPath}`);",
    '} catch (error) {',
    "  const message = error instanceof Error ? error.message : String(error);",
    "  console.error(`[fixture-agent-relay] missing workflow ${workflowPath}: ${message}`);",
    '  process.exit(1);',
    '}',
  ].join('\n');

  await mkdir(dirname(fixturePath), { recursive: true });
  await writeFile(fixturePath, fixtureScript, 'utf8');
  await chmod(fixturePath, 0o755);
}

function normalizeOutput(output: string): string {
  return output.replace(/\r\n/g, '\n').trim();
}

function parseLabeledValue(output: string, label: string): string {
  const pattern = new RegExp(`^\\s*${escapeRegExp(label)}:\\s+(.+)$`, 'm');
  const match = output.match(pattern);
  if (!match) {
    throw new Error(`Could not find "${label}:" in CLI output.\n${output}`);
  }
  return match[1].trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
