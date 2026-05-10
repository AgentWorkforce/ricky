export type RickyWorkflowScheduleType = 'cron' | 'once';

export interface RickyWorkflowSchedule {
  id: string;
  name: string;
  description?: string | null;
  scheduleType: RickyWorkflowScheduleType;
  cronExpression?: string | null;
  scheduledAt?: string | Date | null;
  timezone?: string;
  status: string;
  lastTriggeredRunId?: string | null;
  lastTriggeredAt?: string | Date | null;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export interface ScheduleRickyWorkflowOptions {
  name?: string;
  cronExpression?: string;
  scheduledAt?: string;
  timezone?: string;
}

export interface ScheduleRickyWorkflowResult {
  schedule: RickyWorkflowSchedule;
}

export interface ListRickyWorkflowSchedulesResult {
  schedules: RickyWorkflowSchedule[];
}

type RelaySdkWorkflowSchedules = {
  scheduleWorkflow: (
    workflowPath: string,
    options: {
      name?: string;
      cron?: string;
      at?: string;
      timezone?: string;
    },
  ) => Promise<RickyWorkflowSchedule>;
  listWorkflowSchedules: () => Promise<RickyWorkflowSchedule[]>;
};

async function relayWorkflowSchedules(): Promise<RelaySdkWorkflowSchedules> {
  const sdk = await import('@agent-relay/sdk/workflows') as unknown as Partial<RelaySdkWorkflowSchedules>;
  if (typeof sdk.scheduleWorkflow !== 'function' || typeof sdk.listWorkflowSchedules !== 'function') {
    throw new Error(
      'Installed @agent-relay/sdk does not expose workflow scheduling yet. Upgrade to the Relay SDK version that includes scheduleWorkflow.',
    );
  }
  return sdk as RelaySdkWorkflowSchedules;
}

export async function scheduleRickyWorkflow(
  workflowPath: string,
  options: ScheduleRickyWorkflowOptions,
): Promise<ScheduleRickyWorkflowResult> {
  const sdk = await relayWorkflowSchedules();
  const schedule = await sdk.scheduleWorkflow(workflowPath, {
    ...(options.name ? { name: options.name } : {}),
    ...(options.cronExpression ? { cron: options.cronExpression } : {}),
    ...(options.scheduledAt ? { at: options.scheduledAt } : {}),
    ...(options.timezone ? { timezone: options.timezone } : {}),
  });
  return { schedule };
}

export async function listRickyWorkflowSchedules(): Promise<ListRickyWorkflowSchedulesResult> {
  const sdk = await relayWorkflowSchedules();
  return { schedules: await sdk.listWorkflowSchedules() };
}
