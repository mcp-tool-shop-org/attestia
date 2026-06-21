/**
 * @attestia/sdk — HTTP Client.
 *
 * Wraps native fetch() with:
 * - API key header injection
 * - Request ID generation
 * - Timeout handling
 * - Retry logic (exponential backoff for 5xx)
 * - Error normalization
 * - Typed responses
 *
 * Design:
 * - Zero external dependencies (uses native fetch)
 * - Configurable via AttestiaClientConfig
 * - Custom fetch function for testing
 */

import { randomBytes } from "node:crypto";
import type { AttestiaClientConfig, AttestiaErrorDetails } from "./types.js";
import { AttestiaError } from "./types.js";

// =============================================================================
// Internal Helpers
// =============================================================================

/** Generate a cryptographically secure request ID */
function generateRequestId(): string {
  return `sdk-${randomBytes(12).toString("hex")}`;
}

/** Generate a cryptographically secure idempotency key */
function generateIdempotencyKey(): string {
  return `idem-${randomBytes(16).toString("hex")}`;
}

/** HTTP methods that are safe to retry blindly (no side effects). */
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Sleep for the given number of milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Upper bound on a single Retry-After honoured sleep (ms), so a hostile or
 * mis-set header cannot park the client for minutes. The deadline budget caps
 * it further. */
const MAX_RETRY_AFTER_MS = 30_000;

/**
 * Parse an HTTP `Retry-After` header value into milliseconds.
 *
 * Supports both forms from RFC 9110: a delta-seconds integer ("120") and an
 * HTTP-date ("Wed, 21 Oct 2025 07:28:00 GMT"). Returns `undefined` when the
 * header is absent or unparseable, so the caller falls back to exponential
 * backoff.
 */
function parseRetryAfterMs(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined || value.trim() === "") {
    return undefined;
  }
  const trimmed = value.trim();

  // delta-seconds form
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }

  // HTTP-date form
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    const deltaMs = dateMs - Date.now();
    return deltaMs > 0 ? deltaMs : 0;
  }

  return undefined;
}

/**
 * Parse a response body as JSON, handling empty responses.
 */
/** Maximum response body size (10MB) to prevent deserialization bombs */
const MAX_RESPONSE_BODY_SIZE = 10_000_000;

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return {};
  }
  if (text.length > MAX_RESPONSE_BODY_SIZE) {
    throw new AttestiaError(
      "RESPONSE_TOO_LARGE",
      `Response body exceeds ${MAX_RESPONSE_BODY_SIZE / 1_000_000}MB limit (${text.length} bytes)`,
      0,
    );
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !contentType.includes("json") && !contentType.includes("text")) {
    throw new AttestiaError(
      "INVALID_CONTENT_TYPE",
      `Unexpected content type: ${contentType}`,
      0,
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/**
 * Extract selected headers from a Response.
 */
function extractHeaders(response: Response): Record<string, string> {
  const result: Record<string, string> = {};
  const interestingHeaders = [
    "content-type",
    "x-request-id",
    "x-ratelimit-remaining",
    "retry-after",
  ];

  for (const name of interestingHeaders) {
    const value = response.headers.get(name);
    if (value !== null) {
      result[name] = value;
    }
  }

  return result;
}

// =============================================================================
// HTTP Client
// =============================================================================

/**
 * Low-level HTTP client for the Attestia API.
 *
 * Provides typed get/post methods with automatic retries,
 * timeout handling, and error normalization.
 */
export class HttpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly retryMutations: boolean;
  private readonly fetchFn: typeof fetch;

  constructor(config: AttestiaClientConfig) {
    // Strip trailing slash
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.timeout = config.timeout ?? 30000;
    this.maxRetries = config.retries ?? 3;
    this.retryMutations = config.retryMutations ?? false;
    this.fetchFn = config.fetchFn ?? globalThis.fetch;
  }

  /**
   * Perform a GET request.
   */
  async get<T>(path: string): Promise<{ data: T; status: number; headers: Record<string, string> }> {
    return this.request<T>("GET", path);
  }

  /**
   * Perform a GET request returning the full response body (no envelope unwrapping).
   * Used for paginated list endpoints where the body IS the data+pagination structure.
   */
  async getFullBody<T>(path: string): Promise<{ data: T; status: number; headers: Record<string, string> }> {
    return this.requestRaw<T>("GET", path);
  }

  /**
   * Perform a POST request with a JSON body.
   */
  async post<T>(path: string, body: unknown): Promise<{ data: T; status: number; headers: Record<string, string> }> {
    return this.request<T>("POST", path, body);
  }

  /**
   * Raw request method that returns the full body without unwrapping .data envelope.
   */
  private async requestRaw<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ data: T; status: number; headers: Record<string, string> }> {
    const url = `${this.baseUrl}${path}`;
    const requestId = generateRequestId();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "X-Request-Id": requestId,
    };

    if (this.apiKey !== undefined) {
      headers["X-Api-Key"] = this.apiKey;
    }

    const init: RequestInit = {
      method,
      headers,
    };

    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const response = await this.fetchWithTimeout(url, init);
    const responseBody = await parseResponseBody(response);
    const responseHeaders = extractHeaders(response);

    if (response.ok) {
      return {
        data: responseBody as T,
        status: response.status,
        headers: responseHeaders,
      };
    }

    // Error handling
    if (response.status >= 400 && response.status < 500) {
      const errorBody = responseBody as {
        error?: { code?: string; message?: string; hint?: string; details?: AttestiaErrorDetails };
      };
      throw new AttestiaError(
        errorBody.error?.code ?? "CLIENT_ERROR",
        errorBody.error?.message ?? `HTTP ${response.status}`,
        response.status,
        errorBody.error?.details,
        errorBody.error?.hint,
      );
    }

    throw new AttestiaError(
      "SERVER_ERROR",
      `HTTP ${response.status}`,
      response.status,
    );
  }

  /**
   * Core request method with retry logic.
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ data: T; status: number; headers: Record<string, string> }> {
    const url = `${this.baseUrl}${path}`;
    const requestId = generateRequestId();

    const isIdempotent = IDEMPOTENT_METHODS.has(method.toUpperCase());
    // Only retry safe (idempotent) methods unless the caller has explicitly
    // opted into mutation retries. This prevents a lost-response network error
    // after a successful POST from duplicating the server-side mutation.
    const canRetry = isIdempotent || this.retryMutations;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "X-Request-Id": requestId,
    };

    if (this.apiKey !== undefined) {
      headers["X-Api-Key"] = this.apiKey;
    }

    // For non-idempotent methods, attach a stable Idempotency-Key generated
    // once per logical request and reused across every retry attempt. With a
    // tenant/route-scoped server store, retries then dedupe to a single
    // mutation instead of replaying it.
    if (!isIdempotent) {
      headers["Idempotency-Key"] = generateIdempotencyKey();
    }

    const init: RequestInit = {
      method,
      headers,
    };

    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    let lastError: Error | null = null;
    const deadline = Date.now() + this.timeout;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new AttestiaError(
          "TIMEOUT",
          `Request deadline exceeded after ${attempt} attempts`,
          0,
        );
      }

      try {
        const response = await this.fetchWithTimeout(url, init, remainingMs);
        const responseBody = await parseResponseBody(response);
        const responseHeaders = extractHeaders(response);

        // 2xx → success
        if (response.ok) {
          return {
            data: (responseBody as { data?: T }).data ?? responseBody as T,
            status: response.status,
            headers: responseHeaders,
          };
        }

        // 429 → the server explicitly told us to back off via Retry-After
        // (B-SDK-001). Honour it and retry within the deadline budget rather
        // than failing immediately like an ordinary 4xx — a 429 is transient
        // and recoverable, and retrying is safe even for mutations because the
        // request never reached the handler. GET is always retried; mutations
        // retry only when the caller opted in (they carry a stable
        // Idempotency-Key, so a dedupe-on-server is guaranteed).
        if (response.status === 429 && canRetry && attempt < this.maxRetries) {
          const retryAfterMs = parseRetryAfterMs(responseHeaders["retry-after"]);
          const waitMs = this.boundedRetryWait(retryAfterMs, attempt, deadline);
          if (waitMs !== undefined) {
            lastError = new AttestiaError(
              "RATE_LIMITED",
              `HTTP 429 (rate limited)`,
              429,
            );
            await sleep(waitMs);
            continue;
          }
          // No budget left to honour the backoff → fall through and surface 429.
        }

        // 4xx → don't retry (client errors)
        if (response.status >= 400 && response.status < 500) {
          const errorBody = responseBody as {
            error?: { code?: string; message?: string; hint?: string; details?: AttestiaErrorDetails };
          };
          throw new AttestiaError(
            errorBody.error?.code ?? "CLIENT_ERROR",
            errorBody.error?.message ?? `HTTP ${response.status}`,
            response.status,
            errorBody.error?.details,
            errorBody.error?.hint,
          );
        }

        // 5xx → retry with backoff (only when this method is retryable).
        // Honour a server-provided Retry-After (e.g. on 503) over the default
        // exponential backoff so the client recovers exactly when the server
        // says it can (B-SDK-001).
        if (response.status >= 500 && canRetry && attempt < this.maxRetries) {
          const retryAfterMs = parseRetryAfterMs(responseHeaders["retry-after"]);
          const backoffMs = Math.min(1000 * Math.pow(2, attempt), 10000);
          // Prefer Retry-After when present and within budget; else exponential.
          const waitMs =
            this.boundedRetryWait(retryAfterMs, attempt, deadline) ?? backoffMs;
          await sleep(waitMs);
          lastError = new AttestiaError(
            "SERVER_ERROR",
            `HTTP ${response.status}`,
            response.status,
          );
          continue;
        }

        // 5xx on last attempt
        const errorBody = responseBody as {
          error?: { code?: string; message?: string };
        };
        throw new AttestiaError(
          errorBody.error?.code ?? "SERVER_ERROR",
          errorBody.error?.message ?? `HTTP ${response.status} after ${attempt + 1} attempts`,
          response.status,
        );
      } catch (error) {
        if (error instanceof AttestiaError) {
          throw error;
        }

        // Network / timeout errors → retry (only when this method is retryable)
        if (canRetry && attempt < this.maxRetries) {
          lastError = error instanceof Error ? error : new Error(String(error));
          const backoffMs = Math.min(1000 * Math.pow(2, attempt), 10000);
          await sleep(backoffMs);
          continue;
        }

        throw new AttestiaError(
          "NETWORK_ERROR",
          lastError?.message ?? (error instanceof Error ? error.message : "Network error"),
          0,
        );
      }
    }

    // Should never reach here, but just in case
    throw new AttestiaError(
      "NETWORK_ERROR",
      lastError?.message ?? "Request failed after all retries",
      0,
    );
  }

  /**
   * Compute how long to wait before the next retry when honouring a
   * server-provided Retry-After, bounded by both {@link MAX_RETRY_AFTER_MS} and
   * the remaining request deadline (B-SDK-001).
   *
   * Returns `undefined` when there is no Retry-After to honour, or when even a
   * zero-length wait would not leave time to make another attempt before the
   * deadline — letting the caller fall back to its default behaviour (surface
   * the 429, or use exponential backoff for 5xx).
   */
  private boundedRetryWait(
    retryAfterMs: number | undefined,
    _attempt: number,
    deadline: number,
  ): number | undefined {
    if (retryAfterMs === undefined) {
      return undefined;
    }
    const capped = Math.min(Math.max(retryAfterMs, 0), MAX_RETRY_AFTER_MS);
    const remaining = deadline - Date.now();
    // No point sleeping past the deadline — another attempt could never run.
    if (capped >= remaining) {
      return undefined;
    }
    return capped;
  }

  /**
   * Fetch with a timeout using AbortController.
   */
  private async fetchWithTimeout(url: string, init: RequestInit, timeoutMs?: number): Promise<Response> {
    const controller = new AbortController();
    const effectiveTimeout = timeoutMs !== undefined ? Math.min(timeoutMs, this.timeout) : this.timeout;
    const timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);

    try {
      return await this.fetchFn(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new AttestiaError(
          "TIMEOUT",
          `Request timed out after ${this.timeout}ms`,
          0,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
