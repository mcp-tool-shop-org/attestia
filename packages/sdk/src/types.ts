/**
 * @attestia/sdk — SDK types.
 *
 * Types specific to the SDK client layer.
 * Domain types are imported from @attestia/types.
 */

// =============================================================================
// Client Configuration
// =============================================================================

/**
 * Configuration for the Attestia SDK client.
 */
export interface AttestiaClientConfig {
  /** Base URL of the Attestia API (e.g., "https://api.attestia.io") */
  readonly baseUrl: string;
  /** API key for authentication (optional for public endpoints) */
  readonly apiKey?: string | undefined;
  /** Request timeout in milliseconds (default: 30000) */
  readonly timeout?: number | undefined;
  /** Maximum retry attempts for 5xx errors (default: 3) */
  readonly retries?: number | undefined;
  /**
   * Retry non-idempotent methods (POST) on 5xx / network errors.
   *
   * Default: false. By default only idempotent methods (GET) are retried,
   * because blindly replaying a POST can duplicate a server-side mutation
   * (e.g. a financial state transition) when the original request actually
   * succeeded but the response was lost.
   *
   * When enabled, the client attaches a stable `Idempotency-Key` to each POST
   * and reuses it across retries, so the server (with a tenant/route-scoped
   * idempotency store) deduplicates the mutation rather than executing it twice.
   */
  readonly retryMutations?: boolean | undefined;
  /** Custom fetch function (for testing or polyfills) */
  readonly fetchFn?: typeof fetch | undefined;
}

// =============================================================================
// Response Types
// =============================================================================

/**
 * Standard Attestia API response envelope.
 */
export interface AttestiaResponse<T> {
  /** Response payload */
  readonly data: T;
  /** HTTP status code */
  readonly status: number;
  /** Response headers (selected) */
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * Paginated list response.
 */
export interface PaginatedList<T> {
  /** Items in this page */
  readonly data: readonly T[];
  /** Pagination metadata */
  readonly pagination: {
    readonly total: number;
    readonly hasMore: boolean;
    readonly cursor?: string | undefined;
    readonly limit: number;
  };
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * A single field-level validation problem, as returned in `details.issues`
 * by the API's `VALIDATION_ERROR` responses. Lets consumers render
 * field-specific errors without casting `details` from `unknown`.
 */
export interface ValidationIssue {
  /** Path to the offending field (e.g. "body.amount"). */
  readonly path: string;
  /** Human-readable description of the problem. */
  readonly message: string;
}

/**
 * Structured error details. `issues` is populated for validation errors;
 * other codes may attach their own fields (kept open via the index signature).
 */
export interface AttestiaErrorDetails {
  readonly issues?: readonly ValidationIssue[];
  readonly [key: string]: unknown;
}

/**
 * Structured error from the Attestia API.
 *
 * Surfaces the full `{ code, message, hint }` envelope the API now returns for
 * client (4xx) errors, plus structured `details` (e.g. validation `issues`).
 */
export class AttestiaError extends Error {
  /** Error code from the API (e.g., "NOT_FOUND", "VALIDATION_ERROR") */
  readonly code: string;
  /** HTTP status code */
  readonly statusCode: number;
  /** Actionable next step from the API, when provided. */
  readonly hint?: string | undefined;
  /** Additional error details (e.g. validation `issues`). */
  readonly details?: AttestiaErrorDetails | undefined;

  constructor(
    code: string,
    message: string,
    statusCode: number,
    details?: AttestiaErrorDetails | undefined,
    hint?: string | undefined,
  ) {
    super(message);
    this.name = "AttestiaError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.hint = hint;
  }
}
