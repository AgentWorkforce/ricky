/**
 * Request normalizer for the Ricky local/BYOH entrypoint.
 *
 * Accepts spec handoff from CLI, MCP, Claude-style structured handoff,
 * or workflow artifact path and normalizes into one local invocation
 * request contract.
 */

// ---------------------------------------------------------------------------
// Source types — the intake surfaces that can hand off to Ricky locally
// ---------------------------------------------------------------------------

export type HandoffSource = 'free-form' | 'structured' | 'cli' | 'mcp' | 'claude' | 'workflow-artifact';
export type LocalExecutionMode = 'local' | 'cloud' | 'both';
export type LocalExecutionPreference = LocalExecutionMode;
export type StructuredSpec = Record<string, unknown>;
export type SpecInput = string | StructuredSpec;

export interface LocalSourceMetadata {
  cli?: Record<string, unknown>;
  mcp?: Record<string, unknown>;
  claude?: Record<string, unknown>;
}

export interface BaseHandoff {
  /** Preferred execution target. `mode` is kept as the stable shorthand. */
  mode?: LocalExecutionMode;
  /**
   * Alias for `mode`. When both are set, `mode` takes priority (see `executionModeFor`).
   * Exists so callers that model the choice as a "preference" rather than a "mode"
   * can pass it naturally without mapping to the `mode` field.
   */
  executionPreference?: LocalExecutionPreference;
  metadata?: Record<string, unknown>;
  requestId?: string;
}

/** Free-form spec string from a direct local caller. */
export interface FreeFormSpecHandoff extends BaseHandoff {
  source: 'free-form';
  spec: string;
}

/** Structured spec object from a direct local caller. */
export interface StructuredSpecHandoff extends BaseHandoff {
  source: 'structured';
  spec: StructuredSpec;
}

/** Free-form spec string passed via CLI (--spec flag or stdin). */
export interface CliHandoff extends BaseHandoff {
  source: 'cli';
  spec: SpecInput;
  specFile?: string;
  cliMetadata?: Record<string, unknown>;
}

/** Structured MCP tool invocation payload (ricky.generate). */
export interface McpHandoff extends BaseHandoff {
  source: 'mcp';
  spec?: SpecInput;
  toolName?: string;
  arguments?: Record<string, unknown>;
  mcpMetadata?: Record<string, unknown>;
}

/** Claude-style structured handoff with optional conversation context. */
export interface ClaudeHandoff extends BaseHandoff {
  source: 'claude';
  spec: SpecInput;
  conversationId?: string;
  turnId?: string;
}

/** Reference to an existing workflow artifact on disk. */
export interface WorkflowArtifactHandoff extends BaseHandoff {
  source: 'workflow-artifact';
  artifactPath: string;
}

export type RawHandoff =
  | FreeFormSpecHandoff
  | StructuredSpecHandoff
  | CliHandoff
  | McpHandoff
  | ClaudeHandoff
  | WorkflowArtifactHandoff;

// ---------------------------------------------------------------------------
// Normalized local invocation request — the single contract downstream uses
// ---------------------------------------------------------------------------

export interface LocalInvocationRequest {
  /**
   * Discriminator field that distinguishes a normalized request from a raw
   * handoff at runtime. Raw handoffs never carry this field, so
   * `isLocalInvocationRequest()` can rely on it instead of heuristic
   * structural checks that overlap with raw handoff shapes.
   */
  _normalized: true;
  /** The spec content (inline or resolved from artifact path). */
  spec: string;
  /** Structured spec payload when the source supplied one. */
  structuredSpec?: StructuredSpec;
  /** Where the handoff originated. */
  source: HandoffSource;
  /** Execution mode — defaults to 'local' for BYOH. */
  mode: LocalExecutionMode;
  /**
   * Always equals `mode`. Exposed as a convenience alias for callers that model
   * the choice as an execution preference rather than a mode. Intentionally
   * duplicated — both fields are set identically across all normalization branches
   * so downstream code can use whichever name reads more naturally.
   */
  executionPreference?: LocalExecutionPreference;
  /** Optional file path when the spec came from a file or artifact. */
  specPath?: string;
  /** Opaque metadata from the originating surface. */
  metadata: Record<string, unknown>;
  /** Surface-specific metadata preserved without flattening. */
  sourceMetadata?: LocalSourceMetadata;
  /** Stable request id when the caller supplied one. */
  requestId?: string;
}

// ---------------------------------------------------------------------------
// Normalizer
// ---------------------------------------------------------------------------

export interface ArtifactReader {
  readArtifact(path: string): Promise<string>;
}

const defaultArtifactReader: ArtifactReader = {
  async readArtifact(path: string): Promise<string> {
    const { readFile } = await import('node:fs/promises');
    return readFile(path, 'utf8');
  },
};

/**
 * Normalize any supported handoff shape into a single LocalInvocationRequest.
 *
 * - CLI and MCP handoffs carry the spec inline.
 * - Claude handoffs carry the spec inline with optional conversation context.
 * - Workflow artifact handoffs resolve the spec from disk via the injected reader.
 * - Mode defaults to 'local' — Cloud is never a hidden fallback.
 */
export async function normalizeRequest(
  raw: RawHandoff,
  reader: ArtifactReader = defaultArtifactReader,
): Promise<LocalInvocationRequest> {
  switch (raw.source) {
    case 'free-form': {
      const mode = executionModeFor(raw, raw.spec);
      return {
        _normalized: true,
        spec: raw.spec,
        source: 'free-form',
        mode,
        executionPreference: mode,
        metadata: raw.metadata ?? {},
        requestId: raw.requestId,
      };
    }

    case 'structured': {
      const mode = executionModeFor(raw, raw.spec);
      return {
        _normalized: true,
        spec: specInputToText(raw.spec),
        structuredSpec: raw.spec,
        source: 'structured',
        mode,
        executionPreference: mode,
        metadata: raw.metadata ?? {},
        requestId: raw.requestId,
      };
    }

    case 'cli': {
      const mode = executionModeFor(raw, raw.spec);
      const structuredSpec = structuredSpecFrom(raw.spec);
      return {
        _normalized: true,
        spec: specInputToText(raw.spec),
        structuredSpec,
        source: 'cli',
        mode,
        executionPreference: mode,
        specPath: raw.specFile,
        metadata: {
          ...(raw.metadata ?? {}),
          ...(raw.cliMetadata ?? {}),
        },
        sourceMetadata: sourceMetadataForCli(raw),
        requestId: raw.requestId,
      };
    }

    case 'mcp': {
      const spec = raw.spec ?? raw.arguments ?? {};
      const mode = executionModeFor(raw, spec);
      const structuredSpec = structuredSpecFrom(spec);
      return {
        _normalized: true,
        spec: specInputToText(spec),
        structuredSpec,
        source: 'mcp',
        mode,
        executionPreference: mode,
        metadata: {
          ...(raw.metadata ?? {}),
          ...(raw.mcpMetadata ?? {}),
          ...(raw.toolName ? { toolName: raw.toolName } : {}),
        },
        sourceMetadata: sourceMetadataForMcp(raw),
        requestId: raw.requestId,
      };
    }

    case 'claude': {
      const mode = executionModeFor(raw, raw.spec);
      const metadata: Record<string, unknown> = { ...(raw.metadata ?? {}) };
      if (raw.conversationId) metadata.conversationId = raw.conversationId;
      if (raw.turnId) metadata.turnId = raw.turnId;
      const structuredSpec = structuredSpecFrom(raw.spec);
      return {
        _normalized: true,
        spec: specInputToText(raw.spec),
        structuredSpec,
        source: 'claude',
        mode,
        executionPreference: mode,
        metadata,
        sourceMetadata: sourceMetadataForClaude(raw),
        requestId: raw.requestId,
      };
    }

    case 'workflow-artifact': {
      const mode = executionModeFor(raw);
      const spec = await reader.readArtifact(raw.artifactPath);
      return {
        _normalized: true,
        spec,
        source: 'workflow-artifact',
        mode,
        executionPreference: mode,
        specPath: raw.artifactPath,
        metadata: raw.metadata ?? {},
        requestId: raw.requestId,
      };
    }
  }
}

function executionModeFor(raw: BaseHandoff, spec?: SpecInput): LocalExecutionMode {
  return raw.mode ?? raw.executionPreference ?? executionModeFromStructuredSpec(spec) ?? 'local';
}

function executionModeFromStructuredSpec(spec?: SpecInput): LocalExecutionMode | undefined {
  if (!spec || typeof spec === 'string') return undefined;

  const value = spec.mode ?? spec.executionPreference ?? spec.execution_mode ?? spec.execution_preference;
  if (value === 'local' || value === 'cloud' || value === 'both') return value;
  if (value === 'auto') return 'both';
  return undefined;
}

function structuredSpecFrom(spec: SpecInput): StructuredSpec | undefined {
  return typeof spec === 'string' ? undefined : spec;
}

function sourceMetadataForCli(raw: CliHandoff): LocalSourceMetadata | undefined {
  if (!raw.cliMetadata && !raw.specFile) return undefined;
  return {
    cli: {
      ...(raw.cliMetadata ?? {}),
      ...(raw.specFile ? { specFile: raw.specFile } : {}),
    },
  };
}

function sourceMetadataForMcp(raw: McpHandoff): LocalSourceMetadata | undefined {
  if (!raw.mcpMetadata && !raw.toolName) return undefined;
  return {
    mcp: {
      ...(raw.mcpMetadata ?? {}),
      ...(raw.toolName ? { toolName: raw.toolName } : {}),
    },
  };
}

function sourceMetadataForClaude(raw: ClaudeHandoff): LocalSourceMetadata | undefined {
  if (!raw.conversationId && !raw.turnId) return undefined;
  return {
    claude: {
      ...(raw.conversationId ? { conversationId: raw.conversationId } : {}),
      ...(raw.turnId ? { turnId: raw.turnId } : {}),
    },
  };
}

/**
 * Extract a text representation from a structured spec.
 *
 * Key probe order is intentional: `description` and `prompt` are the most
 * common carrier fields across CLI, MCP, and Claude handoffs; `goal` and
 * `objective` are less frequent. The JSON.stringify fallback guarantees no
 * structured spec is silently lost regardless of key naming.
 */
function specInputToText(spec: SpecInput): string {
  if (typeof spec === 'string') return spec;

  const directText = readString(spec, [
    'description',
    'prompt',
    'spec',
    'text',
    'request',
    'summary',
    'goal',
    'objective',
  ]);
  return directText ?? JSON.stringify(spec, null, 2);
}

function readString(record: StructuredSpec, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}
