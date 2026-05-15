/**
 * Build-time-bundled Ricky-local persona specs.
 *
 * Each persona JSON under `personas/` is imported statically here so esbuild
 * inlines them into `dist/ricky.js`. This makes `npm install -g
 * @agentworkforce/ricky` self-contained: the resolver finds personas via the
 * bundle even when the published tarball's `files` array omits `personas/`
 * (the bug that shipped between v0.1.38 and v0.1.51) and even when a global
 * install layout doesn't match the filesystem walk in
 * `rickyLocalPersonaDir()`.
 *
 * Maintenance contract: when adding a new persona JSON to `personas/`, also
 * add a matching `import` and array entry here. A vitest contract check in
 * `bundled-personas.test.ts` enforces parity between the directory and this
 * file, so a missing import surfaces as a CI failure rather than a silent
 * runtime regression.
 */

import agentRelayWorkflow from '../../../personas/agent-relay-workflow.json' with { type: 'json' };
import agentRelayWorkflowReview from '../../../personas/agent-relay-workflow-review.json' with { type: 'json' };

import type { RickyLocalPersonaSpec } from './ricky-local-persona-resolver.js';

export const BUNDLED_RICKY_LOCAL_PERSONAS: readonly RickyLocalPersonaSpec[] = [
  agentRelayWorkflow as RickyLocalPersonaSpec,
  agentRelayWorkflowReview as RickyLocalPersonaSpec,
];
