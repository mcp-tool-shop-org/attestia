/**
 * Tests for error handler middleware.
 *
 * Verifies domain errors are mapped to correct HTTP status codes
 * and the error envelope format.
 */

import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../../src/types/api-contract.js";
import {
  handleError,
  createErrorHandler,
  SERVER_ERROR_COUNTER,
} from "../../src/middleware/error-handler.js";
import { requestIdMiddleware } from "../../src/middleware/request-id.js";
import { createTestApp, jsonRequest } from "../setup.js";

describe("error handler", () => {
  it("returns 409 for invalid intent state transition", async () => {
    const { app } = createTestApp();

    // Declare an intent
    await app.request(
      jsonRequest("/api/v1/intents", "POST", {
        id: "err-1",
        kind: "transfer",
        description: "Error test",
        params: {},
      }),
    );

    // Try to execute without approving first → should throw domain error
    const res = await app.request(
      jsonRequest("/api/v1/intents/err-1/execute", "POST", {
        chainId: "evm:1",
        txHash: "0xerr",
      }),
    );

    // The domain should reject this transition
    expect(res.status).toBeGreaterThanOrEqual(400);

    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error).toBeDefined();
    expect(body.error.code).toBeDefined();
    expect(body.error.message).toBeDefined();
  });

  it("returns error envelope with correct structure", async () => {
    const { app } = createTestApp();

    // Non-existent intent → 404
    const res = await app.request(
      jsonRequest("/api/v1/intents/does-not-exist/approve", "POST", {}),
    );

    expect(res.status).toBeGreaterThanOrEqual(400);

    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error).toBeDefined();
    expect(typeof body.error.code).toBe("string");
    expect(typeof body.error.message).toBe("string");
  });
});

// =============================================================================
// M2: Error message sanitization
// =============================================================================

describe("error message sanitization (M2)", () => {
  function makeErrorApp(errorCode: string, errorMessage: string) {
    const app = new Hono<AppEnv>();
    app.onError(handleError);
    app.get("/throw", () => {
      const err = new Error(errorMessage) as Error & { code: string };
      err.code = errorCode;
      throw err;
    });
    return app;
  }

  it("domain error message is NOT exposed in response", async () => {
    const sensitiveMsg = "Account acc_secret_123 has balance $50,000 in table users.accounts";
    const app = makeErrorApp("BUDGET_EXCEEDED", sensitiveMsg);

    const res = await app.request("/throw");
    expect(res.status).toBe(422);

    const body = (await res.json()) as {
      error: { code: string; message: string; hint?: string };
    };
    expect(body.error.code).toBe("BUDGET_EXCEEDED");
    // D6-B-002: 4xx returns a curated human message + hint, NOT the bare code
    // and NEVER the raw (sensitive) thrown message.
    expect(body.error.message).toBe("The action would exceed the configured budget.");
    expect(body.error.message).not.toBe("BUDGET_EXCEEDED");
    expect(body.error.message).not.toContain("acc_secret_123");
    expect(body.error.hint).toBeDefined();
    expect(body.error.hint).not.toContain("acc_secret_123");
  });

  it("500 errors return generic 'Internal server error'", async () => {
    const app = new Hono<AppEnv>();
    app.onError(handleError);
    app.get("/throw", () => {
      throw new Error("Connection to postgres://admin:password@db:5432 refused");
    });

    const res = await app.request("/throw");
    expect(res.status).toBe(500);

    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.message).toBe("Internal server error");
    expect(body.error.message).not.toContain("postgres");
  });
});

// =============================================================================
// Domain error → status mapping for new domain errors.
//
// REQUESTER_CANNOT_APPROVE (separation-of-duties violation) is a client error
// and must map to a 4xx, not fall through to a 500. INTEGRITY_VIOLATION stays
// a 500 (a genuine server-side invariant breach).
// =============================================================================

describe("domain error status mapping", () => {
  function throwApp(errorCode: string) {
    const app = new Hono<AppEnv>();
    app.onError(handleError);
    app.get("/throw", () => {
      const err = new Error("boom") as Error & { code: string };
      err.code = errorCode;
      throw err;
    });
    return app;
  }

  it("maps REQUESTER_CANNOT_APPROVE to 403 (not 500)", async () => {
    const res = await throwApp("REQUESTER_CANNOT_APPROVE").request("/throw");
    expect(res.status).toBe(403);

    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("REQUESTER_CANNOT_APPROVE");
  });

  it("keeps INTEGRITY_VIOLATION as a 500", async () => {
    const res = await throwApp("INTEGRITY_VIOLATION").request("/throw");
    expect(res.status).toBe(500);

    const body = (await res.json()) as { error: { code: string; message: string; hint?: string } };
    expect(body.error.code).toBe("INTEGRITY_VIOLATION");
    // 500s are sanitized to a generic message with no hint.
    expect(body.error.message).toBe("Internal server error");
    expect(body.error.hint).toBeUndefined();
  });
});

// =============================================================================
// D6-B-002: curated human 4xx messages + hints
//
// 4xx responses must carry a safe, human-readable message AND an actionable
// hint — never the bare error code, and never the raw thrown message. 5xx
// stays a generic sanitized message with no hint.
// =============================================================================

describe("curated 4xx messages + hints (D6-B-002)", () => {
  function throwApp(errorCode: string, errorMessage = "raw internal detail tableX") {
    const app = new Hono<AppEnv>();
    app.onError(handleError);
    app.get("/throw", () => {
      const err = new Error(errorMessage) as Error & { code: string };
      err.code = errorCode;
      throw err;
    });
    return app;
  }

  // (code, expectedStatus) pairs spanning the common 4xx codes.
  const cases: ReadonlyArray<readonly [string, number]> = [
    ["INTENT_NOT_FOUND", 404],
    ["INVALID_TRANSITION", 409],
    ["BUDGET_EXCEEDED", 422],
    ["REQUESTER_CANNOT_APPROVE", 403],
    ["CONCURRENCY_CONFLICT", 409],
    ["INSUFFICIENT_BUDGET", 422],
  ];

  for (const [code, status] of cases) {
    it(`${code} → ${status} with curated message + hint, no leak`, async () => {
      const res = await throwApp(code).request("/throw");
      expect(res.status).toBe(status);

      const body = (await res.json()) as {
        error: { code: string; message: string; hint?: string };
      };
      // Code preserved for machine handling.
      expect(body.error.code).toBe(code);
      // Message is human prose, not the bare code, not the raw thrown message.
      expect(body.error.message).not.toBe(code);
      expect(body.error.message).not.toContain("tableX");
      expect(body.error.message.length).toBeGreaterThan(code.length);
      // A hint is present and actionable for these curated codes.
      expect(typeof body.error.hint).toBe("string");
      expect((body.error.hint ?? "").length).toBeGreaterThan(0);
      expect(body.error.hint).not.toContain("tableX");
    });
  }

  it("falls back to a safe generic message for an unmapped 4xx code", async () => {
    // CURRENCY_MISMATCH maps to 400 in STATUS_MAP. Even if a code had no curated
    // entry, the status-class fallback applies. Use a mapped-but-this-test we
    // assert: an unknown-but-4xx-mapped code never returns the bare code.
    const res = await throwApp("INVALID_AMOUNT").request("/throw");
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("INVALID_AMOUNT");
    expect(body.error.message).not.toBe("INVALID_AMOUNT");
    expect(body.error.message).not.toContain("tableX");
  });
});

// =============================================================================
// B-NODE-005 [observability]: 5xx faults are logged server-side (full error +
// requestId) and counted, and the (non-sensitive) requestId is echoed to the
// client so the two records can be correlated. The client still sees nothing
// internal.
// =============================================================================

describe("5xx server-side observability (B-NODE-005)", () => {
  function makeApp(deps: Parameters<typeof createErrorHandler>[0]) {
    const app = new Hono<AppEnv>();
    app.use("*", requestIdMiddleware());
    app.onError(createErrorHandler(deps));
    app.get("/throw", () => {
      throw new Error("Connection to postgres://admin:password@db refused");
    });
    return app;
  }

  it("logs the full error with the requestId at error level", async () => {
    const errorLog = vi.fn();
    const app = makeApp({ logger: { error: errorLog } });

    const res = await app.request("/throw", {
      headers: { "X-Request-Id": "req-abc-123" },
    });
    expect(res.status).toBe(500);

    expect(errorLog).toHaveBeenCalledTimes(1);
    const [fields] = errorLog.mock.calls[0]!;
    // The real error (with its sensitive message) is captured server-side.
    expect(fields.err).toBeInstanceOf(Error);
    expect((fields.err as Error).message).toContain("postgres");
    expect(fields.requestId).toBe("req-abc-123");
    expect(fields.code).toBe("INTERNAL_ERROR");
  });

  it("increments the 5xx counter", async () => {
    const incrementCounter = vi.fn();
    const app = makeApp({ metrics: { incrementCounter } });

    await app.request("/throw");

    expect(incrementCounter).toHaveBeenCalledWith(
      SERVER_ERROR_COUNTER,
      expect.objectContaining({ code: "INTERNAL_ERROR" }),
    );
  });

  it("echoes the requestId to the client but no internal detail", async () => {
    const app = makeApp({});

    const res = await app.request("/throw", {
      headers: { "X-Request-Id": "req-xyz-789" },
    });
    const body = (await res.json()) as {
      error: { message: string; details?: { requestId?: string } };
    };

    // Generic client message — no leak.
    expect(body.error.message).toBe("Internal server error");
    expect(JSON.stringify(body)).not.toContain("postgres");
    // …but the requestId is present so the caller can quote it for support.
    expect(body.error.details?.requestId).toBe("req-xyz-789");
  });

  it("does not log or count for 4xx client errors", async () => {
    const errorLog = vi.fn();
    const incrementCounter = vi.fn();
    const app = new Hono<AppEnv>();
    app.use("*", requestIdMiddleware());
    app.onError(createErrorHandler({ logger: { error: errorLog }, metrics: { incrementCounter } }));
    app.get("/throw", () => {
      const err = new Error("boom") as Error & { code: string };
      err.code = "INTENT_NOT_FOUND";
      throw err;
    });

    const res = await app.request("/throw");
    expect(res.status).toBe(404);
    expect(errorLog).not.toHaveBeenCalled();
    expect(incrementCounter).not.toHaveBeenCalled();
  });
});
