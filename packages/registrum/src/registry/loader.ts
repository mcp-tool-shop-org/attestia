/**
 * Registrum Registry Loader
 *
 * Loads and validates invariant registries from JSON.
 *
 * The loader is the constitutional gatekeeper:
 * - Validates registry schema
 * - Parses predicate expressions
 * - Performs static safety validation
 * - Rejects the entire registry if any invariant is unsafe
 *
 * Failure philosophy:
 * - Partial load is forbidden
 * - Runtime fallback is forbidden
 * - Best-effort parsing is forbidden
 * - If any invariant is invalid → hard failure
 */

import { RegistryError, InvariantDefinitionError } from "./errors.js";
import { parsePredicate, ParseError } from "./predicate/parser.js";
import { validatePredicate, ValidationError } from "./predicate/validator.js";
import type { ASTNode } from "./predicate/ast.js";
import {
  type Telemetry,
  type ObservabilityEvent,
  NOOP_TELEMETRY,
} from "@attestia/types";

// =============================================================================
// Telemetry helper
// =============================================================================

/**
 * Emit a telemetry event, guarding against a misbehaving sink.
 *
 * The {@link Telemetry} contract says `record` MUST NOT throw, but a buggy host
 * sink might. Loading the constitution must never be broken by observability,
 * so a sink error is swallowed — the fail-closed load contract is preserved.
 */
function emit(telemetry: Telemetry, event: ObservabilityEvent): void {
  try {
    telemetry.record(event);
  } catch {
    /* a misbehaving sink must never affect the load verdict — ignored */
  }
}

// =============================================================================
// Types
// =============================================================================

/**
 * Raw invariant registry as loaded from JSON.
 */
export interface RawInvariantRegistry {
  readonly version: string;
  readonly registry_id: string;
  readonly status?: string;
  readonly invariants: readonly RawInvariantDefinition[];
}

/**
 * Raw invariant definition from JSON.
 */
export interface RawInvariantDefinition {
  readonly id: string;
  readonly group: string;
  readonly scope: string;
  readonly description: string;
  readonly applies_to: readonly string[];
  readonly condition: {
    readonly type: string;
    readonly expression: string;
  };
  readonly failure_mode: string;
}

/**
 * Validated and compiled invariant registry.
 */
export interface CompiledInvariantRegistry {
  readonly version: string;
  readonly registry_id: string;
  readonly status: string;
  readonly invariants: readonly CompiledInvariant[];
}

/**
 * Validated and compiled invariant.
 */
export interface CompiledInvariant {
  readonly id: string;
  readonly group: "identity" | "lineage" | "ordering";
  readonly scope: "state" | "transition" | "registration";
  readonly description: string;
  readonly applies_to: readonly string[];
  readonly ast: ASTNode;
  readonly failure_mode: "reject" | "halt";
}

// =============================================================================
// Loader
// =============================================================================

/**
 * Load and compile an invariant registry from raw JSON data.
 *
 * This function:
 * 1. Validates the registry schema
 * 2. Parses each predicate expression into an AST
 * 3. Validates each AST for safety
 * 4. Rejects duplicate invariant ids (constitutional identity is one-id-one-rule)
 * 5. Returns a compiled, immutable registry
 *
 * Throws on any validation error. Does not return partial results.
 *
 * This is the constitutional gatekeeper, so the load event is exactly the kind
 * of operationally-critical point that must be observable: an optional
 * {@link Telemetry} sink (default {@link NOOP_TELEMETRY}) records an `ok` event
 * with the compiled invariant count on success and a `failed` event with the
 * rejected-invariant count on failure. Telemetry NEVER changes the fail-closed
 * load contract — the throw is preserved; the sink only adds a record.
 *
 * @param raw - Raw registry data (typically parsed JSON).
 * @param telemetry - Optional observability sink. Defaults to no-op (silent).
 */
export function loadInvariantRegistry(
  raw: unknown,
  telemetry: Telemetry = NOOP_TELEMETRY
): Readonly<CompiledInvariantRegistry> {
  try {
    // Step 1: Validate top-level schema
    const registry = validateRegistryShape(raw);

    // Step 2: Compile each invariant (parse + validate)
    const compiled: CompiledInvariant[] = [];
    const errors: string[] = [];

    for (const inv of registry.invariants) {
      try {
        const compiledInv = compileInvariant(inv);
        compiled.push(compiledInv);
      } catch (e) {
        if (
          e instanceof ParseError ||
          e instanceof ValidationError ||
          e instanceof InvariantDefinitionError
        ) {
          errors.push(`[${inv.id}] ${e.message}`);
        } else {
          throw e;
        }
      }
    }

    // Step 3: Fail if any invariants failed to compile
    if (errors.length > 0) {
      throw new RegistryError(
        `Registry contains invalid invariants:\n${errors.join("\n")}`
      );
    }

    // Step 4: Reject duplicate invariant ids.
    //
    // The constitution's identity contract is one id = one invariant: a
    // violation's invariantId must uniquely name which rule fired, and the
    // content-addressed registry hash must encode the constitution the author
    // intended. A copy-paste that double-registers an id would silently corrupt
    // all of that (listInvariants returns duplicates, parity compares an id
    // twice, an audit gets an ambiguous "which rule rejected this"). The
    // per-field schema validator never checks the SET of ids, so close that gap
    // here, fail-closed, before freezing.
    const seenIds = new Set<string>();
    const duplicateIds: string[] = [];
    for (const inv of compiled) {
      if (seenIds.has(inv.id)) {
        duplicateIds.push(inv.id);
      } else {
        seenIds.add(inv.id);
      }
    }
    if (duplicateIds.length > 0) {
      // Deduplicate the report itself (an id repeated 3× appears once) and sort
      // for a deterministic, replayable message.
      const reported = [...new Set(duplicateIds)].sort();
      throw new RegistryError(
        `Registry contains duplicate invariant id(s): ${reported.join(", ")}. ` +
          `Each invariant id must be unique — one id identifies exactly one ` +
          `rule. Hint: check registry.json for a copy-pasted invariant whose ` +
          `'id' was not changed.`
      );
    }

    // Step 5: Return frozen registry
    const result = Object.freeze({
      version: registry.version,
      registry_id: registry.registry_id,
      status: registry.status ?? "unknown",
      invariants: Object.freeze(compiled),
    });

    // The constitution loaded: record an ok event with a low-cardinality count
    // so an operator has a metric series for "constitution compiled" (and how
    // many invariants), distinct from any other startup signal.
    emit(telemetry, {
      package: "@attestia/registrum",
      op: "registry.load",
      level: "info",
      outcome: "ok",
      attributes: { invariantCount: result.invariants.length },
    });

    return result;
  } catch (e) {
    // The constitution was REJECTED at load. Emit a failed event so an incident
    // can distinguish "constitution rejected at load" from any other startup
    // crash. errorCount carries the number of rejected invariants when the
    // error reports them (the human detail stays in `message`, never in a
    // low-cardinality attribute). `record` never throws, so this cannot mask
    // the original error, and the throw is re-raised to preserve fail-closed.
    emit(telemetry, {
      package: "@attestia/registrum",
      op: "registry.load",
      level: "error",
      outcome: "failed",
      attributes: { errorCount: countRejectedInvariants(e) },
      message: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

/**
 * Count how many invariants an aggregated RegistryError rejected, for a
 * low-cardinality telemetry attribute. The aggregated "invalid invariants"
 * message lists one rejection per line after a header; any other error
 * contributes 1 (a single load-level failure). Returns 1 as a safe default.
 */
function countRejectedInvariants(e: unknown): number {
  if (e instanceof RegistryError && e.message.includes("invalid invariants")) {
    // Lines after the first (the header) are the per-invariant rejections.
    const lines = e.message.split("\n");
    return Math.max(1, lines.length - 1);
  }
  return 1;
}

// =============================================================================
// Schema Validation
// =============================================================================

/**
 * Validate the registry shape.
 */
function validateRegistryShape(raw: unknown): RawInvariantRegistry {
  if (typeof raw !== "object" || raw === null) {
    throw new RegistryError("Registry must be an object");
  }

  const r = raw as Record<string, unknown>;

  assertString(r["version"], "version");
  assertString(r["registry_id"], "registry_id");
  assertArray(r["invariants"], "invariants");

  const invariants = r["invariants"] as unknown[];
  for (let i = 0; i < invariants.length; i++) {
    validateInvariantShape(invariants[i], `invariants[${i}]`);
  }

  return r as unknown as RawInvariantRegistry;
}

/**
 * Validate an invariant definition shape.
 */
function validateInvariantShape(raw: unknown, path: string): void {
  if (typeof raw !== "object" || raw === null) {
    throw new RegistryError(`${path} must be an object`);
  }

  const inv = raw as Record<string, unknown>;

  assertString(inv["id"], `${path}.id`);
  assertOneOf(inv["group"], ["identity", "lineage", "ordering"], `${path}.group`);
  assertOneOf(
    inv["scope"],
    ["state", "transition", "registration"],
    `${path}.scope`
  );
  assertString(inv["description"], `${path}.description`);
  assertArray(inv["applies_to"], `${path}.applies_to`);
  assertOneOf(inv["failure_mode"], ["reject", "halt"], `${path}.failure_mode`);

  // Validate condition
  if (typeof inv["condition"] !== "object" || inv["condition"] === null) {
    throw new RegistryError(`${path}.condition must be an object`);
  }

  const cond = inv["condition"] as Record<string, unknown>;
  if (cond["type"] !== "predicate") {
    throw new RegistryError(`${path}.condition.type must be "predicate"`);
  }
  assertString(cond["expression"], `${path}.condition.expression`);
}

// =============================================================================
// Invariant Compilation
// =============================================================================

/**
 * Compile a single invariant definition.
 */
function compileInvariant(raw: RawInvariantDefinition): CompiledInvariant {
  // Parse the expression
  const ast = parsePredicate(raw.condition.expression);

  // Validate the AST for safety
  validatePredicate(ast);

  // Return compiled invariant
  return Object.freeze({
    id: raw.id,
    group: raw.group as "identity" | "lineage" | "ordering",
    scope: raw.scope as "state" | "transition" | "registration",
    description: raw.description,
    applies_to: Object.freeze([...raw.applies_to]),
    ast,
    failure_mode: raw.failure_mode as "reject" | "halt",
  });
}

// =============================================================================
// Assertion Helpers
// =============================================================================

function assertString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string") {
    throw new RegistryError(`${name} must be a string`);
  }
}

function assertArray(value: unknown, name: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new RegistryError(`${name} must be an array`);
  }
}

function assertOneOf(
  value: unknown,
  allowed: readonly string[],
  name: string
): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new RegistryError(
      `${name} must be one of: ${allowed.join(", ")}`
    );
  }
}
