/**
 * Registry-Driven Registrar
 *
 * A Registrar implementation that evaluates invariants from the compiled
 * registry system (JSON + DSL) rather than TypeScript predicates.
 *
 * Status: EXPERIMENTAL — for parity testing only
 *
 * This class mirrors StructuralRegistrar's behavior but uses:
 * - CompiledInvariantRegistry for invariant definitions
 * - Predicate AST evaluation instead of TS functions
 *
 * Purpose:
 * - Enable behavioral comparison between old and new systems
 * - Prove that registry-based evaluation is equivalent
 * - Surface any divergence explicitly
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
  InvariantViolation,
} from "../types.js";
import type { Registrar } from "../registrar.js";
import { isState, isTransition } from "../registrar.js";
import { AppendOnlyViolationError } from "../structural-registrar.js";
import { enrichViolation } from "../violation-detail.js";
import type { CompiledInvariantRegistry, CompiledInvariant } from "./loader.js";
import { evaluatePredicate } from "./predicate/evaluator.js";
import type { EvaluationContext } from "./predicate/evaluator.js";
import { type Telemetry, NOOP_TELEMETRY } from "@attestia/types";

/**
 * Internal state entry for a single registered VERSION of a state.
 *
 * Mirrors StructuralRegistrar's append-only model so the two engines remain
 * behaviorally equivalent under parity testing: a same-id transition records a
 * new version (with `parentKey` pointing at the prior version) rather than
 * overwriting it.
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
 */
function makeVersionKey(id: StateID, orderIndex: number): string {
  return `${id}#${orderIndex}`;
}

/**
 * RegistryDrivenRegistrar — Experimental Registrar using compiled registry.
 *
 * This class implements the same Registrar interface as StructuralRegistrar
 * but derives its invariant logic from the compiled registry system.
 */
export class RegistryDrivenRegistrar implements Registrar {
  /**
   * Append-only history of every accepted version, keyed by versionKey.
   */
  private readonly versionsByKey: Map<string, RegisteredState> = new Map();

  /**
   * Latest accepted version for each StateID (the live frontier).
   */
  private readonly latestById: Map<StateID, RegisteredState> = new Map();

  /**
   * Current order index (monotonically increasing).
   */
  private currentOrderIndex: number = 0;

  /**
   * Compiled invariant registry.
   */
  private readonly invariantRegistry: CompiledInvariantRegistry;

  /**
   * Observability sink. Defaults to {@link NOOP_TELEMETRY}.
   *
   * Threaded through every evaluatePredicate call (with the invariant id) so a
   * predicate that throws and fails closed to `false` — a structurally-broken
   * invariant that has effectively stopped enforcing its rule — emits the same
   * `degraded` event StructuralRegistrar does. Without this, this registrar
   * (which implements the public Registrar interface and is exported) could run
   * with a silently-broken constitution that looks healthy.
   */
  private readonly telemetry: Telemetry;

  /**
   * @param invariantRegistry - The compiled constitution to evaluate against.
   * @param telemetry - Optional observability sink. Defaults to no-op (silent).
   *
   * NOTE: this registrar is EXPERIMENTAL — its intended use is parity testing
   * against {@link StructuralRegistrar}, not standalone production governance.
   * Prefer StructuralRegistrar.dualWitness for production. The telemetry sink is
   * supported so that if it IS run directly, degraded evaluations are visible.
   */
  constructor(
    invariantRegistry: CompiledInvariantRegistry,
    telemetry: Telemetry = NOOP_TELEMETRY
  ) {
    this.invariantRegistry = invariantRegistry;
    this.telemetry = telemetry;
  }

  /**
   * Register a proposed Transition.
   */
  register(transition: Transition): RegistrationResult {
    const violations: InvariantViolation[] = [];
    const appliedInvariants: string[] = [];
    let shouldHalt = false;

    // Build evaluation context
    const context = this.buildEvaluationContext(transition);

    // Evaluate all invariants
    for (const invariant of this.invariantRegistry.invariants) {
      appliedInvariants.push(invariant.id);

      // Check if invariant applies to this scope
      if (!this.invariantApplies(invariant, transition)) {
        continue;
      }

      // Evaluate the predicate AST. Pass the telemetry sink + invariant id so a
      // predicate that throws and fails closed to false is observable as a
      // `degraded` event (matching StructuralRegistrar), not silently swallowed.
      const passed = evaluatePredicate(
        invariant.ast,
        context,
        this.telemetry,
        invariant.id
      );

      if (!passed) {
        const classification = invariant.failure_mode === "halt" ? "HALT" : "REJECT";
        const enriched = enrichViolation(invariant.id, invariant.description, {
          from: transition.from,
          toId: transition.to.id,
          isRoot: transition.to.structure["isRoot"] === true,
          parentRegistered:
            transition.from !== null && this.latestById.has(transition.from),
          idAlreadyRegistered: this.latestById.has(transition.to.id),
          orderIndex: this.currentOrderIndex,
        });
        violations.push(
          enriched.details !== undefined
            ? {
                invariantId: invariant.id,
                classification,
                message: enriched.message,
                details: enriched.details,
              }
            : {
                invariantId: invariant.id,
                classification,
                message: enriched.message,
              }
        );

        if (invariant.failure_mode === "halt") {
          shouldHalt = true;
        }
      }
    }

    // If any violations, reject
    if (violations.length > 0) {
      if (shouldHalt) {
        const haltViolations = violations.map((v) => {
          if (v.classification === "HALT") {
            return {
              ...v,
              message: `[HALT] ${v.message}`,
            };
          }
          return v;
        });

        return {
          kind: "rejected",
          violations: haltViolations,
        };
      }

      return {
        kind: "rejected",
        violations,
      };
    }

    // All invariants passed — append the new version (append-only).
    const orderIndex = this.currentOrderIndex;
    this.currentOrderIndex += 1;

    const id = transition.to.id;
    const versionKey = makeVersionKey(id, orderIndex);

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

    if (this.versionsByKey.has(versionKey)) {
      throw new AppendOnlyViolationError(versionKey);
    }
    this.versionsByKey.set(versionKey, registeredState);
    this.latestById.set(id, registeredState);

    return {
      kind: "accepted",
      stateId: id,
      orderIndex,
      appliedInvariants,
    };
  }

  /**
   * Validate a State or Transition without registering it.
   */
  validate(target: State | Transition): ValidationReport {
    const violations: InvariantViolation[] = [];

    if (isState(target)) {
      const context = this.buildStateValidationContext(target);

      for (const invariant of this.invariantRegistry.invariants) {
        if (invariant.scope !== "state") continue;

        const passed = evaluatePredicate(
          invariant.ast,
          context,
          this.telemetry,
          invariant.id
        );
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

      for (const invariant of this.invariantRegistry.invariants) {
        if (invariant.scope !== "state" && invariant.scope !== "transition") {
          continue;
        }

        const passed = evaluatePredicate(
          invariant.ast,
          context,
          this.telemetry,
          invariant.id
        );
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
   * Return active invariants, optionally filtered by scope.
   *
   * @param scope - Optional filter to return only invariants of a specific scope
   */
  listInvariants(scope?: InvariantScope): readonly InvariantDescriptor[] {
    const invariants = this.invariantRegistry.invariants;
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

  /**
   * Return the traceable ancestry of a State.
   */
  getLineage(stateId: StateID): LineageTrace {
    const lineage: StateID[] = [];
    const visited = new Set<string>();

    // Walk the append-only version chain from the latest version of the id.
    let current = this.latestById.get(stateId) ?? null;

    while (current !== null) {
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

  // =========================================================================
  // Internal helpers
  // =========================================================================

  /**
   * Check if an invariant applies given the current context.
   */
  private invariantApplies(
    _invariant: CompiledInvariant,
    _transition: Transition
  ): boolean {
    // All invariants are evaluated during registration
    // Scope filtering happens in the context building
    return true;
  }

  /**
   * Build evaluation context for registration.
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

  // =========================================================================
  // Testing helpers
  // =========================================================================

  getRegisteredCount(): number {
    return this.latestById.size;
  }

  getVersionCount(): number {
    return this.versionsByKey.size;
  }

  isRegistered(stateId: StateID): boolean {
    return this.latestById.has(stateId);
  }

  getCurrentOrderIndex(): number {
    return this.currentOrderIndex;
  }
}
