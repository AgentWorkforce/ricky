// Public API for the Ricky local/BYOH entrypoint surface.

export { normalizeRequest } from './request-normalizer';
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
  SpecInput,
  StructuredSpec,
  StructuredSpecHandoff,
  WorkflowArtifactHandoff,
} from './request-normalizer';

export { createLocalExecutor, createProcessCommandRunner, DEFAULT_LOCAL_ROUTE, getDefaultExecutor, resetDefaultExecutor, runLocal } from './entrypoint';
export type {
  ArtifactWriter,
  CoordinatorLauncher,
  LocalEntrypointInput,
  LocalEntrypointOptions,
  LocalExecutor,
  LocalExecutorOptions,
  LocalResponse,
  LocalResponseArtifact,
} from './entrypoint';
