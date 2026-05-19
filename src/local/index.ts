// Public API for the Ricky local/BYOH entrypoint surface.

export { normalizeRequest } from './request-normalizer.js';
export type {
  ArtifactReader,
  CliHandoff,
  ClaudeHandoff,
  FreeFormSpecHandoff,
  HandoffSource,
  LocalExecutionMode,
  LocalExecutionPreference,
  LocalInvocationRequest,
  LocalStageMode,
  LocalSourceMetadata,
  McpHandoff,
  RawHandoff,
  BaseHandoff,
  SpecInput,
  StructuredSpec,
  StructuredSpecHandoff,
  WorkflowArtifactHandoff,
} from './request-normalizer.js';

export { assembleRickyTurnContext, toRickyTurnContextInput } from './assistant-turn-context-adapter.js';
export type { AssembleRickyTurnContextOptions } from './assistant-turn-context-adapter.js';
export { runWithAutoFix } from './auto-fix-loop.js';
export type { AutoFixAttemptSummary, RunWithAutoFixOptions } from './auto-fix-loop.js';
export { createLocalExecutor, createProcessCommandRunner, DEFAULT_LOCAL_ROUTE, getDefaultExecutor, resetDefaultExecutor, runLocal } from './entrypoint.js';
export type {
  ArtifactWriter,
  BestJudgementClarificationDecision,
  CoordinatorLauncher,
  LocalAssistantTurnContextDecision,
  LocalBlockerCategory,
  LocalBlockerCode,
  LocalClassifiedBlocker,
  LocalEntrypointInput,
  LocalEntrypointOptions,
  LocalExecutionEvidence,
  LocalExecutionStageResult,
  LocalExecutionStatus,
  LocalExecutor,
  LocalExecutorOptions,
  LocalGenerationStageResult,
  LocalGenerationStatus,
  LocalResponse,
  LocalResponseArtifact,
  ScriptWorkflowRunner,
  ScriptWorkflowRunnerOptions,
} from './entrypoint.js';
