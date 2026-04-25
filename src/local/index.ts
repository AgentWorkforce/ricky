// Public API for the Ricky local/BYOH entrypoint surface.

export { normalizeRequest } from './request-normalizer';
export type {
  ArtifactReader,
  CliHandoff,
  ClaudeHandoff,
  HandoffSource,
  LocalInvocationRequest,
  McpHandoff,
  RawHandoff,
  WorkflowArtifactHandoff,
} from './request-normalizer';

export { defaultExecutor, runLocal } from './entrypoint';
export type {
  LocalEntrypointOptions,
  LocalExecutor,
  LocalResponse,
  LocalResponseArtifact,
} from './entrypoint';
