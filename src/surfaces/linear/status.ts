export interface LinearReadinessCheck {
  connected: boolean;
  label?: string;
  recovery?: string;
  capable?: boolean;
}

export interface LinearReadinessSnapshot {
  agents?: Record<string, LinearReadinessCheck>;
  integrations?: {
    github?: LinearReadinessCheck;
    linear?: LinearReadinessCheck;
  };
}

export interface LinearStatusRow {
  label: string;
  status: 'connected' | 'missing' | 'blocked' | 'unknown';
  message: string;
}

export interface LinearStatusSummary {
  ready: boolean;
  rows: LinearStatusRow[];
  nextActions: string[];
}

export function linearStatusSummary(readiness: LinearReadinessSnapshot | undefined): LinearStatusSummary {
  if (!readiness) {
    return {
      ready: false,
      rows: [
        { label: 'GitHub App', status: 'unknown', message: 'Cloud readiness API unavailable' },
        { label: 'Connected agents', status: 'unknown', message: 'Cloud readiness API unavailable' },
        { label: 'Linear Actor app', status: 'unknown', message: 'Cloud readiness API unavailable' },
      ],
      nextActions: ['ricky connect cloud', 'ricky status'],
    };
  }

  const github = readiness.integrations?.github;
  const linear = readiness.integrations?.linear;
  const githubReady = github?.connected === true;
  const capableAgents = Object.values(readiness.agents ?? {}).filter((agent) => agent.connected === true && agent.capable !== false);
  const agentReady = capableAgents.length > 0;
  const linearReady = linear?.connected === true;
  const rows: LinearStatusRow[] = [
    statusFromCheck('GitHub App', github, 'required before Linear can open PRs'),
    githubReady
      ? {
          label: 'Connected agents',
          status: agentReady ? 'connected' : 'missing',
          message: agentReady ? `${capableAgents.length} capable agent(s) connected` : 'no capable Cloud implementation agents connected',
        }
      : {
          label: 'Connected agents',
          status: 'blocked',
          message: 'not checked until GitHub App is installed',
        },
    statusFromCheck('Linear Actor app', linear, 'required before Linear can deliver agent sessions'),
  ];

  const nextActions = [];
  if (!githubReady) nextActions.push('ricky connect integrations --cloud github');
  if (githubReady && !agentReady) nextActions.push('ricky connect agents --cloud');
  if (!linearReady) nextActions.push('ricky connect linear');
  if (githubReady && agentReady && linearReady) nextActions.push('Mention Ricky on a Linear issue to start a Cloud workflow.');

  return {
    ready: githubReady && agentReady && linearReady,
    rows,
    nextActions,
  };
}

export function renderLinearStatus(readiness: LinearReadinessSnapshot | undefined): string[] {
  const summary = linearStatusSummary(readiness);
  return [
    'Ricky status linear',
    '',
    ...summary.rows.map((row) => `${iconForStatus(row.status)} ${row.label}: ${row.message}`),
    '',
    summary.ready ? 'Ready' : 'Next',
    ...summary.nextActions.map((action) => `  ${action}`),
  ];
}

function statusFromCheck(label: string, check: LinearReadinessCheck | undefined, missingMessage: string): LinearStatusRow {
  if (!check) return { label, status: 'unknown', message: 'not reported by Cloud readiness' };
  if (check.connected) return { label, status: 'connected', message: check.label ? `connected (${check.label})` : 'connected' };
  return { label, status: 'missing', message: check.recovery ?? missingMessage };
}

function iconForStatus(status: LinearStatusRow['status']): string {
  if (status === 'connected') return '✓';
  if (status === 'blocked') return '!';
  return '○';
}
