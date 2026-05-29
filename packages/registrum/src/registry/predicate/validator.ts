/**
 * Registrum Predicate Validator
 *
 * Performs static safety validation on predicate ASTs.
 *
 * Rejects predicates that:
 * - Reference forbidden symbols
 * - Reference forbidden fields (semantic access)
 * - Use forbidden operators
 * - Exceed depth limits
 * - Introduce unknown functions
 *
 * If validation fails, the invariant is rejected BEFORE execution.
 */

import type { ASTNode } from "./ast.js";

/**
 * Validation error class.
 *
 * Raised when a predicate AST is statically unsafe (forbidden symbol, semantic
 * field access, depth limit, etc.). `code` is the stable identifier
 * `"PREDICATE_UNSAFE"` from the registrum error vocabulary.
 */
export class ValidationError extends Error {
  /** Stable error code: `"PREDICATE_UNSAFE"`. */
  readonly code = "PREDICATE_UNSAFE" as const;

  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Allowed root identifiers.
 */
const ALLOWED_ROOTS = new Set([
  "state",
  "transition",
  "registry",
  "ordering",
  "true",
  "false",
  "null",
]);

/**
 * Forbidden path prefixes (semantic access).
 * These paths are compile-time errors.
 */
const FORBIDDEN_PATH_PREFIXES: readonly (readonly string[])[] = [
  ["state", "data"],
  ["state", "content"],
  ["state", "embedding"],
  ["state", "score"],
  ["state", "payload"],
  ["transition", "payload"],
  ["transition", "data"],
];

/**
 * Allowed functions (small, pure, total set).
 */
const ALLOWED_FUNCTIONS = new Set([
  // Type checking functions
  "exists",
  "is_string",
  "is_number",
  "is_boolean",
  "equals",

  // Registry functions
  "registry.contains_state",
  "registry.max_order_index",
  "registry.compute_order_index",
]);

/**
 * Allowed binary operators.
 */
const ALLOWED_OPERATORS = new Set([
  "==",
  "!=",
  ">",
  "<",
  ">=",
  "<=",
  "&&",
  "||",
]);

/**
 * Allowed unary operators.
 */
const ALLOWED_UNARY_OPERATORS = new Set(["!"]);

/**
 * Maximum AST depth.
 */
const MAX_DEPTH = 16;

/**
 * Validate a predicate AST for safety.
 * Throws ValidationError if unsafe.
 */
export function validatePredicate(ast: ASTNode): void {
  walk(ast, 0);
}

/**
 * Walk the AST and validate each node.
 */
function walk(node: ASTNode, depth: number): void {
  if (depth > MAX_DEPTH) {
    throw new ValidationError(
      `Predicate exceeds maximum depth of ${MAX_DEPTH}`
    );
  }

  switch (node.kind) {
    case "Literal":
      validateLiteral(node.value);
      return;

    case "Identifier":
      validateIdentifier(node.path);
      return;

    case "Binary":
      validateBinaryOperator(node.op);
      walk(node.left, depth + 1);
      walk(node.right, depth + 1);
      return;

    case "Unary":
      validateUnaryOperator(node.op);
      walk(node.operand, depth + 1);
      return;

    case "Call":
      validateFunction(node.fn, node.args.length);
      for (const arg of node.args) {
        walk(arg, depth + 1);
      }
      return;

    default:
      // TypeScript exhaustiveness check
      const _exhaustive: never = node;
      throw new ValidationError(`Unknown AST node kind: ${(_exhaustive as ASTNode).kind}`);
  }
}

/**
 * Validate a literal value.
 */
function validateLiteral(value: boolean | number | string | null): void {
  if (value === null) return;
  if (typeof value === "boolean") return;
  if (typeof value === "string") return;
  if (typeof value === "number") {
    // Only allow integers within safe bounds
    if (!Number.isInteger(value)) {
      throw new ValidationError(`Non-integer number literal: ${value}`);
    }
    if (value > Number.MAX_SAFE_INTEGER || value < Number.MIN_SAFE_INTEGER) {
      throw new ValidationError(`Number literal out of safe bounds: ${value}`);
    }
    return;
  }
  throw new ValidationError(`Invalid literal type: ${typeof value}`);
}

/**
 * Validate an identifier path.
 */
function validateIdentifier(path: readonly string[]): void {
  if (path.length === 0) {
    throw new ValidationError("Empty identifier path");
  }

  const root = path[0]!;

  // Check root is allowed
  if (!ALLOWED_ROOTS.has(root)) {
    throw new ValidationError(`Forbidden root identifier: ${root}`);
  }

  // Check for forbidden semantic access
  for (const forbidden of FORBIDDEN_PATH_PREFIXES) {
    if (pathStartsWith(path, forbidden)) {
      throw new ValidationError(
        `Forbidden semantic access: ${path.join(".")}`
      );
    }
  }
}

/**
 * Check if a path starts with a prefix.
 */
function pathStartsWith(
  path: readonly string[],
  prefix: readonly string[]
): boolean {
  if (path.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (path[i] !== prefix[i]) return false;
  }
  return true;
}

/**
 * Validate a binary operator.
 */
function validateBinaryOperator(op: string): void {
  if (!ALLOWED_OPERATORS.has(op)) {
    throw new ValidationError(`Forbidden operator: ${op}`);
  }
}

/**
 * Validate a unary operator.
 */
function validateUnaryOperator(op: string): void {
  if (!ALLOWED_UNARY_OPERATORS.has(op)) {
    throw new ValidationError(`Forbidden unary operator: ${op}`);
  }
}

/**
 * Validate a function call.
 */
function validateFunction(fn: string, arity: number): void {
  if (!ALLOWED_FUNCTIONS.has(fn)) {
    throw new ValidationError(`Forbidden function: ${fn}`);
  }

  // Arity checks for specific functions
  switch (fn) {
    case "exists":
    case "is_string":
    case "is_number":
    case "is_boolean":
      if (arity !== 1) {
        throw new ValidationError(`${fn} requires exactly 1 argument`);
      }
      break;

    case "equals":
      if (arity !== 2) {
        throw new ValidationError(`${fn} requires exactly 2 arguments`);
      }
      break;

    case "registry.contains_state":
      if (arity !== 1) {
        throw new ValidationError(`${fn} requires exactly 1 argument`);
      }
      break;

    case "registry.max_order_index":
      if (arity !== 0) {
        throw new ValidationError(`${fn} requires exactly 0 arguments`);
      }
      break;

    case "registry.compute_order_index":
      if (arity !== 1) {
        throw new ValidationError(`${fn} requires exactly 1 argument`);
      }
      break;
  }
}

/**
 * Validation result type.
 */
export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/**
 * Validate a predicate AST and return a result object.
 * Does not throw.
 */
export function validatePredicateSafe(ast: ASTNode): ValidationResult {
  try {
    validatePredicate(ast);
    return { valid: true, errors: [] };
  } catch (e) {
    if (e instanceof ValidationError) {
      return { valid: false, errors: [e.message] };
    }
    throw e;
  }
}
