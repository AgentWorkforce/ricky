/**
 * Public Ricky SDK.
 *
 * This module is the package root export. It exposes programmatic entrypoints
 * for local/BYOH generation and execution, Cloud generation, scheduling, and
 * the CLI command runner used by the published `ricky` bin.
 */

import { handleCloudGenerate as defaultHandleCloudGenerate } from '../cloud/api/generate-endpoint.js';
import type {
  CloudGenerateEndpointOptions,
  CloudGenerateResponse,
  CloudGenerateRequest,
  ListRickyWorkflowSchedulesResult,
  ScheduleRickyWorkflowOptions,
  ScheduleRickyWorkflowResult,
} from '../cloud/api/index.js';
import {
  listRickyWorkflowSchedules as defaultListRickyWorkflowSchedules,
  scheduleRickyWorkflow as defaultScheduleRickyWorkflow,
} from '../cloud/api/index.js';
import { runLocal as defaultRunLocal } from '../local/entrypoint.js';
import type {
  LocalEntrypointOptions,
  LocalResponse,
  RawHandoff,
} from '../local/index.js';
import { cliMain as defaultCliMain } from '../surfaces/cli/commands/cli-main.js';
import type {
  CliMainDeps,
  CliMainResult,
} from '../surfaces/cli/commands/cli-main.js';
import { defaultArtifactPathForWorkflowName } from '../surfaces/cli/flows/spec-intake-flow.js';

export type RickyRunLocal = (
  handoff: RawHandoff,
  options?: LocalEntrypointOptions,
) => Promise<LocalResponse>;

export type RickyHandleCloudGenerate = (
  request: CloudGenerateRequest,
  options?: CloudGenerateEndpointOptions,
) => Promise<CloudGenerateResponse>;

export type RickyRunCli = (deps?: CliMainDeps) => Promise<CliMainResult>;

export interface RickySdkOptions {
  /** Default caller root used when a method input does not provide `cwd`. */
  cwd?: string;
  /** Local entrypoint override for tests or custom runtime wiring. */
  runLocal?: RickyRunLocal;
  /** Cloud generate handler override for tests or custom server adapters. */
  handleCloudGenerate?: RickyHandleCloudGenerate;
  /** CLI command runner override for tests. */
  runCli?: RickyRunCli;
  /** Cloud workflow scheduler override for tests or custom Cloud adapters. */
  scheduleWorkflow?: (
    workflowPath: string,
    options?: ScheduleRickyWorkflowOptions,
  ) => Promise<ScheduleRickyWorkflowResult>;
  /** Cloud workflow schedule lister override for tests or custom Cloud adapters. */
  listWorkflowSchedules?: () => Promise<ListRickyWorkflowSchedulesResult>;
}

export interface RickyGenerateLocalWorkflowInput {
  spec: string;
  cwd?: string;
  workflowName?: string;
  run?: boolean;
  bestJudgement?: boolean;
  refine?: false | { model?: string };
  autoFixAttempts?: number;
  localOptions?: LocalEntrypointOptions;
}

export interface RickyRunLocalWorkflowInput {
  workflowPath: string;
  cwd?: string;
  autoFixAttempts?: number;
  startFromStep?: string;
  previousRunId?: string;
  localOptions?: LocalEntrypointOptions;
}

export interface RickySdk {
  generateLocalWorkflow(input: RickyGenerateLocalWorkflowInput): Promise<LocalResponse>;
  runLocalWorkflow(input: RickyRunLocalWorkflowInput): Promise<LocalResponse>;
  generateCloudWorkflow(
    request: CloudGenerateRequest,
    options?: CloudGenerateEndpointOptions,
  ): Promise<CloudGenerateResponse>;
  scheduleWorkflow(
    workflowPath: string,
    options?: ScheduleRickyWorkflowOptions,
  ): Promise<ScheduleRickyWorkflowResult>;
  listWorkflowSchedules(): Promise<ListRickyWorkflowSchedulesResult>;
  runCli(deps?: CliMainDeps): Promise<CliMainResult>;
}

export function createRickySdk(options: RickySdkOptions = {}): RickySdk {
  const runLocal = options.runLocal ?? defaultRunLocal;
  const handleCloudGenerate = options.handleCloudGenerate ?? defaultHandleCloudGenerate;
  const runCli = options.runCli ?? defaultCliMain;
  const scheduleWorkflow = options.scheduleWorkflow ?? defaultScheduleRickyWorkflow;
  const listWorkflowSchedules = options.listWorkflowSchedules ?? defaultListRickyWorkflowSchedules;

  return {
    generateLocalWorkflow(input): Promise<LocalResponse> {
      return runLocal(localGenerateHandoff(input, options.cwd), input.localOptions ?? {});
    },

    runLocalWorkflow(input): Promise<LocalResponse> {
      return runLocal(localArtifactRunHandoff(input, options.cwd), input.localOptions ?? {});
    },

    generateCloudWorkflow(request, cloudOptions = {}): Promise<CloudGenerateResponse> {
      return handleCloudGenerate(request, cloudOptions);
    },

    scheduleWorkflow(workflowPath, scheduleOptions = {}): Promise<ScheduleRickyWorkflowResult> {
      return scheduleWorkflow(workflowPath, scheduleOptions);
    },

    listWorkflowSchedules(): Promise<ListRickyWorkflowSchedulesResult> {
      return listWorkflowSchedules();
    },

    runCli(deps = {}): Promise<CliMainResult> {
      return runCli(deps);
    },
  };
}

export function runRickyCli(deps: CliMainDeps & { runCli?: RickyRunCli } = {}): Promise<CliMainResult> {
  const { runCli, ...cliDeps } = deps;
  return createRickySdk({ runCli }).runCli(cliDeps);
}

function localGenerateHandoff(input: RickyGenerateLocalWorkflowInput, defaultCwd: string | undefined): RawHandoff {
  const invocationRoot = input.cwd ?? defaultCwd ?? process.cwd();
  const hasWorkflowName = typeof input.workflowName === 'string' && input.workflowName.trim().length > 0;
  const workflowName = hasWorkflowName ? input.workflowName!.trim() : undefined;
  const handoff: RawHandoff = {
    source: 'cli',
    spec: workflowName
      ? {
          intent: 'generate',
          description: input.spec,
          workflowName,
          name: workflowName,
          artifactPath: defaultArtifactPathForWorkflowName(workflowName),
        }
      : input.spec,
    invocationRoot,
    mode: 'local',
    stageMode: input.run ? 'run' : 'generate',
    ...(input.run && input.autoFixAttempts && input.autoFixAttempts > 0
      ? { autoFix: { maxAttempts: input.autoFixAttempts } }
      : {}),
    ...(input.refine ? { refine: input.refine } : {}),
    ...(input.bestJudgement ? { bestJudgement: true } : {}),
    cliMetadata: {
      handoff: 'sdk',
      ...(workflowName ? { workflowName } : {}),
      ...(input.bestJudgement ? { bestJudgement: true } : {}),
    },
  };
  return handoff;
}

function localArtifactRunHandoff(input: RickyRunLocalWorkflowInput, defaultCwd: string | undefined): RawHandoff {
  const retry = input.startFromStep || input.previousRunId
    ? {
        attempt: 1,
        reason: 'manual resume requested from Ricky SDK',
        ...(input.startFromStep ? { startFromStep: input.startFromStep } : {}),
        ...(input.previousRunId ? { previousRunId: input.previousRunId, retryOfRunId: input.previousRunId } : {}),
      }
    : undefined;

  return {
    source: 'workflow-artifact',
    artifactPath: input.workflowPath,
    invocationRoot: input.cwd ?? defaultCwd ?? process.cwd(),
    mode: 'local',
    stageMode: 'run',
    ...(input.autoFixAttempts && input.autoFixAttempts > 0
      ? { autoFix: { maxAttempts: input.autoFixAttempts } }
      : {}),
    ...(retry ? { retry } : {}),
    metadata: { handoff: 'sdk' },
  };
}

export type {
  CloudGenerateEndpointOptions,
  CloudGenerateRequest,
  CloudGenerateResponse,
  CliMainDeps,
  CliMainResult,
  LocalEntrypointOptions,
  LocalResponse,
  RawHandoff,
};

export * as cloud from '../cloud/index.js';
export * as local from '../local/index.js';
export * as runtime from '../runtime/index.js';
export * as product from '../product/index.js';
export * as shared from '../shared/index.js';
