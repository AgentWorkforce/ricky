import type {
  ChildWorkflowGate,
  ChildWorkflowPlan,
  MasterExecutionPlan,
  PlannerDesiredSlice,
  PlannerInput,
} from './types.js';

const DEFAULT_WAVE_PREFIX = 'wave13-master-executor';
const DEFAULT_VALIDATION_COMMAND = 'npm run typecheck';
const DEFAULT_RETRY_POLICY = { maxAttempts: 2, backoffMs: 1000 } as const;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

interface PlannedSlice {
  readonly input: PlannerDesiredSlice;
  readonly index: number;
  readonly id: string;
  readonly targetFiles: readonly string[];
  readonly dependsOn: readonly string[];
  wave: number;
  ambiguousReasons: string[];
}

export function planMasterExecution(input: PlannerInput): MasterExecutionPlan {
  const wavePrefix = input.wavePrefix ?? DEFAULT_WAVE_PREFIX;
  const desiredSlices = normalizeDesiredSlices(input);
  const reservedIds = new Map<string, number>();
  const slices: PlannedSlice[] = desiredSlices.map((slice, index) => {
    const id = uniqueSlug(slice.id ?? slice.title, reservedIds);
    return {
      input: slice,
      index,
      id,
      targetFiles: [...(slice.targetFiles ?? [])],
      dependsOn: [...(slice.dependsOn ?? [])],
      wave: 0,
      ambiguousReasons: [],
    };
  });

  const planAmbiguities: string[] = [];
  if (slices.length === 0) {
    planAmbiguities.push('No desired slices or target files were provided for decomposition.');
  }
  if (input.constraints?.maxChildren !== undefined && slices.length > input.constraints.maxChildren) {
    planAmbiguities.push(
      `Plan contains ${slices.length} children, exceeding maxChildren ${input.constraints.maxChildren}.`,
    );
  }

  markSliceAmbiguities(slices, input.constraints?.forbiddenPaths ?? []);
  assignDependencyWaves(slices);

  const orderedSlices = [...slices].sort(
    (left, right) => left.wave - right.wave || left.index - right.index,
  );
  const sharedFileLaterIds = findLaterSharedFileIds(orderedSlices);
  const children = orderedSlices.map((slice, index) =>
    buildChildPlan({
      slice,
      planIndex: index + 1,
      wavePrefix,
      requiredGateMarkers: input.constraints?.requiredGateMarkers ?? [],
      forceSequential: sharedFileLaterIds.has(slice.id),
    }),
  );
  planAmbiguities.push(
    ...children
      .map((child) => child.ambiguous?.reason)
      .filter((reason): reason is string => Boolean(reason)),
  );

  return {
    title: input.title,
    description: input.description,
    wavePrefix,
    workflowSlug: input.workflowSlug,
    targetFiles: [...(input.targetFiles ?? [])],
    children,
    ...(planAmbiguities.length > 0 ? { ambiguous: { reason: planAmbiguities.join(' ') } } : {}),
  };
}

function normalizeDesiredSlices(input: PlannerInput): readonly PlannerDesiredSlice[] {
  if (input.desiredSlices && input.desiredSlices.length > 0) {
    return input.desiredSlices;
  }

  if (input.targetFiles && input.targetFiles.length > 0) {
    return [
      {
        title: input.title,
        summary: input.description,
        targetFiles: input.targetFiles,
      },
    ];
  }

  return [];
}

function markSliceAmbiguities(slices: readonly PlannedSlice[], forbiddenPaths: readonly string[]): void {
  const knownIds = new Set(slices.map((slice) => slice.id));
  const forbidden = new Set(forbiddenPaths);

  for (const slice of slices) {
    if (slice.targetFiles.length === 0 && slugify(slice.input.title).length === 0) {
      slice.ambiguousReasons.push('Slice has no target files and no inferable slug.');
    }

    for (const dependencyId of slice.dependsOn) {
      if (!knownIds.has(dependencyId)) {
        slice.ambiguousReasons.push(`Unknown dependency: ${dependencyId}.`);
      }
    }

    const forbiddenTarget = slice.targetFiles.find((targetFile) => forbidden.has(targetFile));
    if (forbiddenTarget) {
      slice.ambiguousReasons.push(`Target file is forbidden: ${forbiddenTarget}.`);
    }
  }
}

function assignDependencyWaves(slices: readonly PlannedSlice[]): void {
  const byId = new Map(slices.map((slice) => [slice.id, slice]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const resolveWave = (slice: PlannedSlice): number => {
    if (visited.has(slice.id)) {
      return slice.wave;
    }
    if (visiting.has(slice.id)) {
      slice.ambiguousReasons.push('Dependency cycle detected.');
      return slice.wave;
    }

    visiting.add(slice.id);
    const dependencyWaves = slice.dependsOn
      .map((dependencyId) => byId.get(dependencyId))
      .filter((dependency): dependency is PlannedSlice => dependency !== undefined)
      .map((dependency) => resolveWave(dependency));
    visiting.delete(slice.id);
    visited.add(slice.id);

    slice.wave = dependencyWaves.length === 0 ? 0 : Math.max(...dependencyWaves) + 1;
    return slice.wave;
  };

  for (const slice of slices) {
    resolveWave(slice);
  }
}

function findLaterSharedFileIds(orderedSlices: readonly PlannedSlice[]): Set<string> {
  const seenByWave = new Map<number, Set<string>>();
  const laterSharedIds = new Set<string>();

  for (const slice of orderedSlices) {
    const seenFiles = seenByWave.get(slice.wave) ?? new Set<string>();
    if (!seenByWave.has(slice.wave)) {
      seenByWave.set(slice.wave, seenFiles);
    }

    if (slice.targetFiles.some((targetFile) => seenFiles.has(targetFile))) {
      laterSharedIds.add(slice.id);
    }
    for (const targetFile of slice.targetFiles) {
      seenFiles.add(targetFile);
    }
  }

  return laterSharedIds;
}

function buildChildPlan(input: {
  slice: PlannedSlice;
  planIndex: number;
  wavePrefix: string;
  requiredGateMarkers: readonly string[];
  forceSequential: boolean;
}): ChildWorkflowPlan {
  const signoffArtifactPath = `.workflow-artifacts/${input.wavePrefix}/${input.slice.id}/signoff.md`;
  const signoffMarker = markerForId(input.slice.id);
  const validationCommands = [DEFAULT_VALIDATION_COMMAND];
  const gates = buildDefaultGates({
    signoffArtifactPath,
    signoffMarker,
    targetFiles: input.slice.targetFiles,
    validationCommands,
    requiredGateMarkers: input.requiredGateMarkers,
  });

  return {
    id: input.slice.id,
    title: input.slice.input.title,
    ...(input.slice.input.summary ? { summary: input.slice.input.summary } : {}),
    workflowFilePath: `workflows/${input.wavePrefix}/${String(input.planIndex).padStart(2, '0')}-${input.slice.id}.ts`,
    targetFiles: input.slice.targetFiles,
    allowedDirtyScope: [...input.slice.targetFiles, signoffArtifactPath],
    dependsOn: input.slice.dependsOn,
    parallelizable: input.slice.input.parallelizable === false ? false : !input.forceSequential,
    wave: input.slice.wave,
    gates,
    signoffArtifactPath,
    signoffMarker,
    validationCommands,
    retryPolicy: { ...DEFAULT_RETRY_POLICY },
    timeoutMs: DEFAULT_TIMEOUT_MS,
    escalationRules: [
      'Retry once for missing signoff evidence before escalating.',
      'Block immediately on missing environment or credential evidence.',
    ],
    ...(input.slice.ambiguousReasons.length > 0
      ? { ambiguous: { reason: input.slice.ambiguousReasons.join(' ') } }
      : {}),
  };
}

function buildDefaultGates(input: {
  signoffArtifactPath: string;
  signoffMarker: string;
  targetFiles: readonly string[];
  validationCommands: readonly string[];
  requiredGateMarkers: readonly string[];
}): readonly ChildWorkflowGate[] {
  const gates: ChildWorkflowGate[] = [
    {
      id: `signoff_artifact:${input.signoffArtifactPath}`,
      kind: 'signoff_artifact',
      description: 'Child workflow writes its required signoff artifact.',
      required: true,
      artifactPath: input.signoffArtifactPath,
    },
    {
      id: `marker_string:${input.signoffMarker}`,
      kind: 'marker_string',
      description: 'Child workflow signoff contains the required marker.',
      required: true,
      marker: input.signoffMarker,
    },
    ...input.requiredGateMarkers.map(
      (marker): ChildWorkflowGate => ({
        id: `marker_string:${marker}`,
        kind: 'marker_string',
        description: `Child workflow signoff contains required marker ${marker}.`,
        required: true,
        marker,
      }),
    ),
    {
      id: `changed_files:${[...input.targetFiles].join('|') || 'unscoped'}`,
      kind: 'changed_files',
      description: 'Child workflow changes stay within the declared target file scope.',
      required: true,
      fileScope: input.targetFiles,
    },
    ...input.validationCommands.map(
      (command): ChildWorkflowGate => ({
        id: `test_command:${command}`,
        kind: 'test_command',
        description: `Child workflow passes validation command: ${command}.`,
        required: true,
        command,
      }),
    ),
  ];

  if (input.targetFiles.some((targetFile) => /^workflows\/.+\.ts$/.test(targetFile))) {
    const dryrunCommand = 'npm run typecheck';
    gates.push({
      id: `dryrun_command:${dryrunCommand}`,
      kind: 'dryrun_command',
      description: 'Generated workflow passes a dry-run validation.',
      required: true,
      command: dryrunCommand,
    });
  }

  return gates;
}

function uniqueSlug(value: string, reservedIds: Map<string, number>): string {
  const baseSlug = slugify(value) || 'child-workflow';
  const seen = reservedIds.get(baseSlug) ?? 0;
  reservedIds.set(baseSlug, seen + 1);

  if (seen === 0) {
    return baseSlug;
  }

  return `${baseSlug}-${seen + 1}`;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function markerForId(id: string): string {
  return `RICKY_${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_IMPLEMENTED`;
}
