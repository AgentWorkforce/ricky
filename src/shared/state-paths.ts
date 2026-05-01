import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function rickyStateHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.RICKY_STATE_HOME || env.XDG_STATE_HOME || join(homedir(), '.local', 'state');
}

export function repoStateKey(cwd: string): string {
  return createHash('sha256').update(resolve(cwd)).digest('hex').slice(0, 12);
}

export function localRunStateRoot(cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(rickyStateHome(env), 'ricky', 'local-runs', repoStateKey(cwd));
}

export function localRunStatePath(cwd: string, runId: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(localRunStateRoot(cwd, env), runId, 'state.json');
}

export function localRunArtifactDir(cwd: string, runId: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(localRunStateRoot(cwd, env), runId);
}

export function legacyLocalRunStatePath(cwd: string, runId: string): string {
  return resolve(cwd, '.workflow-artifacts', 'ricky-local-runs', runId, 'state.json');
}
