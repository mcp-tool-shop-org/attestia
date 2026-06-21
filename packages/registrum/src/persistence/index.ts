/**
 * Registrum Persistence Module
 *
 * Provides snapshot, serialization, rehydration, and replay capabilities.
 *
 * Phase E deliverables:
 * - E.1: Snapshot schema
 * - E.2: Deterministic serialization
 * - E.3: Registrar rehydration
 * - E.4: Transition replay engine
 */

export {
  // Schema
  SNAPSHOT_VERSION,
  SUPPORTED_SNAPSHOT_VERSIONS,
  type RegistrarSnapshotV1,
  SnapshotValidationError,
  validateSnapshot,
  // Migration seam
  migrateToLatest,

  // Hash computation
  computeLegacyRegistryHash,
  computeRegistryHash,
} from "./snapshot.js";

export {
  // Serialization
  serializeSnapshot,
  deserializeSnapshot,
  // Checksum (non-cryptographic, for integrity checking)
  computeSnapshotChecksum32,
  // @deprecated - use computeSnapshotChecksum32
  computeSnapshotHash,
} from "./serializer.js";

export {
  // Rehydration
  rehydrate,
  validateRehydration,
  type RehydrationOptions,
  type RehydratedState,
  type RehydratedStateEntry,
  RehydrationError,
  RegistryMismatchError,
  ModeMismatchError,
} from "./rehydrator.js";

export {
  // Replay
  replay,
  compareReplayReports,
  createTransitionRecorder,
  type ReplayReport,
  type ReplayResult,
  type ReplayOptions,
  type TransitionRecorder,
} from "./replay.js";
