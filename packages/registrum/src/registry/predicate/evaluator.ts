/**
 * Registrum Predicate Evaluator
 *
 * Evaluates validated predicate ASTs against a context.
 *
 * Design constraints:
 * - Pure evaluation (no side effects)
 * - No caching
 * - No mutation of context
 * - Fails closed (errors become false)
 */

import type { ASTNode } from "./ast.js";
import type { StateID } from "../../types.js";
import { type Telemetry, NOOP_TELEMETRY } from "@attestia/types";

/**
 * Evaluation context provided to predicates.
 */
export interface EvaluationContext {
  /** Current state being evaluated (transition.to) */
  readonly state: {
    readonly id: StateID;
    readonly structure: Readonly<Record<string, unknown>>;
  };

  /** Current transition being evaluated */
  readonly transition: {
    readonly from: StateID | null;
    readonly to: {
      readonly id: StateID;
      readonly structure: Readonly<Record<string, unknown>>;
    };
  };

  /** Registry context (read-only view) */
  readonly registry: {
    readonly contains_state: (id: StateID | null) => boolean;
    readonly max_order_index: () => number;
    readonly compute_order_index: (transition: unknown) => number;
  };

  /** Ordering context (for registration-scope invariants) */
  readonly ordering: {
    readonly index: number;
  } | null;
}

/**
 * Evaluation error class.
 *
 * Raised internally when a predicate AST cannot be evaluated against a context
 * (e.g. type mismatch in a comparison). `evaluatePredicate` catches these and
 * fails closed (returns `false`); the `code` is the stable identifier
 * `"PREDICATE_EVAL"` from the registrum error vocabulary for callers that
 * inspect a re-thrown or surfaced instance.
 */
export class EvaluationError extends Error {
  /** Stable error code: `"PREDICATE_EVAL"`. */
  readonly code = "PREDICATE_EVAL" as const;

  constructor(message: string) {
    super(message);
    this.name = "EvaluationError";
  }
}

/**
 * Evaluate a predicate AST against a context.
 * Returns boolean result.
 *
 * Fail-closed semantics are UNCHANGED: an {@link EvaluationError} (e.g. a
 * structurally-broken invariant that compares incompatible types) is coerced to
 * `false`, never propagated. Previously that error was silently swallowed,
 * making a broken invariant indistinguishable from a legitimately-false one.
 *
 * D1-B-002 makes the swallow OBSERVABLE: when a `telemetry` sink is supplied and
 * a predicate throws, a `degraded` warn-level event is recorded (op
 * `"predicate.eval"`, low-cardinality `attributes.invariantId`) before returning
 * `false`. The default sink is {@link NOOP_TELEMETRY}, so callers that pass
 * nothing keep the exact prior behavior at zero cost.
 *
 * @param ast - the validated predicate AST
 * @param context - the evaluation context
 * @param telemetry - optional sink for the degraded-eval signal (default no-op)
 * @param invariantId - optional id, emitted as a low-cardinality attribute
 */
export function evaluatePredicate(
  ast: ASTNode,
  context: EvaluationContext,
  telemetry: Telemetry = NOOP_TELEMETRY,
  invariantId?: string
): boolean {
  try {
    const result = evaluate(ast, context);
    return toBoolean(result);
  } catch (e) {
    // Fail closed: errors become false.
    if (e instanceof EvaluationError) {
      // Surface the swallowed error as a degraded telemetry signal so a broken
      // invariant is observable rather than silent. `record` never throws (per
      // the Telemetry contract), so this cannot affect the fail-closed result.
      telemetry.record({
        package: "@attestia/registrum",
        op: "predicate.eval",
        level: "warn",
        outcome: "degraded",
        ...(invariantId !== undefined
          ? { attributes: { invariantId } }
          : {}),
        message: e.message,
      });
      return false;
    }
    throw e;
  }
}

/**
 * Internal evaluation function.
 * Returns the raw value (not necessarily boolean).
 */
function evaluate(node: ASTNode, context: EvaluationContext): unknown {
  switch (node.kind) {
    case "Literal":
      return node.value;

    case "Identifier":
      return resolveIdentifier(node.path, context);

    case "Binary":
      return evaluateBinary(node.op, node.left, node.right, context);

    case "Unary":
      return evaluateUnary(node.op, node.operand, context);

    case "Call":
      return evaluateCall(node.fn, node.args, context);

    default:
      const _exhaustive: never = node;
      throw new EvaluationError(`Unknown node kind: ${(_exhaustive as ASTNode).kind}`);
  }
}

/**
 * Resolve an identifier path in the context.
 */
function resolveIdentifier(
  path: readonly string[],
  context: EvaluationContext
): unknown {
  if (path.length === 0) {
    throw new EvaluationError("Empty identifier path");
  }

  const root = path[0]!;
  let value: unknown;

  switch (root) {
    case "state":
      value = context.state;
      break;
    case "transition":
      value = context.transition;
      break;
    case "registry":
      value = context.registry;
      break;
    case "ordering":
      value = context.ordering;
      break;
    case "true":
      return true;
    case "false":
      return false;
    case "null":
      return null;
    default:
      throw new EvaluationError(`Unknown root identifier: ${root}`);
  }

  // Traverse the path
  for (let i = 1; i < path.length; i++) {
    const key = path[i]!;
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value !== "object") {
      throw new EvaluationError(
        `Cannot access property '${key}' of non-object`
      );
    }
    value = (value as Record<string, unknown>)[key];
  }

  return value;
}

/**
 * Evaluate a binary operation.
 */
function evaluateBinary(
  op: string,
  left: ASTNode,
  right: ASTNode,
  context: EvaluationContext
): unknown {
  // Short-circuit evaluation for && and ||
  if (op === "&&") {
    const leftVal = toBoolean(evaluate(left, context));
    if (!leftVal) return false;
    return toBoolean(evaluate(right, context));
  }

  if (op === "||") {
    const leftVal = toBoolean(evaluate(left, context));
    if (leftVal) return true;
    return toBoolean(evaluate(right, context));
  }

  // Eager evaluation for other operators
  const leftVal = evaluate(left, context);
  const rightVal = evaluate(right, context);

  switch (op) {
    case "==":
      return strictEquals(leftVal, rightVal);
    case "!=":
      return !strictEquals(leftVal, rightVal);
    case ">":
      return compareNumbers(leftVal, rightVal, (a, b) => a > b);
    case "<":
      return compareNumbers(leftVal, rightVal, (a, b) => a < b);
    case ">=":
      return compareNumbers(leftVal, rightVal, (a, b) => a >= b);
    case "<=":
      return compareNumbers(leftVal, rightVal, (a, b) => a <= b);
    default:
      throw new EvaluationError(`Unknown binary operator: ${op}`);
  }
}

/**
 * Evaluate a unary operation.
 */
function evaluateUnary(
  op: string,
  operand: ASTNode,
  context: EvaluationContext
): unknown {
  const val = evaluate(operand, context);

  switch (op) {
    case "!":
      return !toBoolean(val);
    default:
      throw new EvaluationError(`Unknown unary operator: ${op}`);
  }
}

/**
 * Evaluate a function call.
 */
function evaluateCall(
  fn: string,
  args: readonly ASTNode[],
  context: EvaluationContext
): unknown {
  switch (fn) {
    case "exists": {
      const val = evaluate(args[0]!, context);
      return val !== null && val !== undefined;
    }

    case "is_string": {
      const val = evaluate(args[0]!, context);
      return typeof val === "string";
    }

    case "is_number": {
      const val = evaluate(args[0]!, context);
      return typeof val === "number";
    }

    case "is_boolean": {
      const val = evaluate(args[0]!, context);
      return typeof val === "boolean";
    }

    case "equals": {
      const a = evaluate(args[0]!, context);
      const b = evaluate(args[1]!, context);
      return strictEquals(a, b);
    }

    case "registry.contains_state": {
      const id = evaluate(args[0]!, context);
      if (id === null) return false;
      if (typeof id !== "string") {
        throw new EvaluationError(
          `registry.contains_state requires string argument`
        );
      }
      return context.registry.contains_state(id);
    }

    case "registry.max_order_index": {
      return context.registry.max_order_index();
    }

    case "registry.compute_order_index": {
      const transition = evaluate(args[0]!, context);
      return context.registry.compute_order_index(transition);
    }

    default:
      throw new EvaluationError(`Unknown function: ${fn}`);
  }
}

/**
 * Convert a value to boolean.
 */
function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value !== "";
  return true;
}

/**
 * Strict equality comparison.
 */
function strictEquals(a: unknown, b: unknown): boolean {
  // Handle null/undefined
  if (a === null || a === undefined) {
    return b === null || b === undefined;
  }
  if (b === null || b === undefined) {
    return false;
  }

  // Same type comparison
  if (typeof a !== typeof b) return false;

  return a === b;
}

/**
 * Compare two numbers with a comparator function.
 */
function compareNumbers(
  a: unknown,
  b: unknown,
  comparator: (a: number, b: number) => boolean
): boolean {
  if (typeof a !== "number" || typeof b !== "number") {
    throw new EvaluationError(
      `Comparison operators require numeric operands`
    );
  }
  return comparator(a, b);
}
