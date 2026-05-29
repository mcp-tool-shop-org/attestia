/**
 * Registrum Core Types
 *
 * These types define the canonical data structures for Registrum.
 * They are isomorphic to the language-agnostic contract in PHASE1_SPEC.md.
 *
 * Design rules:
 * - All types are immutable (readonly)
 * - No methods that mutate state
 * - No semantic interpretation
 * - No scoring, ranking, or preference
 */

// =============================================================================
// Core Identifiers
// =============================================================================

/**
 * Unique identifier for a State.
 * Must be non-empty and explicitly declared.
 */
export type StateID = string;

// =============================================================================
// Core Structures
// =============================================================================

/**
 * A State is a complete, explicit representation of a system at a single logical moment.
 *
 * Properties:
 * - Immutable once registered
 * - `data` is opaque to the Registrar
 * - Registrar reasons only about `structure`
 */
export interface State {
  /** Unique, immutable identifier */
  readonly id: StateID;

  /**
   * Explicit, inspectable structural fields.
   * The Registrar validates invariants against these fields.
   */
  readonly structure: Readonly<Record<string, unknown>>;

  /**
   * Opaque payload.
   * The Registrar does not inspect, interpret, or reason about this field.
   */
  readonly data: unknown;
}

/**
 * A Transition is a proposed change from one State to another.
 *
 * Properties:
 * - Directional (from → to)
 * - Not assumed to be valid
 * - Has no effect unless accepted by the Registrar
 */
export interface Transition {
  /**
   * Parent State ID.
   * - null indicates a root State (no parent)
   * - Must reference an existing registered State otherwise
   */
  readonly from: StateID | null;

  /** The proposed new State */
  readonly to: State;

  /**
   * Structural metadata only.
   * Must not contain semantic information.
   */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

// =============================================================================
// Invariants
// =============================================================================

/**
 * Scope of an invariant's applicability.
 */
export type InvariantScope = "state" | "transition" | "registration";

/**
 * What happens when an invariant is violated.
 * - "reject": Transition is rejected, system continues
 * - "halt": Indicates systemic corruption, requires immediate attention
 */
export type FailureMode = "reject" | "halt";

/**
 * Input to an invariant predicate.
 * Discriminated union to ensure type safety.
 */
export type InvariantInput =
  | { readonly kind: "state"; readonly state: State }
  | { readonly kind: "transition"; readonly transition: Transition }
  | {
      readonly kind: "registration";
      readonly transition: Transition;
      readonly registeredStateIds: ReadonlySet<StateID>;
      readonly currentOrderIndex: number;
    };

/**
 * An Invariant is a rule that must always hold for a State or Transition to be valid.
 *
 * Properties:
 * - Declarative, not procedural
 * - Structural, not semantic
 * - Boolean, not scalar
 * - Non-adaptive
 *
 * Forbidden patterns:
 * - Ranking alternatives
 * - Expressing preference
 * - Depending on success or outcome
 * - Inspecting semantic content
 */
export interface Invariant {
  /** Unique identifier for this invariant */
  readonly id: string;

  /** When this invariant applies */
  readonly scope: InvariantScope;

  /** Structural fields this invariant inspects */
  readonly appliesTo: readonly string[];

  /**
   * The invariant predicate.
   * Must be a pure function returning boolean.
   * Must not have side effects.
   */
  readonly predicate: (input: InvariantInput) => boolean;

  /** What happens on violation */
  readonly failureMode: FailureMode;

  /** Human-readable description (neutral, structural) */
  readonly description: string;
}

// =============================================================================
// Results
// =============================================================================

/**
 * Classification of how severe an invariant violation is.
 * This is derived from the invariant's failureMode.
 *
 * - "REJECT": Transition is rejected, system continues normally
 * - "HALT": Indicates systemic corruption, requires immediate attention
 */
export type ViolationClassification = "REJECT" | "HALT";

/**
 * Structured, machine-readable detail about a specific invariant violation.
 *
 * This complements the human-readable `message` and the stable rule text
 * (`InvariantViolation.message` historically carried only the static
 * `Invariant.description`). `details` exposes the *offending operands* so a
 * caller can react programmatically without parsing prose: which field was
 * wrong, what was expected, and what was actually seen.
 *
 * All members are optional — different invariants know different operands. The
 * values may be of any structural type (string id, number index, etc.); they
 * are diagnostic data, not metric labels, so they are NOT subject to the
 * low-cardinality rule that governs telemetry `attributes`.
 */
export interface InvariantViolationDetails {
  /** The structural field that violated the rule (e.g. "to.id", "from", "orderIndex"). */
  readonly field?: string;
  /** The value the invariant required (e.g. the parent id an identity must equal). */
  readonly expected?: unknown;
  /** The value actually observed (e.g. the mismatched id). */
  readonly actual?: unknown;
}

/**
 * Describes a specific invariant violation.
 *
 * This is a structured verdict, not an exception.
 * The violation IS the product — it names exactly what was refused and why.
 */
export interface InvariantViolation {
  /** ID of the violated invariant */
  readonly invariantId: string;

  /**
   * Severity classification of this violation.
   * Derived from the invariant's failureMode.
   * - "REJECT": Normal rejection, system continues
   * - "HALT": Critical violation indicating potential corruption
   */
  readonly classification: ViolationClassification;

  /**
   * Human-readable explanation of the violation.
   *
   * When the offending operands are known, the concrete values are interpolated
   * into this string (e.g. `"identity.immutable: to.id 'X' must equal from
   * 'Y'"`). The stable, value-free rule text remains available on the
   * invariant's `description`.
   */
  readonly message: string;

  /**
   * Optional structured detail naming the offending operands.
   *
   * Present when the registrar knows the concrete values that violated the rule
   * (identity mismatch, missing lineage parent, ordering index, etc.). Absent
   * for invariants whose violation has no single offending operand. See
   * {@link InvariantViolationDetails}.
   */
  readonly details?: InvariantViolationDetails;
}

/**
 * Result of a registration attempt.
 * Discriminated union: either accepted or rejected.
 */
export type RegistrationResult =
  | {
      readonly kind: "accepted";
      /** ID of the newly registered State */
      readonly stateId: StateID;
      /** Position in the total ordering */
      readonly orderIndex: number;
      /** IDs of invariants that were checked */
      readonly appliedInvariants: readonly string[];
    }
  | {
      readonly kind: "rejected";
      /** All invariant violations that caused rejection */
      readonly violations: readonly InvariantViolation[];
    };

/**
 * Result of validating a State or Transition without registering it.
 */
export interface ValidationReport {
  /** Whether all invariants passed */
  readonly valid: boolean;

  /** All violations found (empty if valid) */
  readonly violations: readonly InvariantViolation[];
}

/**
 * Descriptor for an invariant, used by listInvariants().
 * Excludes the predicate function for serialization safety.
 */
export interface InvariantDescriptor {
  readonly id: string;
  readonly scope: InvariantScope;
  readonly appliesTo: readonly string[];
  readonly failureMode: FailureMode;
  readonly description: string;
}

// =============================================================================
// Lineage
// =============================================================================

/**
 * Trace of State ancestry.
 * Ordered from most recent to root.
 */
export type LineageTrace = readonly StateID[];
