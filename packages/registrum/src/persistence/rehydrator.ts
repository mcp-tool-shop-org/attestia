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
  migrateToLatest,
  computeLegacyRegistryHash,
  computeRegistryHash,
} from "./snapshot.js";
import type { CompiledInvariantRegistry } from "../registry/loader.js";
import {
  type Telemetry,
  type ObservabilityEvent,
  NOOP_TELEMETRY,
} from "@attestia/types";

// =============================================================================
// Telemetry helpers
// =============================================================================

/**
 * Emit a telemetry event, guarding against a misbehaving sink.
 *
 * Mirrors StructuralRegistrar.emit: the {@link Telemetry} contract says
 * `record` MUST NOT throw, but a buggy host sink might. Observability must
 * never break the operation it observes, so a sink error is swallowed here — a
 * rehydration verdict (restore or fail-closed) is never lost to telemetry.
 */
function emit(telemetry: Telemetry, event: ObservabilityEvent): void {
  try {
    telemetry.record(event);
  } catch {
    /* a misbehaving sink must never affect a verdict — intentionally ignored */
  }
}

/**
 * Extract a LOW-CARDINALITY error identifier for a telemetry attribute: the
 * stable `code` if the error carries one, otherwise the class name. Never the
 * message (which is unbounded and belongs in `message`).
 */
function rehydrationErrorCode(e: unknown): string {
  if (typeof e === "object" && e !== null) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
    const name = (e as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "UNKNOWN";
}

// =============================================================================
// Rehydration Errors
// =============================================================================

/**
 * Base error for rehydration failures.
 *
 * `code` is a stable, machine-readable identifier. The base value is
 * `"REHYDRATION_FAILED"`; specialized subclasses (e.g.
 * {@link RegistryMismatchError}) assign a more specific code in their
 * constructor. The field is part of the public contract — callers may switch on
 * it across patch/minor releases.
 */
export class RehydrationError extends Error {
  /**
   * Stable error code. `"REHYDRATION_FAILED"` for the base class; subclasses
   * may set a more specific code (e.g. `"REGISTRY_DRIFT"`).
   */
  readonly code: "REHYDRATION_FAILED" | "REGISTRY_DRIFT" = "REHYDRATION_FAILED";

  constructor(message: string) {
    super(`Rehydration failed: ${message}`);
    this.name = "RehydrationError";
  }
}

/**
 * Error for registry hash mismatch — the snapshot was written under a different
 * constitution than the one being rehydrated against (constitutional drift).
 *
 * `code` is the stable identifier `"REGISTRY_DRIFT"`.
 */
export class RegistryMismatchError extends RehydrationError {
  /** Stable error code: `"REGISTRY_DRIFT"`. */
  override readonly code = "REGISTRY_DRIFT" as const;

  constructor(
    public readonly expectedHash: string,
    public readonly actualHash: string
  ) {
    // Drift is the moment an operator most needs guidance: a hash mismatch
    // almost always means "you are restoring under a different constitution
    // than the snapshot was written under." State WHAT is wrong AND WHAT TO DO
    // so a failed restore during an incident does not turn into a guess.
    super(
      `Registry hash mismatch: snapshot expects '${expectedHash}' but got ` +
        `'${actualHash}'. Hint: the registry has changed since this snapshot ` +
        `was written. Rehydrate against the registry whose content hash ` +
        `matches the snapshot, or replay the transition log under the new ` +
        `constitution — do NOT restore against a mismatched registry.`
    );
    this.name = "RegistryMismatchError";
  }
}

/**
 * Error for mode mismatch.
 *
 * Inherits the base `code` `"REHYDRATION_FAILED"`.
 */
export class ModeMismatchError extends RehydrationError {
  constructor(
    public readonly snapshotMode: string,
    public readonly rehydrateMode: string
  ) {
    super(
      `Mode mismatch: snapshot is '${snapshotMode}' but rehydrating as ` +
        `'${rehydrateMode}'. Hint: pass options.mode = '${snapshotMode}' to ` +
        `match the snapshot (a snapshot can only be restored under the mode it ` +
        `was written in).`
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

  /**
   * Optional observability sink. The load/restore boundary is one of the most
   * operationally-critical events the system has — "this snapshot was produced
   * under a different constitution" (REGISTRY_DRIFT) and "this snapshot is
   * structurally corrupt" (SNAPSHOT_INVALID) are exactly the failures an
   * operator needs to alert on. register()/validate() are instrumented; this
   * threads the same injectable sink through the restore path so a rehydration
   * outcome is a first-class metric series.
   *
   * Defaults to {@link NOOP_TELEMETRY}, so observability stays opt-in and a
   * caller that passes nothing gets the previous silent behavior. Emission is
   * guarded so a misbehaving sink can never affect the fail-closed verdict.
   */
  readonly telemetry?: Telemetry;
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
  const telemetry = options.telemetry ?? NOOP_TELEMETRY;
  try {
    // Step 1: Validate snapshot schema
    validateSnapshot(raw);

    // Step 2: Migrate any supported-but-older schema version up to latest. This
    // is the identity for the current version; the seam exists so a future
    // schema change is additive rather than a breaking rejection (RT-B-002).
    const snapshot = migrateToLatest(raw as RegistrarSnapshotV1);

    // Step 3: Verify mode compatibility
    if (snapshot.mode !== options.mode) {
      throw new ModeMismatchError(snapshot.mode, options.mode);
    }

    // Step 4: Compute expected registry hash
    const expectedHash = computeExpectedHash(options);

    // Step 5: Verify registry hash
    if (snapshot.registry_hash !== expectedHash) {
      throw new RegistryMismatchError(snapshot.registry_hash, expectedHash);
    }

    // Step 6: Reconstruct internal state
    const restored = reconstructState(snapshot);

    // A completed restore is the operationally-critical "ok" event: record it
    // with a low-cardinality state_count so an operator has a metric series for
    // "registrar rehydrated" (size + mode), pairing with the snapshot event.
    emit(telemetry, {
      package: "@attestia/registrum",
      op: "rehydrate",
      level: "info",
      outcome: "ok",
      attributes: { mode: options.mode, stateCount: restored.registry.size },
    });

    return restored;
  } catch (e) {
    // Every terminal failure of the restore path — constitutional drift
    // (REGISTRY_DRIFT), a corrupt snapshot (SNAPSHOT_INVALID), a mode mismatch,
    // or a generic REHYDRATION_FAILED — emits a structured `failed` event with
    // the stable error code as a low-cardinality attribute, so "registrar
    // refused to rehydrate" is alertable. The full human detail (which carries
    // the actionable hint) rides in `message`, never in attributes. `record`
    // never throws, so this cannot mask the original error.
    emit(telemetry, {
      package: "@attestia/registrum",
      op: "rehydrate",
      level: "error",
      outcome: "failed",
      attributes: { mode: options.mode, error: rehydrationErrorCode(e) },
      message: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
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
