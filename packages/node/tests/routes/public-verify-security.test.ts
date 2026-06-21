/**
 * Security tests for the public verification routes (A-NODE-004, A-VERIFY-001).
 *
 * A-NODE-004:
 *  (a) the unauthenticated report store is bounded (FIFO eviction at the cap);
 *  (b) X-Forwarded-For is NOT trusted by default — a client cannot rotate a
 *      forged XFF header to evade the per-IP public rate limit.
 *
 * A-VERIFY-001 (route side):
 *  - one verifierId cannot contribute multiple reports toward quorum (a second
 *    report from the same verifierId REPLACES the first rather than appending);
 *  - a report whose bundleHash disagrees with the established bundle is rejected.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../../src/app.js";
import type { AppInstance } from "../../src/app.js";
import type { PublicVerifyDeps } from "../../src/routes/public-verify.js";

function makeRequest(
  path: string,
  method: string = "GET",
  body?: unknown,
  headers?: Record<string, string>,
): Request {
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", ...headers },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(`http://localhost${path}`, init);
}

function createTestApp(publicVerify?: PublicVerifyDeps): AppInstance {
  return createApp({
    serviceConfig: { ownerId: "test-tenant", defaultCurrency: "USDC", defaultDecimals: 6 },
    publicVerify,
  });
}

const BUNDLE = "b".repeat(64);

function report(
  verifierId: string,
  verdict: "PASS" | "FAIL" = "PASS",
  overrides: Partial<{ reportId: string; bundleHash: string }> = {},
) {
  return {
    reportId: overrides.reportId ?? `report-${verifierId}-${Math.random().toString(36).slice(2)}`,
    verifierId,
    verdict,
    subsystemChecks: [
      { subsystem: "ledger", expected: "a".repeat(64), actual: "a".repeat(64), matches: true },
    ],
    discrepancies: verdict === "FAIL" ? ["mismatch"] : [],
    bundleHash: overrides.bundleHash ?? BUNDLE,
    verifiedAt: "2025-06-15T00:00:00Z",
  };
}

async function submit(instance: AppInstance, r: unknown): Promise<Response> {
  return instance.app.request(makeRequest("/public/v1/verify/submit-report", "POST", r));
}

// =============================================================================
// A-VERIFY-001 — distinct verifierId quorum
// =============================================================================

describe("A-VERIFY-001 — one verifierId counts once toward quorum", () => {
  let instance: AppInstance;
  beforeEach(() => {
    // Generous rate limit so submissions are not throttled.
    instance = createTestApp({ rateLimitConfig: { rpm: 1000, burst: 1000 } });
  });

  it("REPLACES a second report from the same verifierId rather than appending", async () => {
    const r1 = await submit(instance, report("alice", "PASS"));
    expect(r1.status).toBe(201);
    const b1 = (await r1.json()) as { data: { totalReports: number; replaced: boolean } };
    expect(b1.data.totalReports).toBe(1);
    expect(b1.data.replaced).toBe(false);

    const r2 = await submit(instance, report("alice", "PASS"));
    expect(r2.status).toBe(201);
    const b2 = (await r2.json()) as { data: { totalReports: number; replaced: boolean } };
    // Still only ONE report for alice — she cannot stuff the ballot.
    expect(b2.data.totalReports).toBe(1);
    expect(b2.data.replaced).toBe(true);
  });

  it("a single verifier double-submitting does NOT reach the 2-verifier public quorum", async () => {
    await submit(instance, report("solo", "PASS"));
    await submit(instance, report("solo", "PASS"));
    await submit(instance, report("solo", "PASS"));

    const res = await instance.app.request(makeRequest("/public/v1/verify/consensus"));
    const body = (await res.json()) as {
      data: { totalVerifiers: number; quorumReached: boolean; verdict: string };
    };
    expect(body.data.totalVerifiers).toBe(1);
    expect(body.data.quorumReached).toBe(false);
    expect(body.data.verdict).toBe("FAIL");
  });

  it("rejects a report whose bundleHash disagrees with the established bundle", async () => {
    const r1 = await submit(instance, report("alice", "PASS", { bundleHash: BUNDLE }));
    expect(r1.status).toBe(201);

    const r2 = await submit(
      instance,
      report("bob", "PASS", { bundleHash: "c".repeat(64) }),
    );
    expect(r2.status).toBe(409);
    const body = (await r2.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CONFLICT");
  });

  it("accepts reports from distinct verifiers that share the same bundle", async () => {
    await submit(instance, report("alice", "PASS"));
    const r2 = await submit(instance, report("bob", "PASS"));
    expect(r2.status).toBe(201);

    const res = await instance.app.request(makeRequest("/public/v1/verify/consensus"));
    const body = (await res.json()) as {
      data: { totalVerifiers: number; quorumReached: boolean; verdict: string };
    };
    expect(body.data.totalVerifiers).toBe(2);
    expect(body.data.quorumReached).toBe(true);
    expect(body.data.verdict).toBe("PASS");
  });
});

// =============================================================================
// A-NODE-004 — bounded store
// =============================================================================

describe("A-NODE-004 — bounded report store (FIFO eviction)", () => {
  it("never exceeds the configured maxReports cap", async () => {
    const instance = createTestApp({
      rateLimitConfig: { rpm: 100000, burst: 100000 },
      maxReports: 5,
    });

    for (let i = 0; i < 20; i++) {
      const res = await submit(instance, report(`verifier-${i}`, "PASS"));
      expect(res.status).toBe(201);
      const body = (await res.json()) as { data: { totalReports: number } };
      expect(body.data.totalReports).toBeLessThanOrEqual(5);
    }

    const listed = await instance.app.request(makeRequest("/public/v1/verify/reports?limit=100"));
    const lb = (await listed.json()) as { pagination: { total: number } };
    expect(lb.pagination.total).toBe(5);
  });
});

// =============================================================================
// A-NODE-004 — X-Forwarded-For not trusted by default
// =============================================================================

describe("A-NODE-004 — public rate limit does not trust X-Forwarded-For by default", () => {
  it("a forged, rotating XFF header does NOT grant fresh buckets (shared bucket)", async () => {
    // burst of 3; default trustProxy=false. In the in-memory test path the
    // socket address resolves to a single stable key, so all requests share one
    // bucket regardless of the spoofed XFF value.
    const instance = createTestApp({ rateLimitConfig: { rpm: 1, burst: 3 } });

    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await instance.app.request(
        makeRequest("/public/v1/verify/health", "GET", undefined, {
          "X-Forwarded-For": `10.0.0.${i}`, // attacker rotates the header
        }),
      );
      statuses.push(res.status);
    }

    // First 3 allowed, then throttled — the forged header did NOT reset the bucket.
    expect(statuses.filter((s) => s === 200).length).toBe(3);
    expect(statuses).toContain(429);
  });

  it("trustProxy=true DOES segregate buckets by the first XFF hop", async () => {
    const instance = createTestApp({
      rateLimitConfig: { rpm: 1, burst: 1 },
      trustProxy: true,
    });

    // Distinct XFF clients each get their own (burst=1) bucket → both allowed.
    const a = await instance.app.request(
      makeRequest("/public/v1/verify/health", "GET", undefined, {
        "X-Forwarded-For": "203.0.113.10",
      }),
    );
    const b = await instance.app.request(
      makeRequest("/public/v1/verify/health", "GET", undefined, {
        "X-Forwarded-For": "203.0.113.20",
      }),
    );
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    // A second hit from the FIRST client (same XFF) exhausts its burst → 429.
    const aAgain = await instance.app.request(
      makeRequest("/public/v1/verify/health", "GET", undefined, {
        "X-Forwarded-For": "203.0.113.10",
      }),
    );
    expect(aAgain.status).toBe(429);
  });
});
