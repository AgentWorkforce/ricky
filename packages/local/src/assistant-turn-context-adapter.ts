/**
 * Ricky request-to-turn-context adapter.
 *
 * This is intentionally bounded: Ricky keeps local request normalization,
 * workflow generation, execution, blockers, evidence, and LocalResponse.
 * The shared package owns the neutral assistant turn envelope assembly.
 */

import { createHash } from 'node:crypto';

import {
  createTurnContextAssembler,
  type TurnContextAssembler,
  type TurnContextAssembly,
  type TurnContextInput,
  type TurnEnrichmentCandidate,
} from '@agent-assistant/turn-context';

import type { LocalInvocationRequest } from './request-normalizer';

const RICKY_ASSISTANT_ID = 'ricky';
const RICKY_ADAPTER_NAME = 'ricky-local-turn-context-adapter';

export interface AssembleRickyTurnContextOptions {
  assembler?: TurnContextAssembler;
}

export function toRickyTurnContextInput(request: LocalInvocationRequest): TurnContextInput {
  const turnId = request.requestId ?? fallbackTurnId(request);
  const rickyRequestMetadata = {
    requestId: request.requestId,
    source: request.source,
    sourceMetadata: request.sourceMetadata,
    structuredSpec: request.structuredSpec,
    invocationRoot: request.invocationRoot,
    mode: request.mode,
    stageMode: request.stageMode,
    specPath: request.specPath,
    metadata: request.metadata,
  };

  return {
    assistantId: RICKY_ASSISTANT_ID,
    turnId,
    identity: {
      assistantName: 'Ricky',
      baseInstructions: {
        systemPrompt:
          'Ricky is a local-first workflow reliability assistant for generating, running, and proving Agent Relay workflows.',
        developerPrompt:
          'Preserve Ricky-owned workflow generation, local execution, blocker taxonomy, evidence, and LocalResponse behavior. Use this shared turn context only as the request/turn envelope.',
      },
    },
    shaping: {
      mode: `ricky-local:${request.mode}:${request.stageMode ?? 'default-stage'}`,
      instructionOverlays: [
        {
          id: 'ricky-local-boundary',
          source: 'ricky-local',
          text:
            'This turn is assembled from Ricky LocalInvocationRequest data. Product execution semantics remain owned by Ricky local runtime code.',
          priority: 'high',
        },
      ],
      responseStyle: {
        preferMarkdown: true,
      },
    },
    enrichment: {
      candidates: enrichmentCandidatesFor(request),
    },
    metadata: {
      adapter: {
        name: RICKY_ADAPTER_NAME,
        package: '@agent-assistant/turn-context',
        version: 1,
      },
      ricky: rickyRequestMetadata,
    },
  };
}

export async function assembleRickyTurnContext(
  request: LocalInvocationRequest,
  options: AssembleRickyTurnContextOptions = {},
): Promise<TurnContextAssembly> {
  const assembler = options.assembler ?? createTurnContextAssembler();
  return assembler.assemble(toRickyTurnContextInput(request));
}

function enrichmentCandidatesFor(request: LocalInvocationRequest): TurnEnrichmentCandidate[] {
  const candidates: TurnEnrichmentCandidate[] = [
    {
      id: 'ricky-request-summary',
      kind: 'handoff',
      source: 'ricky-local',
      title: 'Ricky normalized request',
      content: [
        `source: ${request.source}`,
        `requestId: ${request.requestId ?? '(not supplied)'}`,
        `mode: ${request.mode}`,
        `stageMode: ${request.stageMode ?? '(default)'}`,
        `invocationRoot: ${request.invocationRoot ?? '(not supplied)'}`,
        `specPath: ${request.specPath ?? '(not supplied)'}`,
      ].join('\n'),
      importance: 'high',
      confidence: 1,
      freshness: 'current',
      audience: 'mixed',
      metadata: {
        source: request.source,
        requestId: request.requestId,
        mode: request.mode,
        stageMode: request.stageMode,
        invocationRoot: request.invocationRoot,
        specPath: request.specPath,
      },
    },
    {
      id: 'ricky-spec-text',
      kind: 'handoff',
      source: 'ricky-local',
      title: 'Ricky request spec text',
      content: request.spec,
      importance: 'high',
      confidence: 1,
      freshness: 'current',
      audience: 'mixed',
    },
  ];

  if (request.structuredSpec) {
    candidates.push({
      id: 'ricky-structured-spec',
      kind: 'handoff',
      source: 'ricky-local',
      title: 'Ricky structured spec',
      content: safeJson(request.structuredSpec),
      importance: 'high',
      confidence: 1,
      freshness: 'current',
      audience: 'mixed',
    });
  }

  if (request.sourceMetadata) {
    candidates.push({
      id: 'ricky-source-metadata',
      kind: 'handoff',
      source: 'ricky-local',
      title: 'Ricky source metadata',
      content: safeJson(request.sourceMetadata),
      importance: 'medium',
      confidence: 1,
      freshness: 'current',
      audience: 'mixed',
    });
  }

  candidates.push({
    id: 'ricky-request-metadata',
    kind: 'handoff',
    source: 'ricky-local',
    title: 'Ricky request metadata',
    content: safeJson(request.metadata),
    importance: 'medium',
    confidence: 1,
    freshness: 'current',
    audience: 'mixed',
  });

  return candidates;
}

function fallbackTurnId(request: LocalInvocationRequest): string {
  return `ricky-local-${createHash('sha256')
    .update(
      safeJson({
        source: request.source,
        mode: request.mode,
        stageMode: request.stageMode,
        invocationRoot: request.invocationRoot,
        specPath: request.specPath,
        spec: request.spec,
      }),
    )
    .digest('hex')
    .slice(0, 16)}`;
}

function safeJson(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(
    value,
    (_key, item) => {
      if (typeof item === 'bigint') return item.toString();
      if (typeof item === 'object' && item !== null) {
        if (seen.has(item)) return '[Circular]';
        seen.add(item);
      }
      return item;
    },
    2,
  ) ?? 'null';
}
