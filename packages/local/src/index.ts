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
export { createLocalExecutor, createProcessCommandRunner, DEFAULT_LOCAL_ROUTE, getDefaultExecutor, resetDefaultExecutor, runLocal } from './entrypoint.js';
export type {
  ArtifactWriter,
  CoordinatorLauncher,
  LocalEntrypointInput,
  LocalEntrypointOptions,
  LocalExecutor,
  LocalExecutorOptions,
  LocalResponse,
  LocalResponseArtifact,
} from './entrypoint.js';
