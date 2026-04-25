export interface ModeOption {
  id: 'local-byoh' | 'cloud';
  title: string;
  description: string;
  nextStep: string;
}

export const MODE_OPTIONS: ModeOption[] = [
  {
    id: 'local-byoh',
    title: 'Local / BYOH',
    description: 'Use your local environment and agent setup. Best when you want direct control and local proof.',
    nextStep: 'Give Ricky a spec, a workflow artifact, or a Claude/MCP handoff and continue locally.',
  },
  {
    id: 'cloud',
    title: 'Cloud',
    description: 'Connect providers and use Ricky with Cloud-backed coordination and integrations.',
    nextStep: 'Connect providers such as Google, then continue with hosted workflow generation and execution.',
  },
];

export function renderModeSelector(): string {
  return [
    'Choose how you want to start:',
    '',
    ...MODE_OPTIONS.flatMap((option, index) => [
      `${index + 1}. ${option.title}`,
      `   ${option.description}`,
      `   Next: ${option.nextStep}`,
      '',
    ]),
  ]
    .join('\n')
    .trim();
}
