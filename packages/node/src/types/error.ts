/**
 * Error envelope types for API responses.
 *
 * All error responses follow the shape:
 * { error: { code: string, message: string, details?: Record<string, unknown> } }
 */

// =============================================================================
// Error Codes
// =============================================================================

/**
 * Known API error codes.
 *
 * These are mapped from domain errors and HTTP semantics.
 */
export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "BUDGET_EXCEEDED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "IDEMPOTENCY_CONFLICT"
  | "PRECONDITION_FAILED"
  | "INTERNAL_ERROR";

// =============================================================================
// Error Response
// =============================================================================

export interface ErrorDetail {
  readonly code: ApiErrorCode | string;
  readonly message: string;
  /**
   * Optional short, actionable next step for the caller (D6-B-001), e.g.
   * "Approve the intent before executing it." Human-facing and safe to show in
   * a UI — it must NEVER leak internal/sensitive detail (the same discipline as
   * `message`). Distinct from `details`, which carries machine-readable data.
   */
  readonly hint?: string;
  readonly details?: Record<string, unknown>;
}

export interface ErrorEnvelope {
  readonly error: ErrorDetail;
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Build an error envelope.
 *
 * @param code    Stable machine-readable error code.
 * @param message Human-readable summary (safe to display; never sensitive).
 * @param hint    Optional actionable next step (D6-B-001); omitted when absent.
 * @param details Optional machine-readable structured data (e.g. validation
 *                issues, current ETag). Kept distinct from `hint`.
 */
export function createErrorEnvelope(
  code: ApiErrorCode | string,
  message: string,
  hint?: string,
  details?: Record<string, unknown>,
): ErrorEnvelope {
  const error: ErrorDetail = { code, message };
  const withHint: ErrorDetail = hint !== undefined ? { ...error, hint } : error;
  if (details !== undefined) {
    return { error: { ...withHint, details } };
  }
  return { error: withHint };
}
