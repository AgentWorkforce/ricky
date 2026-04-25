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

export type HandoffSource = 'cli' | 'mcp' | 'claude' | 'workflow-artifact';

/** Free-form spec string passed via CLI (--spec flag or stdin). */
export interface CliHandoff {
  source: 'cli';
  spec: string;
  specFile?: string;
  mode?: 'local' | 'cloud' | 'both';
}

/** Structured MCP tool invocation payload (ricky.generate). */
export interface McpHandoff {
  source: 'mcp';
  spec: string;
  mode?: 'local' | 'cloud' | 'both';
  mcpMetadata?: Record<string, unknown>;
}

/** Claude-style structured handoff with optional conversation context. */
export interface ClaudeHandoff {
  source: 'claude';
  spec: string;
  conversationId?: string;
  turnId?: string;
  mode?: 'local' | 'cloud' | 'both';
}

/** Reference to an existing workflow artifact on disk. */
export interface WorkflowArtifactHandoff {
  source: 'workflow-artifact';
  artifactPath: string;
  mode?: 'local' | 'cloud' | 'both';
}

export type RawHandoff = CliHandoff | McpHandoff | ClaudeHandoff | WorkflowArtifactHandoff;

// ---------------------------------------------------------------------------
// Normalized local invocation request — the single contract downstream uses
// ---------------------------------------------------------------------------

export interface LocalInvocationRequest {
  /** The spec content (inline or resolved from artifact path). */
  spec: string;
  /** Where the handoff originated. */
  source: HandoffSource;
  /** Execution mode — defaults to 'local' for BYOH. */
  mode: 'local' | 'cloud' | 'both';
  /** Optional file path when the spec came from a file or artifact. */
  specPath?: string;
  /** Opaque metadata from the originating surface. */
  metadata: Record<string, unknown>;
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
    case 'cli': {
      return {
        spec: raw.spec,
        source: 'cli',
        mode: raw.mode ?? 'local',
        specPath: raw.specFile,
        metadata: {},
      };
    }

    case 'mcp': {
      return {
        spec: raw.spec,
        source: 'mcp',
        mode: raw.mode ?? 'local',
        metadata: raw.mcpMetadata ?? {},
      };
    }

    case 'claude': {
      const metadata: Record<string, unknown> = {};
      if (raw.conversationId) metadata.conversationId = raw.conversationId;
      if (raw.turnId) metadata.turnId = raw.turnId;
      return {
        spec: raw.spec,
        source: 'claude',
        mode: raw.mode ?? 'local',
        metadata,
      };
    }

    case 'workflow-artifact': {
      const spec = await reader.readArtifact(raw.artifactPath);
      return {
        spec,
        source: 'workflow-artifact',
        mode: raw.mode ?? 'local',
        specPath: raw.artifactPath,
        metadata: {},
      };
    }
  }
}
