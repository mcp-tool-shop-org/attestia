/**
 * Structural Registrar Implementation
 *
 * The constitutional component that validates and orders State Transitions.
 *
 * Design rules:
 * - All methods are pure with respect to content
 * - No method may mutate State directly
 * - No method may adapt behavior over time
 * - No hidden state affecting outcomes
 * - Determinism is mandatory
 *
 * This implementation:
 * - Tracks registered state IDs
 * - Maintains lineage relationships
 * - Enforces all 11 invariants
 * - Produces deterministic ordering
 */

import type {
  State,
  Transition,
  RegistrationResult,
  ValidationReport,
  InvariantDescriptor,
  InvariantScope,
  LineageTrace,
  StateID,
  Invariant,
  InvariantViolation,
  InvariantInput,
} from "./types.js";
import type { Registrar } from "./registrar.js";
import { isState, isTransition } from "./registrar.js";
import { INITIAL_INVARIANTS } from "./invariants.js";
import type { CompiledInvariantRegistry } from "./registry/loader.js";
import { evaluatePredicate } from "./registry/predicate/evaluator.js";
import type { EvaluationContext } from "./registry/predicate/evaluator.js";
import type { RegistrarSnapshotV1 } from "./persistence/snapshot.js";
import {
  SNAPSHOT_VERSION,
  computeLegacyRegistryHash,
  computeRegistryHash,
} from "./persistence/snapshot.js";
import {
  rehydrate,
  type RehydrationOptions,
} from "./persistence/rehydrator.js";

/**
 * Registrar mode.
 *
 * - "registry": Use compiled registry DSL from invariants/registry.json
 *   (constructor default; single-witness escape hatch).
 * - "legacy": Use TypeScript predicates from src/invariants.ts (single-witness
 *   secondary witness; escape hatch).
 * - "dual": Run BOTH engines on every register()/validate(), compare normalized
 *   outcomes, and HALT fail-closed on any divergence. This is the recommended
 *   production mode — see {@link StructuralRegistrar.dualWitness}. The registry
 *   engine is the authoritative result on agreement.
 *
 * As of Phase H, registry is the constitutional authority. Dual mode makes the
 * legacy engine an active runtime cross-check rather than a test-only control.
 */
export type RegistrarMode = "legacy" | "registry" | "dual";

/**
 * Parity status between the two witnesses for the most recent operation.
 * - "AGREED": both engines produced identical normalized outcomes.
 * - "HALTED": the engines diverged (surfaced by a thrown ParityViolationError;
 *   retained for attestation/diagnostics).
 */
export type ParityStatus = "AGREED" | "HALTED";

/**
 * Thrown when the registry and legacy witnesses disagree on an outcome.
 *
 * Dual-witness governance is fail-closed: a divergence means the constitution
 * is ambiguous, so the operation HALTS rather than guessing which engine is
 * right. No state is mutated when this is thrown.
 */
export class ParityViolationError extends Error {
  constructor(
    message: string,
    public readonly registryOutcome: string,
    public readonly legacyOutcome: string
  ) {
    super(`[HALT] Dual-witness parity violation: ${message}`);
    this.name = "ParityViolationError";
  }
}

/**
 * Normalized, mutation-free verdict used to compare the two witnesses.
 */
interface NormalizedVerdict {
  readonly kind: "accepted" | "rejected" | "halted";
  /** Sorted invariant IDs that fired (empty for acceptance). */
  readonly invariantIds: readonly string[];
}

/**
 * Internal state entry for a single registered VERSION of a state.
 *
 * Registrum is append-only: a same-id transition (e.g. Doc1 → Doc1) records a
 * NEW version rather than overwriting the prior one. Each version therefore
 * carries a composite `versionKey` (`stateId#orderIndex`) and a `parentKey`
 * pointing at the *specific prior version* it descends from:
 *
 * - Root version            → parentKey = null
 * - Same-id version (v2 of X) → parentKey = the prior version of X
 * - Child of a different id  → parentKey = the latest version of the parent id
 *
 * `parentId` (the StateID of the parent, or null) is retained for the
 * structural snapshot, which projects the live frontier keyed by StateID.
 */
interface RegisteredState {
  readonly id: StateID;
  readonly parentId: StateID | null;
  readonly orderIndex: number;
  /** Composite identity of THIS version: `${id}#${orderIndex}`. */
  readonly versionKey: string;
  /** Composite identity of the immediately preceding version, or null for a root. */
  readonly parentKey: string | null;
}

/**
 * Build the composite version key for a state id at a given order index.
 * Append-only history is keyed by this, never by StateID alone.
 */
function makeVersionKey(id: StateID, orderIndex: number): string {
  return `${id}#${orderIndex}`;
}

/**
 * StructuralRegistrar configuration options.
 */
export interface StructuralRegistrarOptions {
  /**
   * Registrar mode.
   * - "registry": Use compiled registry DSL (constructor default)
   * - "legacy": Use TypeScript predicates (secondary witness)
   * - "dual": Run both engines and halt on divergence (recommended for
   *   production; prefer {@link StructuralRegistrar.dualWitness}).
   */
  readonly mode?: RegistrarMode;

  /**
   * Legacy invariants (used when mode is "legacy" or "dual").
   */
  readonly invariants?: readonly Invariant[];

  /**
   * Compiled registry (required when mode is "registry" or "dual").
   */
  readonly compiledRegistry?: CompiledInvariantRegistry;
}

/**
 * Options for constructing a dual-witness registrar.
 */
export interface DualWitnessOptions {
  /** Compiled registry (the authoritative engine on agreement). Required. */
  readonly compiledRegistry: CompiledInvariantRegistry;
  /**
   * Legacy invariants used as the secondary witness.
   * Defaults to the canonical INITIAL_INVARIANTS.
   */
  readonly invariants?: readonly Invariant[];
}

/**
 * StructuralRegistrar — The constitutional Registrar implementation.
 *
 * This class implements the constitutional Registrar interface with:
 * - In-memory state tracking (no persistence)
 * - All 11 invariants from INVARIANTS.md
 * - Deterministic ordering
 * - Explicit failure surfacing
 *
 * Mode Support:
 * - "registry" (constructor default): compiled registry DSL evaluation
 * - "legacy": TypeScript predicate functions (secondary witness)
 * - "dual": runs BOTH engines on every register()/validate() and HALTS
 *   fail-closed on divergence — see {@link StructuralRegistrar.dualWitness}.
 *
 * Both engines are proven equivalent via parity testing. In dual mode that
 * equivalence is ENFORCED AT RUNTIME: any disagreement throws a
 * ParityViolationError and mutates nothing (fail-closed). The single-witness
 * modes are the documented escape hatch.
 */
export class StructuralRegistrar implements Registrar {
  /**
   * Append-only history of every accepted version, keyed by composite
   * versionKey (`stateId#orderIndex`). This is the source of truth for
   * lineage traversal. Entries are NEVER mutated or removed.
   */
  private readonly versionsByKey: Map<string, RegisteredState> = new Map();

  /**
   * Latest accepted version for each StateID.
   * Key: StateID, Value: most-recent RegisteredState.
   *
   * This is the live "frontier" used for invariant evaluation (id existence)
   * and for the structural snapshot. Updating it on a same-id transition does
   * NOT lose history — the prior version remains in `versionsByKey`.
   */
  private readonly latestById: Map<StateID, RegisteredState> = new Map();

  /**
   * Current order index (monotonically increasing).
   */
  private currentOrderIndex: number = 0;

  /**
   * Operating mode.
   */
  private readonly mode: RegistrarMode;

  /**
   * Active invariants (legacy mode).
   */
  private readonly invariants: readonly Invariant[];

  /**
   * Compiled registry (registry mode).
   */
  private readonly compiledRegistry: CompiledInvariantRegistry | null;

  /**
   * Parity status of the most recent register()/validate() in dual mode.
   * Reflects the ACTUAL witness comparison (not an input). Null until the
   * first dual-mode operation; remains null in single-witness modes.
   */
  private lastParityStatus: ParityStatus | null = null;

  constructor(options: StructuralRegistrarOptions = {}) {
    this.mode = options.mode ?? "registry";
    this.invariants = options.invariants ?? INITIAL_INVARIANTS;
    this.compiledRegistry = options.compiledRegistry ?? null;

    // Validate registry mode has required registry
    if (this.mode === "registry" && !this.compiledRegistry) {
      throw new Error(
        "StructuralRegistrar: registry mode requires compiledRegistry option"
      );
    }

    // Dual mode needs both witnesses.
    if (this.mode === "dual" && !this.compiledRegistry) {
      throw new Error(
        "StructuralRegistrar: dual mode requires compiledRegistry option"
      );
    }
  }

  /**
   * Construct a fail-closed DUAL-WITNESS registrar (recommended for production).
   *
   * Every register()/validate() runs both the registry AST engine and the
   * legacy predicate engine, compares normalized outcomes, and HALTS
   * (ParityViolationError, fail-closed) on any divergence. On agreement the
   * registry engine's result is authoritative and state mutates exactly once.
   *
   * Single-witness "registry"/"legacy" modes remain available as a documented
   * escape hatch for diagnostics and migration.
   *
   * @param options - compiledRegistry (required) + optional legacy invariants
   */
  static dualWitness(options: DualWitnessOptions): StructuralRegistrar {
    return new StructuralRegistrar({
      mode: "dual",
      compiledRegistry: options.compiledRegistry,
      invariants: options.invariants ?? INITIAL_INVARIANTS,
    });
  }

  // =========================================================================
  // Static Factory Methods
  // =========================================================================

  /**
   * Rehydrate a registrar from a snapshot.
   *
   * Reconstructs the registrar exactly as it was, or fails completely.
   *
   * Failure modes (all throw):
   * - Invalid snapshot schema → SnapshotValidationError
   * - Registry hash mismatch → RegistryMismatchError
   * - Mode mismatch → ModeMismatchError
   *
   * No partial recovery. No warnings. No fallback.
   *
   * @param snapshot - Raw snapshot data (will be validated)
   * @param options - Rehydration options (mode, invariants, compiledRegistry)
   * @returns A new StructuralRegistrar with reconstructed state
   */
  static fromSnapshot(
    snapshot: unknown,
    options: RehydrationOptions
  ): StructuralRegistrar {
    // Rehydrate state (validates and throws on error)
    const rehydratedState = rehydrate(snapshot, options);

    // Create registrar with same options
    const registrar = new StructuralRegistrar({
      mode: options.mode,
      ...(options.invariants !== undefined ? { invariants: options.invariants } : {}),
      ...(options.compiledRegistry !== undefined ? { compiledRegistry: options.compiledRegistry } : {}),
    });

    // Inject rehydrated state
    registrar.injectRehydratedState(rehydratedState);

    return registrar;
  }

  /**
   * Inject rehydrated state into the registrar.
   * Private method used by fromSnapshot.
   *
   * The snapshot projects the live frontier (latest version per StateID). On
   * rehydration we restore that frontier and seed the append-only history with
   * those frontier versions. Deep history before the snapshot is reconstructed
   * by replay (the transition log), not by the snapshot — the snapshot exists
   * to resume acceptance, not to re-derive ancestry.
   */
  private injectRehydratedState(state: {
    registry: Map<
      StateID,
      { id: StateID; parentId: StateID | null; orderIndex: number }
    >;
    currentOrderIndex: number;
  }): void {
    this.versionsByKey.clear();
    this.latestById.clear();

    for (const [id, entry] of state.registry) {
      const versionKey = makeVersionKey(entry.id, entry.orderIndex);
      const restored: RegisteredState = {
        id: entry.id,
        parentId: entry.parentId,
        orderIndex: entry.orderIndex,
        versionKey,
        // Frontier-only restoration: the prior version (if any) is not in the
        // snapshot, so the restored frontier version has no in-memory parent
        // link. Lineage depth is re-established by replay.
        parentKey: null,
      };
      this.versionsByKey.set(versionKey, restored);
      this.latestById.set(id, restored);
    }

    // Set order index
    (this as unknown as { currentOrderIndex: number }).currentOrderIndex =
      state.currentOrderIndex;
  }

  /**
   * Register a proposed Transition.
   *
   * Behavior:
   * - Validates transition against all applicable invariants
   * - Enforces ordering rules
   * - Produces a deterministic outcome
   *
   * Returns:
   * - Acceptance with stateId, orderIndex, and appliedInvariants
   * - Rejection with all violations
   */
  register(transition: Transition): RegistrationResult {
    // Delegate to mode-specific implementation
    if (this.mode === "dual") {
      return this.registerWithDualWitness(transition);
    }
    if (this.mode === "registry") {
      return this.registerWithRegistry(transition);
    }
    return this.registerWithLegacy(transition);
  }

  /**
   * Register under fail-closed DUAL-WITNESS governance.
   *
   * Runs both engines WITHOUT mutating, compares their normalized verdicts,
   * and:
   * - HALTS (throws ParityViolationError) if they diverge — no state changes.
   * - On agreement, sets parity_status = AGREED and either appends the new
   *   version (if accepted) or returns the registry engine's rejection.
   *
   * Mutation happens exactly once (via acceptTransition), never per-engine.
   */
  private registerWithDualWitness(
    transition: Transition
  ): RegistrationResult {
    const registry = this.evaluateRegistryRegistration(transition);
    const legacy = this.evaluateLegacyRegistration(transition);

    this.assertParity(registry.verdict, legacy.verdict, "register");

    // Witnesses agree.
    this.lastParityStatus = "AGREED";

    if (registry.verdict.kind === "accepted") {
      return this.acceptTransition(transition, registry.appliedInvariants);
    }
    // Agreed rejection/halt — return the authoritative (registry) result.
    return registry.result;
  }

  /**
   * Register using legacy TypeScript predicates.
   */
  private registerWithLegacy(transition: Transition): RegistrationResult {
    const { verdict, result, appliedInvariants } =
      this.evaluateLegacyRegistration(transition);
    if (verdict.kind === "accepted") {
      return this.acceptTransition(transition, appliedInvariants);
    }
    return result;
  }

  /**
   * Register using compiled registry DSL.
   */
  private registerWithRegistry(transition: Transition): RegistrationResult {
    const { verdict, result, appliedInvariants } =
      this.evaluateRegistryRegistration(transition);
    if (verdict.kind === "accepted") {
      return this.acceptTransition(transition, appliedInvariants);
    }
    return result;
  }

  /**
   * Evaluate a registration against the LEGACY engine WITHOUT mutating.
   * Returns the normalized verdict (for parity comparison), the would-be
   * RegistrationResult, and the applied invariant IDs.
   */
  private evaluateLegacyRegistration(transition: Transition): {
    verdict: NormalizedVerdict;
    result: RegistrationResult;
    appliedInvariants: string[];
  } {
    const violations: InvariantViolation[] = [];
    const appliedInvariants: string[] = [];
    let shouldHalt = false;

    const registrationInput: InvariantInput = {
      kind: "registration",
      transition,
      registeredStateIds: new Set(this.latestById.keys()),
      currentOrderIndex: this.currentOrderIndex,
    };
    const transitionInput: InvariantInput = { kind: "transition", transition };
    const stateInput: InvariantInput = { kind: "state", state: transition.to };

    for (const invariant of this.invariants) {
      appliedInvariants.push(invariant.id);

      let input: InvariantInput;
      switch (invariant.scope) {
        case "state":
          input = stateInput;
          break;
        case "transition":
          input = transitionInput;
          break;
        case "registration":
          input = registrationInput;
          break;
        default:
          input = registrationInput;
      }

      if (!invariant.predicate(input)) {
        const classification =
          invariant.failureMode === "halt" ? "HALT" : "REJECT";
        violations.push({
          invariantId: invariant.id,
          classification,
          message: `Invariant violation: ${invariant.description}`,
        });
        if (invariant.failureMode === "halt") shouldHalt = true;
      }
    }

    return this.buildRegistrationOutcome(
      violations,
      shouldHalt,
      appliedInvariants,
      transition
    );
  }

  /**
   * Evaluate a registration against the REGISTRY engine WITHOUT mutating.
   */
  private evaluateRegistryRegistration(transition: Transition): {
    verdict: NormalizedVerdict;
    result: RegistrationResult;
    appliedInvariants: string[];
  } {
    const registry = this.compiledRegistry!;
    const violations: InvariantViolation[] = [];
    const appliedInvariants: string[] = [];
    let shouldHalt = false;

    const context = this.buildEvaluationContext(transition);

    for (const invariant of registry.invariants) {
      appliedInvariants.push(invariant.id);

      if (!evaluatePredicate(invariant.ast, context)) {
        const classification =
          invariant.failure_mode === "halt" ? "HALT" : "REJECT";
        violations.push({
          invariantId: invariant.id,
          classification,
          message: `Invariant violation: ${invariant.description}`,
        });
        if (invariant.failure_mode === "halt") shouldHalt = true;
      }
    }

    return this.buildRegistrationOutcome(
      violations,
      shouldHalt,
      appliedInvariants,
      transition
    );
  }

  /**
   * Assemble the verdict + would-be result from accumulated violations.
   * Shared by both engines so their normalized outcomes are comparable.
   */
  private buildRegistrationOutcome(
    violations: InvariantViolation[],
    shouldHalt: boolean,
    appliedInvariants: string[],
    transition: Transition
  ): {
    verdict: NormalizedVerdict;
    result: RegistrationResult;
    appliedInvariants: string[];
  } {
    if (violations.length > 0) {
      const finalViolations = shouldHalt
        ? violations.map((v) =>
            v.classification === "HALT"
              ? { ...v, message: `[HALT] ${v.message}` }
              : v
          )
        : violations;

      const invariantIds = violations.map((v) => v.invariantId).sort();
      return {
        verdict: {
          kind: shouldHalt ? "halted" : "rejected",
          invariantIds,
        },
        result: { kind: "rejected", violations: finalViolations },
        appliedInvariants,
      };
    }

    // Accepted — note the orderIndex is a placeholder; the real index is
    // assigned by acceptTransition when (and only when) the registrar mutates.
    return {
      verdict: { kind: "accepted", invariantIds: [] },
      result: {
        kind: "accepted",
        stateId: transition.to.id,
        orderIndex: this.currentOrderIndex,
        appliedInvariants,
      },
      appliedInvariants,
    };
  }

  /**
   * Compare two normalized witness verdicts and HALT (throw) on divergence.
   * Sets lastParityStatus to HALTED before throwing for diagnostics.
   */
  private assertParity(
    registry: NormalizedVerdict,
    legacy: NormalizedVerdict,
    operation: string
  ): void {
    const sameKind = registry.kind === legacy.kind;
    const sameIds =
      registry.invariantIds.length === legacy.invariantIds.length &&
      registry.invariantIds.every((id, i) => id === legacy.invariantIds[i]);

    if (!sameKind || !sameIds) {
      this.lastParityStatus = "HALTED";
      const fmt = (v: NormalizedVerdict) =>
        `${v.kind}${v.invariantIds.length ? `[${v.invariantIds.join(",")}]` : ""}`;
      throw new ParityViolationError(
        `${operation}: registry=${fmt(registry)} vs legacy=${fmt(legacy)}`,
        fmt(registry),
        fmt(legacy)
      );
    }
  }

  /**
   * Accept a transition and register the state.
   * Common path for both legacy and registry modes.
   */
  private acceptTransition(
    transition: Transition,
    appliedInvariants: string[]
  ): RegistrationResult {
    const orderIndex = this.currentOrderIndex;
    this.currentOrderIndex += 1;

    const id = transition.to.id;
    const versionKey = makeVersionKey(id, orderIndex);

    // Resolve the parent VERSION this transition descends from:
    // - root (from === null)                → no parent version
    // - same-id version transition          → the prior version of this id
    // - child referencing a different id     → the latest version of that id
    let parentKey: string | null = null;
    if (transition.from !== null) {
      const parentFrontier = this.latestById.get(transition.from);
      parentKey = parentFrontier ? parentFrontier.versionKey : null;
    }

    const registeredState: RegisteredState = {
      id,
      parentId: transition.from,
      orderIndex,
      versionKey,
      parentKey,
    };

    // Append-only: record the new version under its unique composite key.
    // An identical versionKey would mean the order index was reused, which the
    // monotonic counter forbids; guard against it as a fail-closed invariant.
    if (this.versionsByKey.has(versionKey)) {
      throw new Error(
        `Append-only violation: version key '${versionKey}' already exists`
      );
    }
    this.versionsByKey.set(versionKey, registeredState);

    // Advance the live frontier for this id. Prior versions remain in history.
    this.latestById.set(id, registeredState);

    return {
      kind: "accepted",
      stateId: id,
      orderIndex,
      appliedInvariants,
    };
  }

  /**
   * Build evaluation context for registry mode.
   */
  private buildEvaluationContext(transition: Transition): EvaluationContext {
    return {
      state: {
        id: transition.to.id,
        structure: transition.to.structure as Record<string, unknown>,
      },
      transition: {
        from: transition.from,
        to: {
          id: transition.to.id,
          structure: transition.to.structure as Record<string, unknown>,
        },
      },
      registry: {
        contains_state: (id: StateID | null) =>
          id !== null && this.latestById.has(id),
        max_order_index: () => this.currentOrderIndex - 1,
        compute_order_index: () => this.currentOrderIndex,
      },
      ordering: {
        index: this.currentOrderIndex,
      },
    };
  }

  /**
   * Validate a State or Transition without registering it.
   *
   * Used for:
   * - Inspection
   * - Testing
   * - Diagnostics
   *
   * Does not modify registrar state.
   */
  validate(target: State | Transition): ValidationReport {
    if (this.mode === "dual") {
      return this.validateWithDualWitness(target);
    }
    if (this.mode === "registry") {
      return this.validateWithRegistry(target);
    }
    return this.validateWithLegacy(target);
  }

  /**
   * Validate under fail-closed DUAL-WITNESS governance.
   *
   * Runs both engines (validate is already non-mutating), compares normalized
   * outcomes (validity + sorted violation IDs), and HALTS on divergence.
   * On agreement, returns the registry engine's report and records AGREED.
   */
  private validateWithDualWitness(
    target: State | Transition
  ): ValidationReport {
    const registryReport = this.validateWithRegistry(target);
    const legacyReport = this.validateWithLegacy(target);

    const toVerdict = (r: ValidationReport): NormalizedVerdict => ({
      kind: r.valid ? "accepted" : "rejected",
      invariantIds: r.violations.map((v) => v.invariantId).sort(),
    });

    this.assertParity(
      toVerdict(registryReport),
      toVerdict(legacyReport),
      "validate"
    );

    this.lastParityStatus = "AGREED";
    return registryReport;
  }

  /**
   * Validate using legacy TypeScript predicates.
   */
  private validateWithLegacy(target: State | Transition): ValidationReport {
    const violations: InvariantViolation[] = [];

    if (isState(target)) {
      // Validate as pure state
      const stateInput: InvariantInput = {
        kind: "state",
        state: target,
      };

      for (const invariant of this.invariants) {
        if (invariant.scope === "state") {
          const passed = invariant.predicate(stateInput);
          if (!passed) {
            violations.push({
              invariantId: invariant.id,
              classification: invariant.failureMode === "halt" ? "HALT" : "REJECT",
              message: `Invariant violation: ${invariant.description}`,
            });
          }
        }
      }
    } else if (isTransition(target)) {
      // Validate as transition (without registration context)
      const transitionInput: InvariantInput = {
        kind: "transition",
        transition: target,
      };

      // Also validate the target state
      const stateInput: InvariantInput = {
        kind: "state",
        state: target.to,
      };

      for (const invariant of this.invariants) {
        let input: InvariantInput | null = null;

        if (invariant.scope === "state") {
          input = stateInput;
        } else if (invariant.scope === "transition") {
          input = transitionInput;
        }
        // Skip registration-scope invariants for pure validation

        if (input) {
          const passed = invariant.predicate(input);
          if (!passed) {
            violations.push({
              invariantId: invariant.id,
              classification: invariant.failureMode === "halt" ? "HALT" : "REJECT",
              message: `Invariant violation: ${invariant.description}`,
            });
          }
        }
      }
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  }

  /**
   * Validate using compiled registry DSL.
   */
  private validateWithRegistry(target: State | Transition): ValidationReport {
    const registry = this.compiledRegistry!;
    const violations: InvariantViolation[] = [];

    if (isState(target)) {
      const context = this.buildStateValidationContext(target);

      for (const invariant of registry.invariants) {
        if (invariant.scope !== "state") continue;

        const passed = evaluatePredicate(invariant.ast, context);
        if (!passed) {
          violations.push({
            invariantId: invariant.id,
            classification: invariant.failure_mode === "halt" ? "HALT" : "REJECT",
            message: `Invariant violation: ${invariant.description}`,
          });
        }
      }
    } else if (isTransition(target)) {
      const context = this.buildTransitionValidationContext(target);

      for (const invariant of registry.invariants) {
        if (invariant.scope !== "state" && invariant.scope !== "transition") {
          continue;
        }

        const passed = evaluatePredicate(invariant.ast, context);
        if (!passed) {
          violations.push({
            invariantId: invariant.id,
            classification: invariant.failure_mode === "halt" ? "HALT" : "REJECT",
            message: `Invariant violation: ${invariant.description}`,
          });
        }
      }
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  }

  /**
   * Build evaluation context for state validation.
   */
  private buildStateValidationContext(state: State): EvaluationContext {
    return {
      state: {
        id: state.id,
        structure: state.structure as Record<string, unknown>,
      },
      transition: {
        from: null,
        to: {
          id: state.id,
          structure: state.structure as Record<string, unknown>,
        },
      },
      registry: {
        contains_state: (id: StateID | null) =>
          id !== null && this.latestById.has(id),
        max_order_index: () => this.currentOrderIndex - 1,
        compute_order_index: () => this.currentOrderIndex,
      },
      ordering: null,
    };
  }

  /**
   * Build evaluation context for transition validation.
   */
  private buildTransitionValidationContext(
    transition: Transition
  ): EvaluationContext {
    return {
      state: {
        id: transition.to.id,
        structure: transition.to.structure as Record<string, unknown>,
      },
      transition: {
        from: transition.from,
        to: {
          id: transition.to.id,
          structure: transition.to.structure as Record<string, unknown>,
        },
      },
      registry: {
        contains_state: (id: StateID | null) =>
          id !== null && this.latestById.has(id),
        max_order_index: () => this.currentOrderIndex - 1,
        compute_order_index: () => this.currentOrderIndex,
      },
      ordering: null,
    };
  }

  /**
   * Return active invariants, optionally filtered by scope.
   *
   * Returns descriptors (without predicates) for safe serialization.
   * External tools can use this to display invariants without coupling to internals.
   *
   * @param scope - Optional filter to return only invariants of a specific scope
   */
  listInvariants(scope?: InvariantScope): readonly InvariantDescriptor[] {
    if (this.mode === "registry") {
      const invariants = this.compiledRegistry!.invariants;
      const filtered = scope
        ? invariants.filter((inv) => inv.scope === scope)
        : invariants;

      return filtered.map((inv) => ({
        id: inv.id,
        scope: inv.scope,
        appliesTo: inv.applies_to,
        failureMode: inv.failure_mode,
        description: inv.description,
      }));
    }

    const filtered = scope
      ? this.invariants.filter((inv) => inv.scope === scope)
      : this.invariants;

    return filtered.map((inv) => ({
      id: inv.id,
      scope: inv.scope,
      appliesTo: inv.appliesTo,
      failureMode: inv.failureMode,
      description: inv.description,
    }));
  }

  /**
   * Return the traceable ancestry of a State.
   *
   * Returns StateIDs from the given state to root (most recent first).
   * Returns empty array if state is not registered.
   */
  getLineage(stateId: StateID): LineageTrace {
    const lineage: StateID[] = [];
    const visited = new Set<string>();

    // Start at the latest version of the requested id and walk the
    // append-only version chain via parentKey (newest → root). Same-id
    // version transitions therefore appear as repeated StateIDs, one per
    // version, rather than collapsing to a single entry.
    let current = this.latestById.get(stateId) ?? null;

    while (current !== null) {
      // Defensive cycle guard (the append-only key space cannot cycle, but a
      // corrupt rehydration must never hang the trace).
      if (visited.has(current.versionKey)) {
        break;
      }
      visited.add(current.versionKey);

      lineage.push(current.id);

      current =
        current.parentKey !== null
          ? this.versionsByKey.get(current.parentKey) ?? null
          : null;
    }

    return lineage;
  }

  /**
   * Resolve the cross-id parent StateID for a frontier version, for use in the
   * id-keyed snapshot lineage.
   *
   * Walks the version chain backward, skipping same-id ancestors (which are
   * just earlier versions of the same state), and returns the first parent
   * whose id differs — or null if the chain originates at a born-root. This
   * guarantees the snapshot lineage is acyclic and root-reachable.
   */
  private resolveSnapshotParentId(entry: RegisteredState): StateID | null {
    const id = entry.id;
    const visited = new Set<string>();
    let current: RegisteredState | null = entry;

    while (current !== null) {
      if (visited.has(current.versionKey)) {
        break; // defensive: cannot happen for append-only keys
      }
      visited.add(current.versionKey);

      // A different parent id is the genuine cross-id ancestor.
      if (current.parentId !== null && current.parentId !== id) {
        return current.parentId;
      }
      // parentId === null → this version is a born-root of the chain.
      if (current.parentId === null) {
        return null;
      }
      // parentId === id → step to the prior same-id version and keep looking.
      current =
        current.parentKey !== null
          ? this.versionsByKey.get(current.parentKey) ?? null
          : null;
    }

    return null;
  }

  // =========================================================================
  // Persistence (Phase E)
  // =========================================================================

  /**
   * Create a snapshot of the current registrar state.
   *
   * The snapshot contains all structural information needed to
   * reconstruct the registrar exactly, and nothing more.
   *
   * Guarantees:
   * - No semantic data included
   * - No derived metrics
   * - No caches or summaries
   * - Deterministic output
   */
  snapshot(): RegistrarSnapshotV1 {
    // Project the live frontier (latest version per StateID) in canonical
    // order (by orderIndex). The snapshot is a structural projection of the
    // current state set; deep version history is replayed from the transition
    // log, not serialized here.
    const entries = Array.from(this.latestById.values());
    entries.sort((a, b) => a.orderIndex - b.orderIndex);
    const stateIds = entries.map((e) => e.id);

    // Build lineage map.
    //
    // The snapshot lineage is keyed by StateID, so it expresses CROSS-ID
    // ancestry (id → parent id), not the per-version chain. A same-id version
    // transition records `parentId === id` internally; emitting that verbatim
    // would create a self-loop in the id-keyed map (id → itself), which is not
    // root-reachable. Resolve each frontier entry to its genuine cross-id
    // parent by walking its version chain back to the first version with a
    // different parent id (or null for a born-root). The result is acyclic and
    // root-reachable by construction.
    const lineage: Record<StateID, StateID | null> = {};
    for (const entry of entries) {
      lineage[entry.id] = this.resolveSnapshotParentId(entry);
    }

    // Build ordering map
    const assigned: Record<StateID, number> = {};
    for (const entry of entries) {
      assigned[entry.id] = entry.orderIndex;
    }

    // Compute registry hash. Registry AND dual modes are registry-authoritative,
    // so both emit the content-addressed registry hash (dual on agreement is the
    // registry engine's verdict). Only single-witness legacy mode uses the
    // id-list legacy hash. This keeps the dual snapshot rehydratable under the
    // same constitutional-drift guard as registry mode.
    const registryHash =
      this.mode === "registry" || this.mode === "dual"
        ? computeRegistryHash(this.compiledRegistry!)
        : computeLegacyRegistryHash(this.invariants.map((i) => i.id));

    return {
      version: SNAPSHOT_VERSION,
      registry_hash: registryHash,
      mode: this.mode,
      state_ids: stateIds,
      lineage,
      ordering: {
        max_index: this.currentOrderIndex - 1,
        assigned,
      },
    };
  }

  // =========================================================================
  // Internal inspection methods (for testing only)
  // =========================================================================

  /**
   * Get count of distinct registered state IDs (the live frontier size).
   * For testing purposes only.
   */
  getRegisteredCount(): number {
    return this.latestById.size;
  }

  /**
   * Get the total number of accepted versions across all states
   * (append-only history length). For testing purposes only.
   */
  getVersionCount(): number {
    return this.versionsByKey.size;
  }

  /**
   * Check if a state ID is registered (has at least one version).
   * For testing purposes only.
   */
  isRegistered(stateId: StateID): boolean {
    return this.latestById.has(stateId);
  }

  /**
   * Get current order index.
   * For testing purposes only.
   */
  getCurrentOrderIndex(): number {
    return this.currentOrderIndex;
  }

  /**
   * Get current operating mode.
   * For testing purposes only.
   */
  getMode(): RegistrarMode {
    return this.mode;
  }

  /**
   * Parity status of the most recent dual-witness operation.
   *
   * This is the ACTUAL result of comparing the two witnesses — not a value
   * supplied by the caller. It is:
   * - "AGREED" after a dual-mode register()/validate() in which both engines
   *   produced identical normalized outcomes,
   * - "HALTED" if the last dual operation diverged (the matching
   *   ParityViolationError was also thrown),
   * - null in single-witness modes, or before the first dual operation.
   *
   * Attestation should derive `parity_status` from this rather than accept it
   * as input.
   */
  getLastParityStatus(): ParityStatus | null {
    return this.lastParityStatus;
  }
}
