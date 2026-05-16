export {
  runAutoSalvage,
  type FsProbe,
  type GhClient,
  type GitClient,
  type SalvageExitContext,
  type SalvageLogger,
  type SalvageOptions,
  type SalvageOutcome,
  type SalvageResult,
  type SalvageRuntime,
} from './run-auto-salvage.js';

export { createDefaultSalvageRuntime } from './default-runtime.js';

export {
  inferPrTitle,
  isSalvageableSpec,
  parseSpecMetadata,
  type SpecMetadata,
} from './spec-metadata.js';
