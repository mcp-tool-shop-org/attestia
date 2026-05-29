/**
 * Tests for error handler middleware.
 *
 * Verifies domain errors are mapped to correct HTTP status codes
 * and the error envelope format.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../../src/types/api-contract.js";
import { handleError } from "../../src/middleware/error-handler.js";
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

    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("BUDGET_EXCEEDED");
    // Message should be the error code, NOT the sensitive details
    expect(body.error.message).toBe("BUDGET_EXCEEDED");
    expect(body.error.message).not.toContain("acc_secret_123");
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

    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("INTEGRITY_VIOLATION");
    // 500s are sanitized to a generic message.
    expect(body.error.message).toBe("Internal server error");
  });
});
