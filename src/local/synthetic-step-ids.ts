// Synthetic stage IDs Ricky uses to label local-runtime phases that aren't real
// Agent Relay SDK workflow steps. Forwarding them to the SDK as a `startFrom`
// resume target produces `startFrom step "..." not found in workflow`, so the
// auto-fix loop must filter them out.
export const SYNTHETIC_LOCAL_STAGE_IDS = new Set([
  'runtime-precheck',
  'runtime-launch',
  'local-runtime',
]);

export function isSyntheticStageId(id: string | undefined): boolean {
  return !!id && SYNTHETIC_LOCAL_STAGE_IDS.has(id);
}
