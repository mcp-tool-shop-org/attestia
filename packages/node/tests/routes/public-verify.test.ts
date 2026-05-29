/**
 * Public Verification Routes Tests
 *
 * Verifies:
 * - Health endpoint returns status
 * - State bundle endpoint returns data
 * - CORS headers present
 * - No auth required
 * - Rate limiting enforced
 * - Custom getBundleFn integration
 * - Report submission + validation
 * - Report listing + pagination
 * - Consensus computation
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../../src/app.js";
import type { AppInstance } from "../../src/app.js";
import type { PublicVerifyDeps } from "../../src/routes/public-verify.js";

// =============================================================================
// Helpers
// =============================================================================

function makeRequest(
  path: string,
  method: string = "GET",
  body?: unknown,
  headers?: Record<string, string>,
): Request {
  const init: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new Request(`http://localhost${path}`, init);
}

function createTestAppWithPublicVerify(
  publicVerify?: PublicVerifyDeps,
): AppInstance {
  return createApp({
    serviceConfig: {
      ownerId: "test-tenant",
      defaultCurrency: "USDC",
      defaultDecimals: 6,
    },
    publicVerify,
  });
}

function makeValidReport(verifierId: string, verdict: "PASS" | "FAIL" = "PASS") {
  return {
    reportId: `report-${verifierId}-${Date.now()}`,
    verifierId,
    verdict,
    subsystemChecks: [
      { subsystem: "ledger", expected: "a".repeat(64), actual: "a".repeat(64), matches: true },
    ],
    discrepancies: verdict === "FAIL" ? ["some mismatch"] : [],
    bundleHash: "b".repeat(64),
    verifiedAt: "2025-06-15T00:00:00Z",
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("GET /public/v1/verify/health", () => {
  let instance: AppInstance;

  beforeEach(() => {
    instance = createTestAppWithPublicVerify();
  });

  it("returns 200 with status ok", async () => {
    const res = await instance.app.request(makeRequest("/public/v1/verify/health"));

    expect(res.status).toBe(200);

    const body = (await res.json()) as { data: { status: string; timestamp: string } };
    expect(body.data.status).toBe("ok");
    expect(body.data.timestamp).toBeTruthy();
  });

  it("denies CORS by default (no corsOrigins configured)", async () => {
    const res = await instance.app.request(
      makeRequest("/public/v1/verify/health", "GET", undefined, {
        Origin: "https://external-verifier.example.com",
      }),
    );

    expect(res.status).toBe(200);
    // Default: no allowed origins → empty or absent CORS header
    const acao = res.headers.get("access-control-allow-origin");
    expect(acao === null || acao === "").toBe(true);
  });

  it("responds to OPTIONS preflight", async () => {
    const res = await instance.app.request(
      makeRequest("/public/v1/verify/health", "OPTIONS", undefined, {
        Origin: "https://external-verifier.example.com",
        "Access-Control-Request-Method": "GET",
      }),
    );

    // CORS preflight should succeed (2xx)
    expect(res.status).toBeLessThan(300);
  });

  it("does not require auth headers", async () => {
    // No X-Api-Key, no Authorization header
    const res = await instance.app.request(makeRequest("/public/v1/verify/health"));

    expect(res.status).toBe(200);
  });
});

describe("GET /public/v1/verify/state-bundle", () => {
  it("returns default placeholder when no getBundleFn configured", async () => {
    const instance = createTestAppWithPublicVerify();
    const res = await instance.app.request(makeRequest("/public/v1/verify/state-bundle"));

    expect(res.status).toBe(200);

    const body = (await res.json()) as { data: { version: number; message: string } };
    expect(body.data.version).toBe(1);
    expect(body.data.message).toBeTruthy();
  });

  it("returns custom bundle when getBundleFn is provided", async () => {
    const mockBundle = {
      version: 1,
      bundleHash: "a".repeat(64),
      globalStateHash: { hash: "b".repeat(64) },
      exportedAt: "2025-06-15T00:00:00Z",
    };

    const instance = createTestAppWithPublicVerify({
      getBundleFn: () => mockBundle,
    });

    const res = await instance.app.request(makeRequest("/public/v1/verify/state-bundle"));

    expect(res.status).toBe(200);

    const body = (await res.json()) as { data: typeof mockBundle };
    expect(body.data.bundleHash).toBe("a".repeat(64));
    expect(body.data.exportedAt).toBe("2025-06-15T00:00:00Z");
  });

  it("includes rate limit header", async () => {
    const instance = createTestAppWithPublicVerify({
      rateLimitConfig: { rpm: 10, burst: 5 },
    });

    const res = await instance.app.request(makeRequest("/public/v1/verify/state-bundle"));

    expect(res.status).toBe(200);
    expect(res.headers.get("x-ratelimit-remaining")).toBeTruthy();
  });
});

describe("public rate limiting", () => {
  it("enforces rate limit after burst exhaustion", async () => {
    const instance = createTestAppWithPublicVerify({
      rateLimitConfig: { rpm: 10, burst: 3 },
    });

    // Exhaust the burst
    for (let i = 0; i < 3; i++) {
      const res = await instance.app.request(makeRequest("/public/v1/verify/health"));
      expect(res.status).toBe(200);
    }

    // Next request should be rate limited
    const res = await instance.app.request(makeRequest("/public/v1/verify/health"));
    expect(res.status).toBe(429);

    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(res.headers.get("retry-after")).toBeTruthy();
  });

  it("returns X-RateLimit-Remaining header", async () => {
    const instance = createTestAppWithPublicVerify({
      rateLimitConfig: { rpm: 10, burst: 5 },
    });

    const res = await instance.app.request(makeRequest("/public/v1/verify/health"));

    expect(res.status).toBe(200);
    const remaining = res.headers.get("x-ratelimit-remaining");
    expect(remaining).toBeTruthy();
    expect(Number(remaining)).toBeLessThanOrEqual(4);
  });
});

describe("public routes do not interfere with API routes", () => {
  it("API routes still work alongside public routes", async () => {
    const instance = createTestAppWithPublicVerify();

    // Public route works
    const publicRes = await instance.app.request(makeRequest("/public/v1/verify/health"));
    expect(publicRes.status).toBe(200);

    // Health route still works
    const healthRes = await instance.app.request(makeRequest("/health"));
    expect(healthRes.status).toBe(200);
  });
});

// =============================================================================
// Report Submission
// =============================================================================

describe("POST /public/v1/verify/submit-report", () => {
  let instance: AppInstance;

  beforeEach(() => {
    instance = createTestAppWithPublicVerify();
  });

  it("accepts a valid report and returns 201", async () => {
    const report = makeValidReport("alice");
    const res = await instance.app.request(
      makeRequest("/public/v1/verify/submit-report", "POST", report),
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { reportId: string; accepted: boolean; totalReports: number } };
    expect(body.data.accepted).toBe(true);
    expect(body.data.reportId).toBe(report.reportId);
    expect(body.data.totalReports).toBe(1);
  });

  it("rejects duplicate report ID with 409", async () => {
    const report = makeValidReport("alice");
    await instance.app.request(
      makeRequest("/public/v1/verify/submit-report", "POST", report),
    );

    const res = await instance.app.request(
      makeRequest("/public/v1/verify/submit-report", "POST", report),
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CONFLICT");
  });

  it("rejects invalid report with 400", async () => {
    const res = await instance.app.request(
      makeRequest("/public/v1/verify/submit-report", "POST", {
        // Missing required fields
        verifierId: "alice",
      }),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects report with empty body", async () => {
    const res = await instance.app.request(
      makeRequest("/public/v1/verify/submit-report", "POST", {}),
    );

    expect(res.status).toBe(400);
  });

  it("accepts multiple reports from different verifiers", async () => {
    const r1 = makeValidReport("alice", "PASS");
    const r2 = makeValidReport("bob", "FAIL");

    await instance.app.request(
      makeRequest("/public/v1/verify/submit-report", "POST", r1),
    );
    const res = await instance.app.request(
      makeRequest("/public/v1/verify/submit-report", "POST", r2),
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { totalReports: number } };
    expect(body.data.totalReports).toBe(2);
  });
});

// =============================================================================
// Report Listing
// =============================================================================

describe("GET /public/v1/verify/reports", () => {
  it("returns empty list when no reports submitted", async () => {
    const instance = createTestAppWithPublicVerify();
    const res = await instance.app.request(makeRequest("/public/v1/verify/reports"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[]; pagination: { total: number } };
    expect(body.data).toEqual([]);
    expect(body.pagination.total).toBe(0);
  });

  it("returns submitted reports", async () => {
    const instance = createTestAppWithPublicVerify();

    // Submit 2 reports
    await instance.app.request(
      makeRequest("/public/v1/verify/submit-report", "POST", makeValidReport("alice", "PASS")),
    );
    await instance.app.request(
      makeRequest("/public/v1/verify/submit-report", "POST", makeValidReport("bob", "FAIL")),
    );

    const res = await instance.app.request(makeRequest("/public/v1/verify/reports"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ verifierId: string }>;
      pagination: { total: number; hasMore: boolean };
    };
    expect(body.data.length).toBe(2);
    expect(body.pagination.total).toBe(2);
    expect(body.pagination.hasMore).toBe(false);
  });

  it("respects limit parameter", async () => {
    const instance = createTestAppWithPublicVerify();

    // Submit 3 reports
    for (let i = 0; i < 3; i++) {
      await instance.app.request(
        makeRequest("/public/v1/verify/submit-report", "POST", makeValidReport(`v${i}`)),
      );
    }

    const res = await instance.app.request(makeRequest("/public/v1/verify/reports?limit=2"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: unknown[];
      pagination: { total: number; hasMore: boolean; limit: number };
    };
    expect(body.data.length).toBe(2);
    expect(body.pagination.limit).toBe(2);
    expect(body.pagination.hasMore).toBe(true);
  });
});

// =============================================================================
// Consensus
// =============================================================================

describe("GET /public/v1/verify/consensus", () => {
  it("returns FAIL with 0 verifiers when no reports", async () => {
    const instance = createTestAppWithPublicVerify();
    const res = await instance.app.request(makeRequest("/public/v1/verify/consensus"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { verdict: string; totalVerifiers: number; quorumReached: boolean };
    };
    expect(body.data.verdict).toBe("FAIL");
    expect(body.data.totalVerifiers).toBe(0);
    expect(body.data.quorumReached).toBe(false);
  });

  it("returns PASS consensus when all verifiers pass", async () => {
    const instance = createTestAppWithPublicVerify();

    await instance.app.request(
      makeRequest("/public/v1/verify/submit-report", "POST", makeValidReport("v1", "PASS")),
    );
    await instance.app.request(
      makeRequest("/public/v1/verify/submit-report", "POST", makeValidReport("v2", "PASS")),
    );

    const res = await instance.app.request(makeRequest("/public/v1/verify/consensus"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        verdict: string;
        totalVerifiers: number;
        passCount: number;
        failCount: number;
        agreementRatio: number;
      };
    };
    expect(body.data.verdict).toBe("PASS");
    expect(body.data.totalVerifiers).toBe(2);
    expect(body.data.passCount).toBe(2);
    expect(body.data.failCount).toBe(0);
    expect(body.data.agreementRatio).toBe(1);
  });

  it("returns FAIL consensus when majority fails", async () => {
    const instance = createTestAppWithPublicVerify();

    await instance.app.request(
      makeRequest("/public/v1/verify/submit-report", "POST", makeValidReport("v1", "PASS")),
    );
    await instance.app.request(
      makeRequest("/public/v1/verify/submit-report", "POST", makeValidReport("v2", "FAIL")),
    );
    await instance.app.request(
      makeRequest("/public/v1/verify/submit-report", "POST", makeValidReport("v3", "FAIL")),
    );

    const res = await instance.app.request(makeRequest("/public/v1/verify/consensus"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { verdict: string; passCount: number; failCount: number; dissenters: string[] };
    };
    expect(body.data.verdict).toBe("FAIL");
    expect(body.data.failCount).toBe(2);
    expect(body.data.dissenters).toEqual(["v1"]);
  });

  it("respects minimum verifier threshold", async () => {
    const instance = createTestAppWithPublicVerify({ minimumVerifiers: 3 });

    // Only 1 verifier — quorum not reached
    await instance.app.request(
      makeRequest("/public/v1/verify/submit-report", "POST", makeValidReport("v1", "PASS")),
    );

    const res = await instance.app.request(makeRequest("/public/v1/verify/consensus"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { quorumReached: boolean } };
    expect(body.data.quorumReached).toBe(false);
  });

  // ===========================================================================
  // V1-003 [MEDIUM, fail-closed]: a lone (possibly operator-controlled)
  // verifier must NOT yield an authoritative PASS over the PUBLIC, trust-free
  // endpoint. The public consensus route defaults minimumVerifiers to 2.
  // ===========================================================================

  it("does NOT return an authoritative PASS for a single verifier by default (fail-closed)", async () => {
    // No minimumVerifiers override → public default of 2 applies.
    const instance = createTestAppWithPublicVerify();

    await instance.app.request(
      makeRequest("/public/v1/verify/submit-report", "POST", makeValidReport("solo", "PASS")),
    );

    const res = await instance.app.request(makeRequest("/public/v1/verify/consensus"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        verdict: string;
        quorumReached: boolean;
        totalVerifiers: number;
        singleVerifierPass: boolean;
      };
    };

    // Quorum of 2 is not met by a single verifier → verdict is NOT an
    // authoritative PASS, and the weak-quorum flag is not raised.
    expect(body.data.totalVerifiers).toBe(1);
    expect(body.data.quorumReached).toBe(false);
    expect(body.data.verdict).toBe("FAIL");
    expect(body.data.singleVerifierPass).toBe(false);
  });

  it("returns an authoritative PASS once the public 2-verifier quorum is met", async () => {
    const instance = createTestAppWithPublicVerify();

    await instance.app.request(
      makeRequest("/public/v1/verify/submit-report", "POST", makeValidReport("v1", "PASS")),
    );
    await instance.app.request(
      makeRequest("/public/v1/verify/submit-report", "POST", makeValidReport("v2", "PASS")),
    );

    const res = await instance.app.request(makeRequest("/public/v1/verify/consensus"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { verdict: string; quorumReached: boolean; singleVerifierPass: boolean };
    };
    expect(body.data.verdict).toBe("PASS");
    expect(body.data.quorumReached).toBe(true);
    // Quorum threshold was 2 (>1), so this is not a weak single-verifier PASS.
    expect(body.data.singleVerifierPass).toBe(false);
  });

  it("still honors an explicit higher quorum override", async () => {
    const instance = createTestAppWithPublicVerify({ minimumVerifiers: 5 });

    for (let i = 0; i < 3; i++) {
      await instance.app.request(
        makeRequest("/public/v1/verify/submit-report", "POST", makeValidReport(`v${i}`, "PASS")),
      );
    }

    const res = await instance.app.request(makeRequest("/public/v1/verify/consensus"));
    const body = (await res.json()) as { data: { verdict: string; quorumReached: boolean } };
    expect(body.data.quorumReached).toBe(false);
    expect(body.data.verdict).toBe("FAIL");
  });

  it("exposes singleVerifierPass in the consensus payload", async () => {
    const instance = createTestAppWithPublicVerify();
    const res = await instance.app.request(makeRequest("/public/v1/verify/consensus"));
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data).toHaveProperty("singleVerifierPass");
    expect(typeof body.data.singleVerifierPass).toBe("boolean");
  });
});

// =============================================================================
// M3: CORS origin configuration
// =============================================================================

describe("CORS origin configuration (M3)", () => {
  it("allows configured origin", async () => {
    const instance = createTestAppWithPublicVerify({
      corsOrigins: ["https://verifier.example.com"],
    });

    const res = await instance.app.request(
      makeRequest("/public/v1/verify/health", "GET", undefined, {
        Origin: "https://verifier.example.com",
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://verifier.example.com");
  });

  it("rejects unconfigured origin", async () => {
    const instance = createTestAppWithPublicVerify({
      corsOrigins: ["https://verifier.example.com"],
    });

    const res = await instance.app.request(
      makeRequest("/public/v1/verify/health", "GET", undefined, {
        Origin: "https://evil.example.com",
      }),
    );

    expect(res.status).toBe(200);
    const acao = res.headers.get("access-control-allow-origin");
    expect(acao === null || acao === "").toBe(true);
  });

  it("maxAge is 3600 (1 hour)", async () => {
    const instance = createTestAppWithPublicVerify({
      corsOrigins: ["https://verifier.example.com"],
    });

    const res = await instance.app.request(
      makeRequest("/public/v1/verify/health", "OPTIONS", undefined, {
        Origin: "https://verifier.example.com",
        "Access-Control-Request-Method": "GET",
      }),
    );

    expect(res.headers.get("access-control-max-age")).toBe("3600");
  });
});
