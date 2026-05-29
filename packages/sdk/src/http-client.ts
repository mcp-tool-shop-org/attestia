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

        // 5xx → retry with backoff (only when this method is retryable)
        if (response.status >= 500 && canRetry && attempt < this.maxRetries) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt), 10000);
          await sleep(backoffMs);
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
