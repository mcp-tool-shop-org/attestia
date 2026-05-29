/**
 * Global error handler middleware.
 *
 * Catches all errors thrown by route handlers and produces
 * a consistent error envelope response.
 *
 * Maps known domain errors (IntentError, LedgerError, etc.)
 * to appropriate HTTP status codes and, for client (4xx) errors, to a curated
 * human-readable message + actionable hint (D6-B-002).
 *
 * Message policy (security-critical):
 * - We NEVER echo the raw thrown `Error.message`. Domain messages routinely
 *   embed account ids, balances, table names, and other internal detail; the
 *   thrown message is the wrong thing to show a client.
 * - 4xx responses get a curated, safe human message + hint from
 *   {@link CODE_MESSAGES}. Unmapped 4xx codes fall back to a generic message
 *   for their status class — still never the bare code, never the raw message.
 * - 5xx responses are flattened to a single generic "Internal server error"
 *   with no hint, so an internal fault leaks nothing.
 */

import type { Context } from "hono";
import { createErrorEnvelope } from "../types/error.js";

// =============================================================================
// Domain Error → HTTP Status Mapping
// =============================================================================

interface DomainError {
  readonly code?: string;
  readonly message: string;
}

const STATUS_MAP: Record<string, number> = {
  // Vault intent errors
  INTENT_NOT_FOUND: 404,
  INVALID_TRANSITION: 409,
  ALREADY_EXISTS: 409,
  BUDGET_EXCEEDED: 422,
  VALIDATION_FAILED: 400,

  // Ledger errors
  EMPTY_TRANSACTION: 400,
  MIXED_CORRELATION_ID: 400,
  DUPLICATE_ENTRY_ID: 409,
  UNKNOWN_ACCOUNT: 404,
  DUPLICATE_ACCOUNT_ID: 409,
  INVALID_AMOUNT: 400,
  UNBALANCED_TRANSACTION: 400,

  // Event store errors
  CONCURRENCY_CONFLICT: 409,
  STREAM_NOT_FOUND: 404,

  // Treasury errors
  PAYEE_EXISTS: 409,
  PAYEE_NOT_FOUND: 404,
  PAYEE_INACTIVE: 422,
  RUN_EXISTS: 409,
  RUN_NOT_FOUND: 404,
  NO_COMPONENTS: 400,
  PLAN_EXISTS: 409,
  PLAN_NOT_FOUND: 404,
  INVALID_SHARES: 400,
  POOL_EXCEEDED: 422,
  NO_RECIPIENTS: 400,
  REQUEST_EXISTS: 409,
  REQUEST_NOT_FOUND: 404,
  NOT_GATEKEEPER: 403,
  ALREADY_APPROVED: 409,
  DUPLICATE_GATEKEEPER: 400,
  // Separation of duties: the requester may not approve their own request.
  // This is a forbidden action by the authenticated actor, not a server fault.
  REQUESTER_CANNOT_APPROVE: 403,

  // Budget errors
  ENVELOPE_EXISTS: 409,
  ENVELOPE_NOT_FOUND: 404,
  INSUFFICIENT_BUDGET: 422,
  CURRENCY_MISMATCH: 400,
};

// =============================================================================
// Code → Safe Human Message + Hint (D6-B-002)
// =============================================================================

interface HumanError {
  /** Safe, human-readable summary shown in place of the bare code / raw message. */
  readonly message: string;
  /** Optional actionable next step for the caller. */
  readonly hint?: string;
}

/**
 * Curated, client-safe copy for known 4xx error codes. Covers the API-level
 * codes (NOT_FOUND, VALIDATION_ERROR, UNAUTHORIZED, …) AND the domain codes
 * that surface to clients (INVALID_TRANSITION, BUDGET_EXCEEDED, …). None of
 * these strings contain internal detail — they are safe to render verbatim.
 *
 * Codes absent here but present in {@link STATUS_MAP} (or otherwise 4xx) fall
 * back to {@link STATUS_CLASS_FALLBACK} for their status, so a missing entry
 * degrades gracefully instead of leaking the raw message.
 */
const CODE_MESSAGES: Record<string, HumanError> = {
  // ── Generic API codes ────────────────────────────────────────────────────
  NOT_FOUND: {
    message: "The requested resource was not found.",
    hint: "Verify the identifier in the URL and that the resource exists for your tenant.",
  },
  VALIDATION_ERROR: {
    message: "The request was invalid.",
    hint: "Check the request body and parameters against the API schema, then retry.",
  },
  VALIDATION_FAILED: {
    message: "The request was invalid.",
    hint: "Check the request body and parameters against the API schema, then retry.",
  },
  UNAUTHORIZED: {
    message: "Authentication is required or the provided credentials are invalid.",
    hint: "Provide a valid API key or bearer token and retry.",
  },
  FORBIDDEN: {
    message: "You do not have permission to perform this action.",
    hint: "This action requires a role or permission your credentials lack.",
  },
  CONFLICT: {
    message: "The request conflicts with the current state of the resource.",
    hint: "Re-fetch the resource to see its current state, then retry.",
  },
  IDEMPOTENCY_MISMATCH: {
    message: "This idempotency key was already used with a different request body.",
    hint: "Reuse an Idempotency-Key only for byte-identical retries; use a fresh key for a different request.",
  },
  IDEMPOTENCY_CONFLICT: {
    message: "This idempotency key was already used with a different request body.",
    hint: "Reuse an Idempotency-Key only for byte-identical retries; use a fresh key for a different request.",
  },
  RATE_LIMITED: {
    message: "Too many requests.",
    hint: "Slow down and retry after the period indicated by the Retry-After header.",
  },
  PRECONDITION_FAILED: {
    message: "A precondition for the request was not met.",
    hint: "Re-fetch the resource to get its current ETag, then retry with that value in If-Match.",
  },

  // ── Intent / vault domain codes ──────────────────────────────────────────
  INTENT_NOT_FOUND: {
    message: "The requested intent was not found.",
    hint: "Verify the intent id; it may not exist or may belong to another tenant.",
  },
  INVALID_TRANSITION: {
    message: "The intent is not in a state that allows this action.",
    hint: "Check the intent's current status — e.g. an intent must be approved before it can be executed.",
  },
  ALREADY_EXISTS: {
    message: "A resource with that identifier already exists.",
    hint: "Use a different id, or fetch the existing resource instead of recreating it.",
  },
  BUDGET_EXCEEDED: {
    message: "The action would exceed the configured budget.",
    hint: "Reduce the amount or raise the relevant budget envelope, then retry.",
  },
  INSUFFICIENT_BUDGET: {
    message: "The budget envelope has insufficient remaining funds for this action.",
    hint: "Top up the envelope or lower the amount, then retry.",
  },
  CURRENCY_MISMATCH: {
    message: "The currency does not match the target's currency.",
    hint: "Submit the amount in the resource's configured currency.",
  },
  ENVELOPE_EXISTS: {
    message: "A budget envelope with that identifier already exists.",
    hint: "Use a different envelope id, or update the existing envelope.",
  },
  ENVELOPE_NOT_FOUND: {
    message: "The requested budget envelope was not found.",
    hint: "Create the envelope first, or verify its id.",
  },

  // ── Ledger domain codes ──────────────────────────────────────────────────
  EMPTY_TRANSACTION: {
    message: "A transaction must contain at least one entry.",
    hint: "Include one or more balanced entries in the transaction.",
  },
  MIXED_CORRELATION_ID: {
    message: "All entries in a transaction must share the same correlation id.",
    hint: "Split entries with different correlation ids into separate transactions.",
  },
  DUPLICATE_ENTRY_ID: {
    message: "An entry with that id already exists.",
    hint: "Use a unique entry id for each ledger entry.",
  },
  UNKNOWN_ACCOUNT: {
    message: "The referenced account does not exist.",
    hint: "Create the account before posting entries against it.",
  },
  DUPLICATE_ACCOUNT_ID: {
    message: "An account with that id already exists.",
    hint: "Use a unique account id.",
  },
  INVALID_AMOUNT: {
    message: "The amount is invalid.",
    hint: "Provide a well-formed, non-negative decimal amount with matching decimals.",
  },
  UNBALANCED_TRANSACTION: {
    message: "The transaction's debits and credits do not balance.",
    hint: "Ensure total debits equal total credits before submitting.",
  },

  // ── Event store domain codes ─────────────────────────────────────────────
  CONCURRENCY_CONFLICT: {
    message: "The resource was modified concurrently.",
    hint: "Re-read the stream's current version and retry with the expected version.",
  },
  STREAM_NOT_FOUND: {
    message: "The requested event stream was not found.",
    hint: "Verify the stream id; it may not have any events yet.",
  },

  // ── Treasury domain codes ────────────────────────────────────────────────
  PAYEE_EXISTS: {
    message: "A payee with that identifier already exists.",
    hint: "Use a different payee id, or update the existing payee.",
  },
  PAYEE_NOT_FOUND: {
    message: "The requested payee was not found.",
    hint: "Register the payee before referencing it.",
  },
  PAYEE_INACTIVE: {
    message: "The payee is not active.",
    hint: "Reactivate the payee before including it in a run.",
  },
  RUN_EXISTS: {
    message: "A payroll run with that identifier already exists.",
    hint: "Use a different run id.",
  },
  RUN_NOT_FOUND: {
    message: "The requested payroll run was not found.",
    hint: "Verify the run id.",
  },
  NO_COMPONENTS: {
    message: "The run must contain at least one component.",
    hint: "Add one or more pay components before submitting the run.",
  },
  PLAN_EXISTS: {
    message: "A distribution plan with that identifier already exists.",
    hint: "Use a different plan id.",
  },
  PLAN_NOT_FOUND: {
    message: "The requested distribution plan was not found.",
    hint: "Verify the plan id.",
  },
  INVALID_SHARES: {
    message: "The distribution shares are invalid.",
    hint: "Ensure shares are positive and sum to the expected total.",
  },
  POOL_EXCEEDED: {
    message: "The distribution would exceed the available pool.",
    hint: "Lower the distribution amounts or increase the pool.",
  },
  NO_RECIPIENTS: {
    message: "The distribution must have at least one recipient.",
    hint: "Add one or more recipients before distributing.",
  },
  REQUEST_EXISTS: {
    message: "A funding request with that identifier already exists.",
    hint: "Use a different request id.",
  },
  REQUEST_NOT_FOUND: {
    message: "The requested funding request was not found.",
    hint: "Verify the request id.",
  },
  NOT_GATEKEEPER: {
    message: "Only a designated gatekeeper may perform this action.",
    hint: "This action must be taken by an account configured as a gatekeeper.",
  },
  ALREADY_APPROVED: {
    message: "This request has already been approved.",
    hint: "No further approval is needed.",
  },
  DUPLICATE_GATEKEEPER: {
    message: "That gatekeeper has already approved this request.",
    hint: "A distinct gatekeeper must provide the remaining approval(s).",
  },
  REQUESTER_CANNOT_APPROVE: {
    message: "The requester of an action cannot also approve it.",
    hint: "A different authorized approver must approve this request (separation of duties).",
  },
};

/**
 * Generic, client-safe fallback message per 4xx status class. Used when a 4xx
 * code has no curated entry in {@link CODE_MESSAGES}, so we still never return
 * the bare code or the raw thrown message.
 */
const STATUS_CLASS_FALLBACK: Record<number, string> = {
  400: "The request was invalid.",
  401: "Authentication is required or invalid.",
  403: "You do not have permission to perform this action.",
  404: "The requested resource was not found.",
  409: "The request conflicts with the current state of the resource.",
  422: "The request could not be processed.",
  429: "Too many requests.",
};

function getStatusCode(error: DomainError): number {
  if (error.code !== undefined && error.code in STATUS_MAP) {
    return STATUS_MAP[error.code]!;
  }
  return 500;
}

function getErrorCode(error: DomainError): string {
  if (error.code !== undefined) {
    return error.code;
  }
  return "INTERNAL_ERROR";
}

// =============================================================================
// Middleware
// =============================================================================

/**
 * Global error handler. Registered as Hono's onError handler.
 */
export function handleError(err: Error, c: Context): Response {
  const domainError = err as unknown as DomainError;
  const status = getStatusCode(domainError);
  const code = getErrorCode(domainError);

  // 5xx: never reveal internals — a single generic message, no hint.
  if (status >= 500) {
    return c.json(
      createErrorEnvelope(code, "Internal server error"),
      status as 400,
    );
  }

  // 4xx: a curated, safe human message + hint. Prefer the per-code copy; fall
  // back to a status-class generic. Never the bare code, never the raw message.
  const curated = CODE_MESSAGES[code];
  const message =
    curated?.message ??
    STATUS_CLASS_FALLBACK[status] ??
    "The request could not be processed.";
  const hint = curated?.hint;

  return c.json(createErrorEnvelope(code, message, hint), status as 400);
}
