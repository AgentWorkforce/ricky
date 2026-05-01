/**
 * Prefer Workforce persona authoring for Ricky workflow generation initiated from the CLI.
 * Flags (--workforce-persona / --no-workforce-persona) override RICKY_WORKFORCE_PERSONA_CLI.
 * The CLI defaults to Workforce persona authoring unless explicitly disabled.
 */

export interface WorkforcePersonaWriterCliSignals {
  /** True when `--workforce-persona` is passed; false when `--no-workforce-persona` is passed. */
  workforcePersonaWriterCli?: boolean;
}

function envPreferWorkforcePersonaWorkflow(): undefined | boolean {
  const raw = process.env.RICKY_WORKFORCE_PERSONA_CLI;
  if (raw === undefined || raw.trim() === '') return undefined;
  const v = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return undefined;
}

export function resolvePreferWorkforcePersonaWorkflowWriter(parsed: WorkforcePersonaWriterCliSignals): undefined | boolean {
  if (parsed.workforcePersonaWriterCli === false) return false;
  if (parsed.workforcePersonaWriterCli === true) return true;
  return envPreferWorkforcePersonaWorkflow() ?? true;
}
