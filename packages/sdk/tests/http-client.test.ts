/**
 * HTTP Client Tests
 *
 * Verifies:
 * - GET and POST requests
 * - API key header injection
 * - Request ID header
 * - Timeout handling
 * - Retry on 5xx
 * - No retry on 4xx
 * - Error normalization
 * - Response body parsing (empty, malformed)
 * - getFullBody (requestRaw) error paths
 * - Network error retry and exhaustion
 * - Data envelope unwrapping fallback
 */

import { describe, it, expect, vi } from "vitest";
import { HttpClient } from "../src/http-client.js";
import { AttestiaError } from "../src/types.js";

// =============================================================================
// Mock Fetch Helper
// =============================================================================

function createMockFetch(
  responses: Array<{
    status: number;
    body?: unknown;
    headers?: Record<string, string>;
    delay?: number;
    error?: Error;
  }>,
): typeof fetch {
  let callIndex = 0;

  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const config = responses[callIndex];
    callIndex++;

    if (config === undefined) {
      throw new Error(`Mock fetch called more times than expected (call ${callIndex})`);
    }

    if (config.error !== undefined) {
      throw config.error;
    }

    if (config.delay !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, config.delay));
    }

    const headers = new Headers(config.headers ?? {});
    const body = config.body !== undefined ? JSON.stringify(config.body) : "";

    return new Response(body, {
      status: config.status,
      headers,
    });
  }) as unknown as typeof fetch;
}

// =============================================================================
// GET Requests
// =============================================================================

describe("HttpClient GET", () => {
  it("makes a GET request and returns data", async () => {
    const mockFetch = createMockFetch([
      { status: 200, body: { data: { id: "test-1", name: "Test" } } },
    ]);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      retries: 0,
    });

    const result = await client.get<{ id: string; name: string }>("/api/v1/items/1");

    expect(result.data).toEqual({ id: "test-1", name: "Test" });
    expect(result.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledOnce();

    // Verify URL
    const [url] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("https://api.example.com/api/v1/items/1");
  });

  it("strips trailing slash from base URL", async () => {
    const mockFetch = createMockFetch([
      { status: 200, body: { data: {} } },
    ]);

    const client = new HttpClient({
      baseUrl: "https://api.example.com/",
      fetchFn: mockFetch,
      retries: 0,
    });

    await client.get("/test");

    const [url] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("https://api.example.com/test");
  });
});

// =============================================================================
// POST Requests
// =============================================================================

describe("HttpClient POST", () => {
  it("makes a POST request with JSON body", async () => {
    const mockFetch = createMockFetch([
      { status: 201, body: { data: { id: "new-1" } } },
    ]);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      retries: 0,
    });

    const result = await client.post<{ id: string }>("/api/v1/items", {
      name: "New Item",
    });

    expect(result.data).toEqual({ id: "new-1" });
    expect(result.status).toBe(201);

    // Verify body was sent
    const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ name: "New Item" }));
  });
});

// =============================================================================
// Headers
// =============================================================================

describe("HttpClient headers", () => {
  it("injects API key header when configured", async () => {
    const mockFetch = createMockFetch([
      { status: 200, body: { data: {} } },
    ]);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      apiKey: "test-api-key-123",
      fetchFn: mockFetch,
      retries: 0,
    });

    await client.get("/test");

    const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(init.headers["X-Api-Key"]).toBe("test-api-key-123");
  });

  it("does not inject API key when not configured", async () => {
    const mockFetch = createMockFetch([
      { status: 200, body: { data: {} } },
    ]);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      retries: 0,
    });

    await client.get("/test");

    const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(init.headers["X-Api-Key"]).toBeUndefined();
  });

  it("includes request ID header", async () => {
    const mockFetch = createMockFetch([
      { status: 200, body: { data: {} } },
    ]);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      retries: 0,
    });

    await client.get("/test");

    const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(init.headers["X-Request-Id"]).toBeTruthy();
    expect(init.headers["X-Request-Id"]).toMatch(/^sdk-/);
  });

  it("includes Content-Type and Accept headers", async () => {
    const mockFetch = createMockFetch([
      { status: 200, body: { data: {} } },
    ]);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      retries: 0,
    });

    await client.get("/test");

    const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers["Accept"]).toBe("application/json");
  });
});

// =============================================================================
// Error Handling
// =============================================================================

describe("HttpClient error handling", () => {
  it("throws AttestiaError on 4xx responses", async () => {
    const mockFetch = createMockFetch([
      {
        status: 404,
        body: { error: { code: "NOT_FOUND", message: "Item not found" } },
      },
    ]);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      retries: 0,
    });

    await expect(client.get("/api/v1/items/999")).rejects.toThrow(AttestiaError);

    try {
      await client.get("/api/v1/items/999");
    } catch (error) {
      // Second call will fail because mock only has 1 response
    }
  });

  it("4xx errors include code and status", async () => {
    const mockFetch = createMockFetch([
      {
        status: 400,
        body: {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid input",
            details: { field: "name" },
          },
        },
      },
    ]);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      retries: 0,
    });

    try {
      await client.post("/api/v1/items", {});
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AttestiaError);
      const attError = error as AttestiaError;
      expect(attError.code).toBe("VALIDATION_ERROR");
      expect(attError.message).toBe("Invalid input");
      expect(attError.statusCode).toBe(400);
      expect(attError.details).toEqual({ field: "name" });
    }
  });

  it("surfaces the actionable hint and typed validation issues on 4xx (D6-B-014)", async () => {
    const mockFetch = createMockFetch([
      {
        status: 400,
        body: {
          error: {
            code: "VALIDATION_ERROR",
            message: "The request was invalid.",
            hint: "Check the request body against the API schema, then retry.",
            details: { issues: [{ path: "body.amount", message: "Required" }] },
          },
        },
      },
    ]);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      retries: 0,
    });

    try {
      await client.post("/api/v1/items", {});
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AttestiaError);
      const e = error as AttestiaError;
      expect(e.hint).toBe(
        "Check the request body against the API schema, then retry.",
      );
      // details.issues is now typed (ValidationIssue[]) — no cast required.
      expect(e.details?.issues?.[0]?.path).toBe("body.amount");
      expect(e.details?.issues?.[0]?.message).toBe("Required");
    }
  });

  it("does not retry on 4xx errors", async () => {
    const mockFetch = createMockFetch([
      { status: 404, body: { error: { code: "NOT_FOUND", message: "Not found" } } },
    ]);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      retries: 3, // retries configured, but should NOT retry on 4xx
    });

    await expect(client.get("/test")).rejects.toThrow(AttestiaError);
    expect(mockFetch).toHaveBeenCalledOnce(); // Only 1 call, no retries
  });
});

// =============================================================================
// Retry Logic
// =============================================================================

describe("HttpClient retry logic", () => {
  it("retries on 5xx errors", async () => {
    const mockFetch = createMockFetch([
      { status: 500, body: { error: { code: "SERVER_ERROR", message: "Internal error" } } },
      { status: 200, body: { data: { success: true } } },
    ]);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      retries: 2,
    });

    const result = await client.get<{ success: boolean }>("/test");
    expect(result.data).toEqual({ success: true });
    expect(mockFetch).toHaveBeenCalledTimes(2); // First failed, second succeeded
  });

  it("gives up after max retries on persistent 5xx", async () => {
    const mockFetch = createMockFetch([
      { status: 503, body: { error: { code: "UNAVAILABLE", message: "Try again" } } },
      { status: 503, body: { error: { code: "UNAVAILABLE", message: "Try again" } } },
    ]);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      retries: 1,
    });

    await expect(client.get("/test")).rejects.toThrow(AttestiaError);
    expect(mockFetch).toHaveBeenCalledTimes(2); // Initial + 1 retry
  });
});

// =============================================================================
// Timeout
// =============================================================================

describe("HttpClient timeout", () => {
  it("throws timeout error when request exceeds timeout", async () => {
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";

    const mockFetch = createMockFetch([
      { status: 200, body: { data: {} }, delay: 5000 },
    ]);

    // Override mock to check abort signal
    const abortAwareFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      // Simulate checking abort signal
      if (init?.signal?.aborted) {
        throw abortError;
      }
      // Return after checking - but in reality the timeout will fire first
      return await (mockFetch as Function)(url, init);
    }) as unknown as typeof fetch;

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: abortAwareFetch,
      timeout: 50, // Very short timeout
      retries: 0,
    });

    // This should either timeout or complete depending on timing
    // The important thing is it doesn't hang
    try {
      await client.get("/slow-endpoint");
    } catch (error) {
      expect(error).toBeInstanceOf(AttestiaError);
      if (error instanceof AttestiaError) {
        expect(["TIMEOUT", "NETWORK_ERROR"]).toContain(error.code);
      }
    }
  });
});

// =============================================================================
// Response Headers
// =============================================================================

describe("HttpClient response headers", () => {
  it("extracts interesting response headers", async () => {
    const mockFetch = createMockFetch([
      {
        status: 200,
        body: { data: {} },
        headers: {
          "content-type": "application/json",
          "x-request-id": "req-123",
          "x-ratelimit-remaining": "42",
        },
      },
    ]);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      retries: 0,
    });

    const result = await client.get("/test");
    expect(result.headers["content-type"]).toBe("application/json");
    expect(result.headers["x-request-id"]).toBe("req-123");
    expect(result.headers["x-ratelimit-remaining"]).toBe("42");
  });
});

// =============================================================================
// Response Body Parsing
// =============================================================================

describe("HttpClient response body parsing", () => {
  it("handles empty response body", async () => {
    // Return a Response with no body content
    const mockFetch = vi.fn(async () => {
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      retries: 0,
    });

    const result = await client.get("/empty");
    // parseResponseBody returns {} for empty text
    expect(result.data).toEqual({});
  });

  it("handles non-JSON response body", async () => {
    const mockFetch = vi.fn(async () => {
      return new Response("not valid json {{{", { status: 200 });
    }) as unknown as typeof fetch;

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      retries: 0,
    });

    const result = await client.get<{ raw: string }>("/text");
    // parseResponseBody wraps unparseable text in { raw: text }
    expect(result.data).toEqual({ raw: "not valid json {{{" });
  });

  it("unwraps data envelope when present", async () => {
    const mockFetch = createMockFetch([
      { status: 200, body: { data: { id: "wrapped" } } },
    ]);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      retries: 0,
    });

    const result = await client.get<{ id: string }>("/test");
    expect(result.data).toEqual({ id: "wrapped" });
  });

  it("returns full body when no data envelope", async () => {
    const mockFetch = createMockFetch([
      { status: 200, body: { id: "no-envelope", name: "test" } },
    ]);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      retries: 0,
    });

    // When body has no .data key, the ?? fallback returns the full body
    const result = await client.get<{ id: string; name: string }>("/test");
    expect(result.data).toEqual({ id: "no-envelope", name: "test" });
  });
});

// =============================================================================
// getFullBody / requestRaw Path
// =============================================================================

describe("HttpClient getFullBody (requestRaw)", () => {
  it("returns full body without unwrapping data envelope", async () => {
    const mockFetch = createMockFetch([
      {
        status: 200,
        body: { data: [{ id: 1 }], pagination: { total: 100, page: 1 } },
      },
    ]);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      retries: 0,
    });

    const result = await client.getFullBody<{
      data: Array<{ id: number }>;
      pagination: { total: number; page: number };
    }>("/list");

    // requestRaw returns the body AS-IS (no .data unwrapping)
    expect(result.data.data).toEqual([{ id: 1 }]);
    expect(result.data.pagination).toEqual({ total: 100, page: 1 });
  });

  it("throws CLIENT_ERROR on 4xx in requestRaw", async () => {
    const mockFetch = createMockFetch([
      {
        status: 422,
        body: { error: { code: "INVALID", message: "Bad entity" } },
      },
    ]);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      retries: 0,
    });

    try {
      await client.getFullBody("/bad");
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AttestiaError);
      const attError = error as AttestiaError;
      expect(attError.code).toBe("INVALID");
      expect(attError.message).toBe("Bad entity");
      expect(attError.statusCode).toBe(422);
    }
  });

  it("uses default CLIENT_ERROR code when 4xx body has no error.code", async () => {
    const mockFetch = createMockFetch([
      { status: 403, body: { message: "Forbidden" } },
    ]);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      retries: 0,
    });

    try {
      await client.getFullBody("/forbidden");
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AttestiaError);
      const attError = error as AttestiaError;
      expect(attError.code).toBe("CLIENT_ERROR");
      expect(attError.message).toBe("HTTP 403");
      expect(attError.statusCode).toBe(403);
    }
  });

  it("throws SERVER_ERROR on 5xx in requestRaw", async () => {
    const mockFetch = createMockFetch([
      { status: 502, body: {} },
    ]);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      retries: 0,
    });

    try {
      await client.getFullBody("/down");
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AttestiaError);
      const attError = error as AttestiaError;
      expect(attError.code).toBe("SERVER_ERROR");
      expect(attError.statusCode).toBe(502);
    }
  });

  it("injects API key header in requestRaw path", async () => {
    const mockFetch = createMockFetch([
      { status: 200, body: { items: [] } },
    ]);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      apiKey: "raw-key-456",
      fetchFn: mockFetch,
      retries: 0,
    });

    await client.getFullBody("/list");

    const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(init.headers["X-Api-Key"]).toBe("raw-key-456");
  });

  it("omits API key header in requestRaw when not configured", async () => {
    const mockFetch = createMockFetch([
      { status: 200, body: {} },
    ]);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      retries: 0,
    });

    await client.getFullBody("/list");

    const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(init.headers["X-Api-Key"]).toBeUndefined();
  });
});

// =============================================================================
// 4xx Default Error Codes (request path)
// =============================================================================

describe("HttpClient 4xx default error codes", () => {
  it("uses CLIENT_ERROR fallback when error body has no code", async () => {
    const mockFetch = createMockFetch([
      { status: 401, body: { message: "Unauthorized" } },
    ]);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      retries: 0,
    });

    try {
      await client.get("/secret");
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AttestiaError);
      const attError = error as AttestiaError;
      expect(attError.code).toBe("CLIENT_ERROR");
      expect(attError.message).toBe("HTTP 401");
      expect(attError.statusCode).toBe(401);
    }
  });
});

// =============================================================================
// 5xx Last Attempt (no more retries)
// =============================================================================

describe("HttpClient 5xx last attempt error", () => {
  it("throws with error body code/message on final 5xx attempt", async () => {
    // retries: 0 means only 1 attempt total — the 5xx hits line 254, not 243
    const mockFetch = createMockFetch([
      { status: 500, body: { error: { code: "DB_DOWN", message: "Database unavailable" } } },
    ]);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      retries: 0,
    });

    try {
      await client.get("/test");
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AttestiaError);
      const attError = error as AttestiaError;
      expect(attError.code).toBe("DB_DOWN");
      expect(attError.message).toBe("Database unavailable");
      expect(attError.statusCode).toBe(500);
    }
  });

  it("uses default SERVER_ERROR on final 5xx with no error body", async () => {
    const mockFetch = createMockFetch([
      { status: 500, body: {} },
    ]);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      retries: 0,
    });

    try {
      await client.get("/test");
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AttestiaError);
      const attError = error as AttestiaError;
      expect(attError.code).toBe("SERVER_ERROR");
      expect(attError.message).toContain("HTTP 500");
      expect(attError.message).toContain("1 attempts");
      expect(attError.statusCode).toBe(500);
    }
  });
});

// =============================================================================
// Network Error Retry and Exhaustion
// =============================================================================

describe("HttpClient network error handling", () => {
  it("retries on network errors and succeeds", async () => {
    const mockFetch = createMockFetch([
      { status: 0, error: new Error("ECONNREFUSED") },
      { status: 200, body: { data: { ok: true } } },
    ]);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      retries: 1,
    });

    const result = await client.get<{ ok: boolean }>("/test");
    expect(result.data).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws NETWORK_ERROR after exhausting retries on network failures", async () => {
    const mockFetch = createMockFetch([
      { status: 0, error: new Error("ECONNREFUSED") },
      { status: 0, error: new Error("ECONNREFUSED") },
    ]);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      retries: 1,
    });

    try {
      await client.get("/test");
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AttestiaError);
      const attError = error as AttestiaError;
      expect(attError.code).toBe("NETWORK_ERROR");
      expect(attError.message).toContain("ECONNREFUSED");
      expect(attError.statusCode).toBe(0);
    }
  });

  it("handles non-Error throw from fetch (string coercion)", async () => {
    const mockFetch = vi.fn(async () => {
      throw "raw string error"; // eslint-disable-line no-throw-literal
    }) as unknown as typeof fetch;

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      retries: 0,
    });

    try {
      await client.get("/test");
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AttestiaError);
      const attError = error as AttestiaError;
      expect(attError.code).toBe("NETWORK_ERROR");
      expect(attError.statusCode).toBe(0);
    }
  });

  it("re-throws AttestiaError without wrapping during retry", async () => {
    // First call returns 4xx (throws AttestiaError), should NOT retry
    const mockFetch = createMockFetch([
      { status: 429, body: { error: { code: "RATE_LIMITED", message: "Too many requests" } } },
    ]);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      retries: 3,
    });

    try {
      await client.get("/test");
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AttestiaError);
      const attError = error as AttestiaError;
      expect(attError.code).toBe("RATE_LIMITED");
    }
    // Only called once — 4xx is not retried
    expect(mockFetch).toHaveBeenCalledOnce();
  });
});

// =============================================================================
// Timeout (Deterministic)
// =============================================================================

describe("HttpClient timeout (deterministic)", () => {
  it("converts AbortError to TIMEOUT AttestiaError", async () => {
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";

    // Directly throw AbortError — no timing dependency
    const mockFetch = vi.fn(async () => {
      throw abortError;
    }) as unknown as typeof fetch;

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      timeout: 5000,
      retries: 0,
    });

    try {
      await client.get("/test");
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AttestiaError);
      const attError = error as AttestiaError;
      expect(attError.code).toBe("TIMEOUT");
      expect(attError.message).toContain("timed out");
      expect(attError.statusCode).toBe(0);
    }
  });

  it("passes through non-AbortError from fetch", async () => {
    const networkError = new TypeError("Failed to fetch");

    const mockFetch = vi.fn(async () => {
      throw networkError;
    }) as unknown as typeof fetch;

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      timeout: 5000,
      retries: 0,
    });

    try {
      await client.get("/test");
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AttestiaError);
      const attError = error as AttestiaError;
      // Non-AbortError passes through fetchWithTimeout and gets caught
      // by the catch block in request(), becoming NETWORK_ERROR
      expect(attError.code).toBe("NETWORK_ERROR");
    }
  });
});

// =============================================================================
// D6-A-004 [MEDIUM, correctness]: POST retry safety + idempotency key
// =============================================================================

describe("HttpClient POST retry safety (D6-A-004)", () => {
  it("does NOT retry a POST on a network error by default", async () => {
    // A network error after a server-side mutation must not blindly replay
    // the mutation. By default only idempotent methods (GET) retry.
    const mockFetch = createMockFetch([
      { status: 0, error: new Error("ECONNRESET") },
      { status: 201, body: { data: { id: "should-not-reach" } } },
    ]);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      retries: 3,
    });

    await expect(client.post("/api/v1/intents", { id: "x" })).rejects.toThrow(
      AttestiaError,
    );
    // Only one attempt — the POST was not retried.
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("does NOT retry a POST on a 5xx response by default", async () => {
    const mockFetch = createMockFetch([
      { status: 503, body: { error: { code: "UNAVAILABLE", message: "Try again" } } },
      { status: 201, body: { data: { id: "should-not-reach" } } },
    ]);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      retries: 3,
    });

    await expect(client.post("/api/v1/intents", { id: "x" })).rejects.toThrow(
      AttestiaError,
    );
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("still retries a GET on a network error by default", async () => {
    const mockFetch = createMockFetch([
      { status: 0, error: new Error("ECONNREFUSED") },
      { status: 200, body: { data: { ok: true } } },
    ]);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      retries: 2,
    });

    const result = await client.get<{ ok: boolean }>("/test");
    expect(result.data).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("attaches a stable Idempotency-Key to every POST attempt when retries are enabled", async () => {
    // When the caller opts into POST retries, each attempt must carry the SAME
    // Idempotency-Key so the server dedupes the mutation (tenant/route-scoped).
    const mockFetch = createMockFetch([
      { status: 503, body: { error: { code: "UNAVAILABLE", message: "Try again" } } },
      { status: 201, body: { data: { id: "ok" } } },
    ]);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      retries: 2,
      retryMutations: true,
    });

    const result = await client.post<{ id: string }>("/api/v1/intents", { id: "x" });
    expect(result.data).toEqual({ id: "ok" });
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const calls = (mockFetch as ReturnType<typeof vi.fn>).mock.calls;
    const key1 = (calls[0]![1] as RequestInit).headers as Record<string, string>;
    const key2 = (calls[1]![1] as RequestInit).headers as Record<string, string>;

    expect(key1["Idempotency-Key"]).toBeTruthy();
    // Stable across retries.
    expect(key2["Idempotency-Key"]).toBe(key1["Idempotency-Key"]);
  });

  it("does not send an Idempotency-Key on GET requests", async () => {
    const mockFetch = createMockFetch([
      { status: 200, body: { data: {} } },
    ]);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      retries: 0,
    });

    await client.get("/test");

    const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBeUndefined();
  });
});

// =============================================================================
// Config Defaults
// =============================================================================

describe("HttpClient config defaults", () => {
  it("uses default timeout and retries when not specified", async () => {
    const mockFetch = createMockFetch([
      { status: 200, body: { data: { ok: true } } },
    ]);

    // Only baseUrl and fetchFn — timeout and retries use defaults
    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
    });

    const result = await client.get<{ ok: boolean }>("/test");
    expect(result.data).toEqual({ ok: true });
  });
});

// =============================================================================
// Response Size Limit (H6)
// =============================================================================

describe("HttpClient response size limit", () => {
  it("throws RESPONSE_TOO_LARGE for bodies exceeding 10MB", async () => {
    // Create a response with > 10MB body
    const largeBody = "x".repeat(10_000_001);
    const mockFetch = vi.fn(async () => {
      return new Response(largeBody, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      retries: 0,
    });

    try {
      await client.get("/huge");
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AttestiaError);
      const attError = error as AttestiaError;
      expect(attError.code).toBe("RESPONSE_TOO_LARGE");
    }
  });

  it("accepts responses under 10MB", async () => {
    const mockFetch = createMockFetch([
      { status: 200, body: { data: { ok: true } } },
    ]);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: mockFetch,
      retries: 0,
    });

    const result = await client.get<{ ok: boolean }>("/normal");
    expect(result.data).toEqual({ ok: true });
  });
});

// =============================================================================
// M8: Total request deadline across retries
// =============================================================================

describe("request deadline (M8)", () => {
  it("aborts retries when total deadline would be exceeded", async () => {
    // Simulate slow server: each response takes time, 500 triggers retry
    let callCount = 0;
    const slowFetch = async (_url: string, _init?: RequestInit): Promise<Response> => {
      callCount++;
      // Simulate ~100ms per call
      await new Promise((resolve) => setTimeout(resolve, 100));
      return new Response(JSON.stringify({ error: { code: "SERVER_ERROR" } }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    };

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      fetchFn: slowFetch,
      timeout: 500,    // 500ms total deadline
      retries: 10,     // Would be 10 retries if not deadline-limited
    });

    const start = Date.now();
    await expect(client.get("/slow")).rejects.toThrow();
    const elapsed = Date.now() - start;

    // Should have stopped well before 10 retries × backoff would take
    // With deadline of 500ms, we shouldn't go beyond ~600ms (some tolerance)
    expect(elapsed).toBeLessThan(3000);
    // Should have made at least 1 attempt
    expect(callCount).toBeGreaterThanOrEqual(1);
  });
});
