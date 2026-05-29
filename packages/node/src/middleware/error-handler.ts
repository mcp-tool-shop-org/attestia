/**
 * Global error handler middleware.
 *
 * Catches all errors thrown by route handlers and produces
 * a consistent error envelope response.
 *
 * Maps known domain errors (IntentError, LedgerError, etc.)
 * to appropriate HTTP status codes.
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

  // Don't leak internal details — return only the error code, not the full message
  const message =
    status >= 500 ? "Internal server error" : (domainError.code ?? "Request failed");

  const envelope = createErrorEnvelope(code, message);
  return c.json(envelope, status as 400);
}
