/**
 * Invariant violation enrichment (D1-B-001).
 *
 * Historically every InvariantViolation message was the static
 * `Invariant.description` — the stable rule text, with no offending values. A
 * caller debugging a rejection learned *which* rule fired but not *what* broke
 * it. This module enriches a violation with:
 *
 * - a `message` that interpolates the concrete offending operands into the rule
 *   text (e.g. `"state.identity.immutable: to.id 'B' must equal from 'A'"`),
 * - a structured `details` object naming `field` / `expected` / `actual`.
 *
 * It is deliberately ENGINE-AGNOSTIC: both the legacy predicate engine and the
 * registry AST engine call the same {@link enrichViolation} with a normalized
 * snapshot of the operands they already have in scope, so the two engines
 * produce identical enrichment and dual-witness parity is preserved.
 *
 * Design rules (inherited from the stack):
 * - Pure: no side effects, no I/O.
 * - The stable rule text (`description`) is never mutated — it stays available
 *   on the invariant for callers that want the value-free form.
 * - `details` carries diagnostic operands (ids, indices); it is NOT a metric
 *   label set, so it is not subject to the low-cardinality telemetry rule.
 */

import type { InvariantViolationDetails, StateID } from "./types.js";

/**
 * Normalized operands an enricher may inspect, assembled by whichever engine is
 * evaluating. Every field is optional because different scopes know different
 * things (a pure state validation has no registration context).
 */
export interface ViolationOperands {
  /** transition.from (parent id), or null for a root transition. */
  readonly from?: StateID | null;
  /** transition.to.id (the proposed state's id). */
  readonly toId?: StateID;
  /** Whether transition.to declares structure.isRoot === true. */
  readonly isRoot?: boolean;
  /**
   * Whether the parent id (`from`) is present in the live frontier. Only known
   * in registration scope; undefined otherwise.
   */
  readonly parentRegistered?: boolean;
  /**
   * Whether `toId` already exists in the live frontier. Only known in
   * registration scope; undefined otherwise.
   */
  readonly idAlreadyRegistered?: boolean;
  /** The order index that would be assigned. Only known in registration scope. */
  readonly orderIndex?: number;
}

/**
 * The enriched verdict text for a single violation.
 */
export interface EnrichedViolation {
  /** Value-interpolated, human-readable message. */
  readonly message: string;
  /** Structured offending operands, when known. */
  readonly details?: InvariantViolationDetails;
}

/**
 * Build the enriched `{ message, details }` for a violated invariant.
 *
 * `description` is the stable rule text and is always used as the fallback
 * message. When the operands for a recognized invariant id are present, a richer
 * message and a `details` object are produced.
 *
 * @param invariantId - the violated invariant's id (same vocabulary in both engines)
 * @param description - the stable rule text (`Invariant.description`)
 * @param operands - normalized operands the evaluating engine had in scope
 */
export function enrichViolation(
  invariantId: string,
  description: string,
  operands: ViolationOperands
): EnrichedViolation {
  // Default: keep the legacy behavior — message is the rule text, no details.
  const fallback: EnrichedViolation = {
    message: `Invariant violation: ${description}`,
  };

  switch (invariantId) {
    case "state.identity.immutable": {
      // to.id must equal from (the parent's id) for non-root transitions.
      if (operands.toId === undefined || operands.from === undefined) {
        return fallback;
      }
      const details: InvariantViolationDetails = {
        field: "to.id",
        expected: operands.from,
        actual: operands.toId,
      };
      return {
        message: `state.identity.immutable: to.id '${String(
          operands.toId
        )}' must equal from '${String(operands.from)}'`,
        details,
      };
    }

    case "state.identity.explicit": {
      // A non-empty string id is required.
      const details: InvariantViolationDetails = {
        field: "id",
        expected: "non-empty string",
        actual: operands.toId,
      };
      return {
        message: `state.identity.explicit: id must be a non-empty string, got ${describeValue(
          operands.toId
        )}`,
        details,
      };
    }

    case "state.identity.unique": {
      if (operands.toId === undefined) return fallback;
      const details: InvariantViolationDetails = {
        field: "to.id",
        expected: "unregistered id",
        actual: operands.toId,
      };
      return {
        message: `state.identity.unique: id '${String(
          operands.toId
        )}' is already registered`,
        details,
      };
    }

    case "state.lineage.explicit": {
      // Root iff from === null. A contradiction is either:
      //  - from === null but isRoot !== true, or
      //  - from !== null but isRoot === true.
      if (operands.from === undefined || operands.isRoot === undefined) {
        return fallback;
      }
      const hasParent = operands.from !== null;
      const details: InvariantViolationDetails = {
        field: "structure.isRoot",
        expected: hasParent ? false : true,
        actual: operands.isRoot,
      };
      const reason = hasParent
        ? `non-root transition (from '${String(
            operands.from
          )}') must not declare isRoot=true`
        : `root transition (from=null) must declare isRoot=true`;
      return {
        message: `state.lineage.explicit: ${reason}`,
        details,
      };
    }

    case "state.lineage.parent_exists": {
      if (operands.from === undefined || operands.from === null) {
        return fallback;
      }
      const details: InvariantViolationDetails = {
        field: "from",
        expected: "registered parent id",
        actual: operands.from,
      };
      return {
        message: `state.lineage.parent_exists: parent '${String(
          operands.from
        )}' is not registered`,
        details,
      };
    }

    case "state.lineage.continuous": {
      if (operands.from === undefined || operands.from === null) {
        return fallback;
      }
      const details: InvariantViolationDetails = {
        field: "from",
        expected: "registered parent id (unbroken lineage)",
        actual: operands.from,
      };
      return {
        message: `state.lineage.continuous: lineage broken — parent '${String(
          operands.from
        )}' is not registered`,
        details,
      };
    }

    case "ordering.monotonic":
    case "ordering.total": {
      if (operands.orderIndex === undefined) return fallback;
      const details: InvariantViolationDetails = {
        field: "orderIndex",
        expected: ">= 0",
        actual: operands.orderIndex,
      };
      return {
        message: `${invariantId}: order index ${operands.orderIndex} is not a valid monotonic index`,
        details,
      };
    }

    default:
      return fallback;
  }
}

/**
 * Describe a value compactly for a message, quoting strings and naming
 * null/undefined explicitly.
 */
function describeValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return `'${value}'`;
  return String(value);
}
