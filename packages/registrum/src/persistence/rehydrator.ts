/**
 * Registrar Rehydration (E.3)
 *
 * Reconstructs a registrar exactly as it was, or fails completely.
 *
 * Design rules:
 * - Fail-closed: Invalid snapshot → hard failure
 * - No partial recovery
 * - No warnings
 * - No fallback
 * - Registry hash must match
 * - Mode must be compatible
 */

import type { StateID, Invariant } from "../types.js";
import type { RegistrarSnapshotV1 } from "./snapshot.js";
import {
  validateSnapshot,
  computeLegacyRegistryHash,
  computeRegistryHash,
} from "./snapshot.js";
import type { CompiledInvariantRegistry } from "../registry/loader.js";

// =============================================================================
// Rehydration Errors
// =============================================================================

/**
 * Base error for rehydration failures.
 */
export class RehydrationError extends Error {
  constructor(message: string) {
    super(`Rehydration failed: ${message}`);
    this.name = "RehydrationError";
  }
}

/**
 * Error for registry hash mismatch.
 */
export class RegistryMismatchError extends RehydrationError {
  constructor(
    public readonly expectedHash: string,
    public readonly actualHash: string
  ) {
    super(
      `Registry hash mismatch: snapshot expects '${expectedHash}' but got '${actualHash}'`
    );
    this.name = "RegistryMismatchError";
  }
}

/**
 * Error for mode mismatch.
 */
export class ModeMismatchError extends RehydrationError {
  constructor(
    public readonly snapshotMode: string,
    public readonly rehydrateMode: string
  ) {
    super(
      `Mode mismatch: snapshot is '${snapshotMode}' but rehydrating as '${rehydrateMode}'`
    );
    this.name = "ModeMismatchError";
  }
}

// =============================================================================
// Rehydration Options
// =============================================================================

/**
 * Options for rehydrating a registrar from a snapshot.
 */
export interface RehydrationOptions {
  /**
   * Mode to rehydrate into.
   * Must match the snapshot's mode.
   *
   * "dual" is the recommended production mode (see
   * StructuralRegistrar.dualWitness). Because dual is registry-authoritative on
   * agreement, a dual-mode snapshot is verified against the registry CONTENT
   * hash — the same constitutional-drift guard as "registry" mode — so a dual
   * snapshot requires a compiledRegistry to rehydrate, and a legacy invariant
   * set is supplied so the restored registrar can keep running its second
   * witness.
   */
  readonly mode: "legacy" | "registry" | "dual";

  /**
   * Legacy invariants (required for legacy mode; also used as the secondary
   * witness in dual mode).
   */
  readonly invariants?: readonly Invariant[];

  /**
   * Compiled registry (required for registry mode and dual mode).
   */
  readonly compiledRegistry?: CompiledInvariantRegistry;
}

/**
 * Internal state reconstructed from a snapshot.
 */
export interface RehydratedState {
  /**
   * Map of state IDs to their registered state entries.
   */
  readonly registry: Map<StateID, RehydratedStateEntry>;

  /**
   * Current order index (next to be assigned).
   */
  readonly currentOrderIndex: number;
}

/**
 * Entry for a rehydrated state.
 */
export interface RehydratedStateEntry {
  readonly id: StateID;
  readonly parentId: StateID | null;
  readonly orderIndex: number;
}

// =============================================================================
// Rehydration Logic
// =============================================================================

/**
 * Rehydrate registrar state from a snapshot.
 *
 * Behavior:
 * - Validates snapshot schema
 * - Verifies registry hash compatibility
 * - Verifies mode compatibility
 * - Reconstructs internal state
 *
 * Failure modes (all result in thrown errors):
 * - Invalid snapshot schema → SnapshotValidationError
 * - Registry hash mismatch → RegistryMismatchError
 * - Mode mismatch → ModeMismatchError
 * - Inconsistent state → RehydrationError
 *
 * No partial recovery. No warnings. No fallback.
 */
export function rehydrate(
  raw: unknown,
  options: RehydrationOptions
): RehydratedState {
  // Step 1: Validate snapshot schema
  validateSnapshot(raw);
  const snapshot = raw as RegistrarSnapshotV1;

  // Step 2: Verify mode compatibility
  if (snapshot.mode !== options.mode) {
    throw new ModeMismatchError(snapshot.mode, options.mode);
  }

  // Step 3: Compute expected registry hash
  const expectedHash = computeExpectedHash(options);

  // Step 4: Verify registry hash
  if (snapshot.registry_hash !== expectedHash) {
    throw new RegistryMismatchError(snapshot.registry_hash, expectedHash);
  }

  // Step 5: Reconstruct internal state
  return reconstructState(snapshot);
}

/**
 * Compute the expected registry hash for the given options.
 */
function computeExpectedHash(options: RehydrationOptions): string {
  // Registry and dual modes are both registry-authoritative, so both verify
  // against the registry CONTENT hash. This keeps the constitutional-drift
  // guard active for dual mode: a dual snapshot taken under one constitution
  // fails closed (RegistryMismatchError) under a silently-mutated one.
  if (options.mode === "registry" || options.mode === "dual") {
    if (!options.compiledRegistry) {
      throw new RehydrationError(
        `${options.mode === "dual" ? "Dual" : "Registry"} mode requires compiledRegistry option`
      );
    }
    return computeRegistryHash(options.compiledRegistry);
  }

  // Legacy mode
  if (!options.invariants) {
    throw new RehydrationError("Legacy mode requires invariants option");
  }
  return computeLegacyRegistryHash(options.invariants.map((i) => i.id));
}

/**
 * Reconstruct internal state from a validated snapshot.
 */
function reconstructState(snapshot: RegistrarSnapshotV1): RehydratedState {
  const registry = new Map<StateID, RehydratedStateEntry>();

  // Reconstruct each state entry
  for (const id of snapshot.state_ids) {
    const parentId = snapshot.lineage[id];
    const orderIndex = snapshot.ordering.assigned[id];

    // Validate consistency (should already be validated, but defense in depth)
    if (parentId === undefined) {
      throw new RehydrationError(
        `State '${id}' missing from lineage`
      );
    }
    if (orderIndex === undefined) {
      throw new RehydrationError(
        `State '${id}' missing from ordering`
      );
    }

    registry.set(id, {
      id,
      parentId,
      orderIndex,
    });
  }

  // Compute next order index
  const currentOrderIndex = snapshot.ordering.max_index + 1;

  return {
    registry,
    currentOrderIndex,
  };
}

/**
 * Validate that rehydrated state matches a snapshot.
 *
 * This is used to verify round-trip correctness.
 */
export function validateRehydration(
  rehydrated: RehydratedState,
  snapshot: RegistrarSnapshotV1
): boolean {
  // Check state count
  if (rehydrated.registry.size !== snapshot.state_ids.length) {
    return false;
  }

  // Check order index
  if (rehydrated.currentOrderIndex !== snapshot.ordering.max_index + 1) {
    return false;
  }

  // Check each state
  for (const id of snapshot.state_ids) {
    const entry = rehydrated.registry.get(id);
    if (!entry) {
      return false;
    }

    if (entry.parentId !== snapshot.lineage[id]) {
      return false;
    }

    if (entry.orderIndex !== snapshot.ordering.assigned[id]) {
      return false;
    }
  }

  return true;
}
