/**
 * Registrar Snapshot Schema (E.1)
 *
 * Defines the versioned, structural snapshot schema for Registrum.
 *
 * Design rules:
 * - Schema is versioned and explicit
 * - All fields are structural, not semantic
 * - No derived metrics, summaries, or caches
 * - No compression or interpretation
 * - Fail-closed validation
 *
 * Explicit Exclusions (documented by design):
 * - ❌ No semantic data (state.data is excluded)
 * - ❌ No derived metrics (counts, averages, statistics)
 * - ❌ No summaries (lineage summaries, ordering summaries)
 * - ❌ No caches (computed values, lookup tables)
 * - ❌ No replay hints (optimization paths, shortcuts)
 * - ❌ No wall-clock timestamps (environment-dependent)
 */

import { createHash } from "crypto";
import { canonicalize } from "json-canonicalize";
import type { StateID } from "../types.js";
import type { RegistrarMode } from "../structural-registrar.js";
import type {
  CompiledInvariantRegistry,
  CompiledInvariant,
} from "../registry/loader.js";

// =============================================================================
// Snapshot Schema Version 1
// =============================================================================

/**
 * The canonical snapshot schema version.
 * This is the only supported version.
 */
export const SNAPSHOT_VERSION = "1.0" as const;

/**
 * Registrar state snapshot.
 *
 * This is the structural projection of a Registrar's LIVE FRONTIER — the
 * latest accepted version of each StateID — and the minimum needed to resume
 * accepting transitions deterministically.
 *
 * Append-only note: Registrum never overwrites history; a same-id transition
 * records a new version in the in-memory chain (see StructuralRegistrar). The
 * snapshot deliberately captures only the frontier (one entry per StateID),
 * because deep ancestry is reconstructed by REPLAY of the transition log, not
 * by the snapshot. `getLineage` on a live registrar returns the full version
 * chain; `getLineage` on a registrar rehydrated from a snapshot returns the
 * restored frontier. This keeps the snapshot schema stable and bounded.
 */
export interface RegistrarSnapshotV1 {
  /**
   * Schema version. Must be "1.0".
   * Used for forward compatibility detection.
   */
  readonly version: typeof SNAPSHOT_VERSION;

  /**
   * Invariant registry identity hash.
   * Used to verify registry compatibility on rehydration (fail-closed).
   *
   * For legacy mode: `legacy:<sorted invariant IDs>`
   * For registry mode: hex SHA-256 content hash over the compiled registry's
   *   normative content (registry_id, version, and each invariant's id, scope,
   *   failure_mode, and canonicalized predicate AST). A constitutional change
   *   therefore changes this hash even if registry_id is unchanged.
   */
  readonly registry_hash: string;

  /**
   * Operating mode at time of snapshot.
   * Required for correct rehydration.
   */
  readonly mode: RegistrarMode;

  /**
   * Registered state IDs in canonical order (by orderIndex).
   * This is the source of truth for ordering.
   */
  readonly state_ids: readonly StateID[];

  /**
   * Lineage relationships.
   * Maps each state ID to its parent ID (or null for roots).
   */
  readonly lineage: Readonly<Record<StateID, StateID | null>>;

  /**
   * Ordering state.
   */
  readonly ordering: {
    /**
     * Maximum assigned order index.
     * Equal to (state_ids.length - 1) for non-empty registrars.
     */
    readonly max_index: number;

    /**
     * Maps each state ID to its assigned order index.
     */
    readonly assigned: Readonly<Record<StateID, number>>;
  };
}

// =============================================================================
// Schema Validation
// =============================================================================

/**
 * Snapshot validation error.
 * Thrown when snapshot validation fails.
 */
export class SnapshotValidationError extends Error {
  constructor(
    message: string,
    public readonly field?: string
  ) {
    super(field ? `Snapshot validation failed at '${field}': ${message}` : `Snapshot validation failed: ${message}`);
    this.name = "SnapshotValidationError";
  }
}

/**
 * Validate a snapshot against the schema.
 *
 * Behavior:
 * - Validates all required fields exist
 * - Validates field types
 * - Validates internal consistency
 * - Rejects unknown fields (strict mode)
 *
 * Throws SnapshotValidationError on any validation failure.
 */
export function validateSnapshot(raw: unknown): asserts raw is RegistrarSnapshotV1 {
  if (typeof raw !== "object" || raw === null) {
    throw new SnapshotValidationError("Snapshot must be an object");
  }

  const snapshot = raw as Record<string, unknown>;

  // Validate known fields only (strict mode)
  const knownFields = new Set(["version", "registry_hash", "mode", "state_ids", "lineage", "ordering"]);
  for (const key of Object.keys(snapshot)) {
    if (!knownFields.has(key)) {
      throw new SnapshotValidationError(`Unknown field '${key}' - schema rejects extra fields`, key);
    }
  }

  // version
  if (snapshot.version !== SNAPSHOT_VERSION) {
    throw new SnapshotValidationError(
      `Unsupported version '${snapshot.version}' (expected '${SNAPSHOT_VERSION}')`,
      "version"
    );
  }

  // registry_hash
  if (typeof snapshot.registry_hash !== "string" || snapshot.registry_hash.length === 0) {
    throw new SnapshotValidationError("registry_hash must be a non-empty string", "registry_hash");
  }

  // mode
  if (
    snapshot.mode !== "legacy" &&
    snapshot.mode !== "registry" &&
    snapshot.mode !== "dual"
  ) {
    throw new SnapshotValidationError(
      `mode must be 'legacy', 'registry', or 'dual', got '${snapshot.mode}'`,
      "mode"
    );
  }

  // state_ids
  if (!Array.isArray(snapshot.state_ids)) {
    throw new SnapshotValidationError("state_ids must be an array", "state_ids");
  }
  for (let i = 0; i < snapshot.state_ids.length; i++) {
    if (typeof snapshot.state_ids[i] !== "string") {
      throw new SnapshotValidationError(`state_ids[${i}] must be a string`, `state_ids[${i}]`);
    }
  }

  // lineage
  if (typeof snapshot.lineage !== "object" || snapshot.lineage === null) {
    throw new SnapshotValidationError("lineage must be an object", "lineage");
  }
  const lineage = snapshot.lineage as Record<string, unknown>;
  for (const [id, parentId] of Object.entries(lineage)) {
    if (parentId !== null && typeof parentId !== "string") {
      throw new SnapshotValidationError(
        `lineage['${id}'] must be a string or null`,
        `lineage['${id}']`
      );
    }
  }

  // ordering
  if (typeof snapshot.ordering !== "object" || snapshot.ordering === null) {
    throw new SnapshotValidationError("ordering must be an object", "ordering");
  }
  const ordering = snapshot.ordering as Record<string, unknown>;

  // ordering.max_index
  if (typeof ordering.max_index !== "number" || !Number.isInteger(ordering.max_index)) {
    throw new SnapshotValidationError("ordering.max_index must be an integer", "ordering.max_index");
  }

  // ordering.assigned
  if (typeof ordering.assigned !== "object" || ordering.assigned === null) {
    throw new SnapshotValidationError("ordering.assigned must be an object", "ordering.assigned");
  }
  const assigned = ordering.assigned as Record<string, unknown>;
  for (const [id, index] of Object.entries(assigned)) {
    if (typeof index !== "number" || !Number.isInteger(index)) {
      throw new SnapshotValidationError(
        `ordering.assigned['${id}'] must be an integer`,
        `ordering.assigned['${id}']`
      );
    }
  }

  // Cross-field consistency checks
  validateSnapshotConsistency(
    snapshot.state_ids as string[],
    lineage as Record<string, string | null>,
    {
      max_index: ordering.max_index as number,
      assigned: assigned as Record<string, number>,
    }
  );
}

/**
 * Validate internal consistency of snapshot data.
 */
function validateSnapshotConsistency(
  stateIds: readonly string[],
  lineage: Readonly<Record<string, string | null>>,
  ordering: { max_index: number; assigned: Readonly<Record<string, number>> }
): void {
  const stateIdSet = new Set(stateIds);

  // Every state_id must have a lineage entry
  for (const id of stateIds) {
    if (!(id in lineage)) {
      throw new SnapshotValidationError(
        `State '${id}' in state_ids has no lineage entry`,
        `lineage['${id}']`
      );
    }
  }

  // Every lineage entry must correspond to a state_id
  for (const id of Object.keys(lineage)) {
    if (!stateIdSet.has(id)) {
      throw new SnapshotValidationError(
        `Lineage entry '${id}' has no corresponding state_id`,
        `lineage['${id}']`
      );
    }
  }

  // Every parent in lineage must exist (or be null)
  for (const [id, parentId] of Object.entries(lineage)) {
    if (parentId !== null && !stateIdSet.has(parentId)) {
      throw new SnapshotValidationError(
        `Lineage parent '${parentId}' for state '${id}' does not exist`,
        `lineage['${id}']`
      );
    }
  }

  // Root-reachability + acyclicity.
  //
  // Parent-existence is necessary but not sufficient: a lineage where every
  // parent exists can still contain a cycle (e.g. A->B->A) and thus never
  // terminate at a null-parent root. Such a snapshot describes an impossible
  // append-only history and must be rejected fail-closed. Walk each state's
  // parent chain; it must reach a null parent (a root) without revisiting any
  // node. A repeated node on the walk proves a cycle.
  for (const start of stateIds) {
    const seen = new Set<string>();
    let cursor: string | null = start;

    while (cursor !== null) {
      if (seen.has(cursor)) {
        throw new SnapshotValidationError(
          `Lineage cycle detected: state '${start}' does not reach a root ` +
            `(revisited '${cursor}')`,
          `lineage['${start}']`
        );
      }
      seen.add(cursor);

      // Parent presence and existence are already validated above, so a
      // missing key here would be an internal inconsistency; treat it as a
      // broken (rootless) chain rather than silently stopping.
      const next: string | null | undefined = lineage[cursor];
      if (next === undefined) {
        throw new SnapshotValidationError(
          `Lineage chain for state '${start}' references unknown node ` +
            `'${cursor}' and does not reach a root`,
          `lineage['${start}']`
        );
      }

      cursor = next;
    }
    // Loop exited because cursor became null → reached a root. Good.
  }

  // Every state_id must have an ordering entry
  for (const id of stateIds) {
    if (!(id in ordering.assigned)) {
      throw new SnapshotValidationError(
        `State '${id}' in state_ids has no ordering entry`,
        `ordering.assigned['${id}']`
      );
    }
  }

  // Every ordering entry must correspond to a state_id
  for (const id of Object.keys(ordering.assigned)) {
    if (!stateIdSet.has(id)) {
      throw new SnapshotValidationError(
        `Ordering entry '${id}' has no corresponding state_id`,
        `ordering.assigned['${id}']`
      );
    }
  }

  // Validate max_index consistency
  // max_index should be the highest assigned order index, or -1 if empty
  if (stateIds.length === 0) {
    if (ordering.max_index !== -1) {
      throw new SnapshotValidationError(
        `max_index should be -1 for empty registrar, got ${ordering.max_index}`,
        "ordering.max_index"
      );
    }
  } else {
    // max_index should equal the highest order index
    const maxAssigned = Math.max(...Object.values(ordering.assigned));
    if (ordering.max_index !== maxAssigned) {
      throw new SnapshotValidationError(
        `max_index (${ordering.max_index}) should equal highest assigned index (${maxAssigned})`,
        "ordering.max_index"
      );
    }
  }

  // Order indices must be unique
  if (stateIds.length > 0) {
    const indices = Object.values(ordering.assigned);
    const indexSet = new Set(indices);

    if (indexSet.size !== indices.length) {
      throw new SnapshotValidationError(
        "Order indices must be unique",
        "ordering.assigned"
      );
    }

    // All indices must be non-negative
    for (const idx of indices) {
      if (idx < 0) {
        throw new SnapshotValidationError(
          `Order index ${idx} is negative`,
          "ordering.assigned"
        );
      }
    }
  }
}

// =============================================================================
// Registry Hash Computation
// =============================================================================

/**
 * Compute a deterministic hash for legacy mode invariants.
 *
 * The hash is based on invariant IDs only (sorted).
 * This ensures mode compatibility can be verified on rehydration.
 */
export function computeLegacyRegistryHash(invariantIds: readonly string[]): string {
  const sorted = [...invariantIds].sort();
  return `legacy:${sorted.join(",")}`;
}

/**
 * Compute a content-addressed hash for a registry-mode invariant registry.
 *
 * The hash is a hex-encoded SHA-256 over the registry's NORMATIVE content —
 * the parts that determine constitutional behavior:
 *   - registry_id and version (identity)
 *   - for each invariant, in declaration order:
 *       id, scope, failure_mode, and the canonicalized predicate AST
 *
 * Why the AST and not the source expression: the AST is the compiled,
 * normalized form actually evaluated at runtime, so two registries that parse
 * to identical behavior hash identically, and any change to a predicate's
 * meaning (operator, operand, function) changes the hash.
 *
 * This makes a registry hash mismatch detect CONSTITUTIONAL DRIFT: if a
 * predicate changes while registry_id stays the same, rehydrating a snapshot
 * under the new registry fails closed (RegistryMismatchError) instead of
 * silently accepting a different constitution.
 *
 * Determinism: invariant order is preserved (it is part of the constitution),
 * and applies_to / description are intentionally EXCLUDED — they are
 * documentation, not normative behavior, so editing a description does not
 * invalidate existing snapshots.
 */
export function computeRegistryHash(
  registry: CompiledInvariantRegistry
): string {
  const normative = {
    registry_id: registry.registry_id,
    version: registry.version,
    invariants: registry.invariants.map((inv: CompiledInvariant) => ({
      id: inv.id,
      scope: inv.scope,
      failure_mode: inv.failure_mode,
      ast: inv.ast,
    })),
  };
  const canonical = canonicalize(normative);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
