/**
 * Treasury Routes Tests
 *
 * Covers payroll runs, distributions, and dual-gate funding via HTTP:
 * - 201 / 200 success shapes
 * - 400 validation failure
 * - 404 not-found
 * - cursor pagination
 * - permission denial (a viewer role hitting a write route gets 403)
 *
 * The app is constructed exactly as the rest of the suite does — full createApp,
 * default in-memory AttestiaService — so auth + tenant + the new routes are
 * exercised together. The permission-denial cases use a SECURED app with a
 * viewer API key (the default unsecured app injects synthetic admin auth, so it
 * cannot exercise a 403).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../../src/app.js";
import type { AppInstance } from "../../src/app.js";
import type { ApiKeyRecord } from "../../src/types/auth.js";

// =============================================================================
// Helpers
// =============================================================================

function createTestApp(): AppInstance {
  return createApp({
    serviceConfig: {
      ownerId: "test-tenant",
      defaultCurrency: "USDC",
      defaultDecimals: 6,
    },
  });
}

/** A secured app whose only key is a VIEWER (read-only) — for 403 cases. */
function createViewerApp(): AppInstance {
  const apiKeys = new Map<string, ApiKeyRecord>([
    ["viewer-key", { key: "viewer-key", role: "viewer", tenantId: "test-tenant" }],
  ]);
  return createApp({
    serviceConfig: {
      ownerId: "test-tenant",
      defaultCurrency: "USDC",
      defaultDecimals: 6,
    },
    auth: { apiKeys },
  });
}

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
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new Request(`http://localhost${path}`, init);
}

const PERIOD = { start: "2025-01-01", end: "2025-01-31", label: "2025-Jan" };

// =============================================================================
// Payroll runs
// =============================================================================

describe("POST /api/v1/treasury/payroll-runs", () => {
  let instance: AppInstance;
  beforeEach(() => {
    instance = createTestApp();
  });

  it("creates a payroll run and returns 201", async () => {
    const res = await instance.app.request(
      makeRequest("/api/v1/treasury/payroll-runs", "POST", {
        id: "run-1",
        period: PERIOD,
      }),
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string; status: string } };
    expect(body.data.id).toBe("run-1");
    expect(res.headers.get("ETag")).toBeTruthy();
  });

  it("returns 400 for an invalid body", async () => {
    const res = await instance.app.request(
      makeRequest("/api/v1/treasury/payroll-runs", "POST", {
        // missing period
        id: "run-bad",
      }),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("denies a viewer with 403", async () => {
    const viewer = createViewerApp();
    const res = await viewer.app.request(
      makeRequest(
        "/api/v1/treasury/payroll-runs",
        "POST",
        { id: "run-x", period: PERIOD },
        { "X-Api-Key": "viewer-key" },
      ),
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });
});

describe("payroll-runs approve + execute lifecycle", () => {
  it("creates → approves → executes a run", async () => {
    const instance = createTestApp();

    await instance.app.request(
      makeRequest("/api/v1/treasury/payroll-runs", "POST", {
        id: "run-life",
        period: PERIOD,
      }),
    );

    // Action endpoints take no body fields, but validateBody parses JSON, so
    // send an empty object (the same convention the intents tests use).
    const approveRes = await instance.app.request(
      makeRequest("/api/v1/treasury/payroll-runs/run-life/approve", "POST", {}),
    );
    expect(approveRes.status).toBe(200);
    const approved = (await approveRes.json()) as { data: { status: string } };
    expect(approved.data.status).toBe("approved");

    const executeRes = await instance.app.request(
      makeRequest("/api/v1/treasury/payroll-runs/run-life/execute", "POST", {}),
    );
    expect(executeRes.status).toBe(200);
    const executed = (await executeRes.json()) as { data: { status: string } };
    expect(executed.data.status).toBe("executed");
  });
});

describe("GET /api/v1/treasury/payroll-runs", () => {
  let instance: AppInstance;
  beforeEach(() => {
    instance = createTestApp();
  });

  it("returns an empty list when none exist", async () => {
    const res = await instance.app.request(
      makeRequest("/api/v1/treasury/payroll-runs"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: unknown[];
      pagination: { hasMore: boolean };
    };
    expect(body.data).toEqual([]);
    expect(body.pagination.hasMore).toBe(false);
  });

  it("supports pagination with limit", async () => {
    for (const id of ["run-a", "run-b"]) {
      await instance.app.request(
        makeRequest("/api/v1/treasury/payroll-runs", "POST", {
          id,
          period: PERIOD,
        }),
      );
    }

    const res = await instance.app.request(
      makeRequest("/api/v1/treasury/payroll-runs?limit=1"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string }[];
      pagination: { cursor: string | null; hasMore: boolean };
    };
    expect(body.data.length).toBe(1);
    expect(body.pagination.hasMore).toBe(true);
    expect(body.pagination.cursor).not.toBeNull();
  });

  it("returns 404 for a missing run", async () => {
    const res = await instance.app.request(
      makeRequest("/api/v1/treasury/payroll-runs/nope"),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("gets an existing run by id", async () => {
    await instance.app.request(
      makeRequest("/api/v1/treasury/payroll-runs", "POST", {
        id: "run-get",
        period: PERIOD,
      }),
    );
    const res = await instance.app.request(
      makeRequest("/api/v1/treasury/payroll-runs/run-get"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string } };
    expect(body.data.id).toBe("run-get");
  });
});

// =============================================================================
// Distributions
// =============================================================================

describe("distributions", () => {
  let instance: AppInstance;
  beforeEach(() => {
    instance = createTestApp();
  });

  async function registerPayee(payeeId: string): Promise<void> {
    // Distributions reference payees; the in-memory treasury validates them.
    // Register through the service directly via the tenant registry, since
    // there is no payee REST surface in this pass.
    const service = await instance.tenantRegistry.getOrCreate("test-tenant");
    service.registerPayee(payeeId, payeeId, `0x${payeeId}`);
  }

  it("creates a distribution and returns 201", async () => {
    await registerPayee("p1");
    await registerPayee("p2");

    const res = await instance.app.request(
      makeRequest("/api/v1/treasury/distributions", "POST", {
        id: "dist-1",
        name: "Q1 rewards",
        strategy: "proportional",
        pool: { amount: "1000", currency: "USDC", decimals: 6 },
        recipients: [
          { payeeId: "p1", share: 5000 },
          { payeeId: "p2", share: 5000 },
        ],
      }),
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string } };
    expect(body.data.id).toBe("dist-1");
  });

  it("returns 400 for an invalid body (empty recipients)", async () => {
    const res = await instance.app.request(
      makeRequest("/api/v1/treasury/distributions", "POST", {
        id: "dist-bad",
        name: "bad",
        strategy: "proportional",
        pool: { amount: "1000", currency: "USDC", decimals: 6 },
        recipients: [],
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for a missing distribution", async () => {
    const res = await instance.app.request(
      makeRequest("/api/v1/treasury/distributions/missing"),
    );
    expect(res.status).toBe(404);
  });

  it("lists distributions with pagination", async () => {
    await registerPayee("p1");
    for (const id of ["d-a", "d-b"]) {
      await instance.app.request(
        makeRequest("/api/v1/treasury/distributions", "POST", {
          id,
          name: id,
          strategy: "fixed",
          pool: { amount: "100", currency: "USDC", decimals: 6 },
          recipients: [
            { payeeId: "p1", amount: { amount: "100", currency: "USDC", decimals: 6 } },
          ],
        }),
      );
    }
    const res = await instance.app.request(
      makeRequest("/api/v1/treasury/distributions?limit=1"),
    );
    const body = (await res.json()) as {
      data: unknown[];
      pagination: { hasMore: boolean };
    };
    expect(body.data.length).toBe(1);
    expect(body.pagination.hasMore).toBe(true);
  });

  it("denies a viewer creating a distribution with 403", async () => {
    const viewer = createViewerApp();
    const res = await viewer.app.request(
      makeRequest(
        "/api/v1/treasury/distributions",
        "POST",
        {
          id: "dist-403",
          name: "x",
          strategy: "proportional",
          pool: { amount: "1", currency: "USDC", decimals: 6 },
          recipients: [{ payeeId: "p1", share: 10000 }],
        },
        { "X-Api-Key": "viewer-key" },
      ),
    );
    expect(res.status).toBe(403);
  });
});

// =============================================================================
// Funding gates
// =============================================================================

describe("funding-gates", () => {
  let instance: AppInstance;
  beforeEach(() => {
    instance = createTestApp();
  });

  it("submits a funding request and returns 201", async () => {
    const res = await instance.app.request(
      makeRequest("/api/v1/treasury/funding-gates", "POST", {
        id: "fund-1",
        description: "Server costs",
        amount: { amount: "500", currency: "USDC", decimals: 6 },
        requestedBy: "alice",
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string; status: string } };
    expect(body.data.id).toBe("fund-1");
    expect(body.data.status).toBe("pending");
  });

  it("returns 400 for an invalid body", async () => {
    const res = await instance.app.request(
      makeRequest("/api/v1/treasury/funding-gates", "POST", {
        id: "fund-bad",
        // missing amount + requestedBy
        description: "x",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("approves a funding gate (first leg)", async () => {
    // The approver is now bound to the authenticated identity (not the body), so
    // this flow uses a secured app whose key identities are configured
    // gatekeepers. Submit as gatekeeper-2 (the requester), approve as
    // gatekeeper-1 (a distinct gatekeeper — separation of duties).
    const apiKeys = new Map<string, ApiKeyRecord>([
      ["gatekeeper-1", { key: "gatekeeper-1", role: "operator", tenantId: "test-tenant" }],
      ["gatekeeper-2", { key: "gatekeeper-2", role: "operator", tenantId: "test-tenant" }],
    ]);
    const app = createApp({
      serviceConfig: { ownerId: "test-tenant", defaultCurrency: "USDC", defaultDecimals: 6 },
      auth: { apiKeys },
    }).app;

    await app.request(
      makeRequest(
        "/api/v1/treasury/funding-gates",
        "POST",
        { id: "fund-approve", description: "Tooling", amount: { amount: "10", currency: "USDC", decimals: 6 } },
        { "X-Api-Key": "gatekeeper-2" },
      ),
    );
    const res = await app.request(
      makeRequest(
        "/api/v1/treasury/funding-gates/fund-approve/approve",
        "POST",
        { reason: "ok" },
        { "X-Api-Key": "gatekeeper-1" },
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe("gate1-approved");
  });

  it("returns 404 for a missing funding request", async () => {
    const res = await instance.app.request(
      makeRequest("/api/v1/treasury/funding-gates/none"),
    );
    expect(res.status).toBe(404);
  });

  it("lists funding requests with pagination", async () => {
    for (const id of ["f-a", "f-b"]) {
      await instance.app.request(
        makeRequest("/api/v1/treasury/funding-gates", "POST", {
          id,
          description: id,
          amount: { amount: "1", currency: "USDC", decimals: 6 },
          requestedBy: "alice",
        }),
      );
    }
    const res = await instance.app.request(
      makeRequest("/api/v1/treasury/funding-gates?limit=1"),
    );
    const body = (await res.json()) as {
      data: unknown[];
      pagination: { hasMore: boolean };
    };
    expect(body.data.length).toBe(1);
    expect(body.pagination.hasMore).toBe(true);
  });

  it("denies a viewer submitting funding with 403", async () => {
    const viewer = createViewerApp();
    const res = await viewer.app.request(
      makeRequest(
        "/api/v1/treasury/funding-gates",
        "POST",
        {
          id: "f-403",
          description: "x",
          amount: { amount: "1", currency: "USDC", decimals: 6 },
          requestedBy: "alice",
        },
        { "X-Api-Key": "viewer-key" },
      ),
    );
    expect(res.status).toBe(403);
  });
});

// =============================================================================
// Funding gates — separation-of-duties is bound to the authenticated principal
// (AUTHZ-FUNDING-SOD-BYPASS). The actor (requestedBy / approvedBy / rejectedBy)
// MUST be derived from c.get("auth").identity, NOT from client-supplied body
// fields. Otherwise a single key can forge distinct approver labels and defeat
// dual control, and the audit log records a fabricated approver.
// =============================================================================

describe("funding-gates — actor bound to authenticated principal (AUTHZ-FUNDING-SOD-BYPASS)", () => {
  /**
   * A secured app whose API-key identities ARE the two configured gatekeepers
   * (auth.identity === record.key). This lets us exercise a SUCCESSFUL dual-gate
   * flow under real authenticated identities and assert the recorded approver
   * equals the caller — and that ONE caller cannot satisfy both gates.
   *
   * NOTE (known follow-up): the per-tenant gatekeeper set is currently the fixed
   * literal ['gatekeeper-1','gatekeeper-2'] in attestia-service.ts (services/).
   * Binding the approver to auth.identity is the security fix; making the
   * gatekeeper allowlist the authenticated admin identities is a separate
   * services/ follow-up. Here we name the keys to match that literal so the
   * end-to-end approval path is exercisable today.
   */
  function createGatekeeperApp(): AppInstance {
    const apiKeys = new Map<string, ApiKeyRecord>([
      ["gatekeeper-1", { key: "gatekeeper-1", role: "operator", tenantId: "test-tenant" }],
      ["gatekeeper-2", { key: "gatekeeper-2", role: "operator", tenantId: "test-tenant" }],
    ]);
    return createApp({
      serviceConfig: {
        ownerId: "test-tenant",
        defaultCurrency: "USDC",
        defaultDecimals: 6,
      },
      auth: { apiKeys },
    });
  }

  it("records the SUBMITTER as the authenticated identity, ignoring body.requestedBy", async () => {
    const app = createGatekeeperApp().app;
    const res = await app.request(
      makeRequest(
        "/api/v1/treasury/funding-gates",
        "POST",
        {
          id: "sod-1",
          description: "Server costs",
          amount: { amount: "500", currency: "USDC", decimals: 6 },
          // Forged label — must be ignored in favor of auth.identity.
          requestedBy: "someone-else",
        },
        { "X-Api-Key": "gatekeeper-1" },
      ),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { requestedBy: string } };
    // The recorded requester is the authenticated caller, NOT the forged label.
    expect(body.data.requestedBy).toBe("gatekeeper-1");
  });

  it("records the APPROVER as the authenticated identity, ignoring body.approvedBy", async () => {
    const app = createGatekeeperApp().app;
    // Submit as gatekeeper-1 (so gatekeeper-1 is the requester).
    await app.request(
      makeRequest(
        "/api/v1/treasury/funding-gates",
        "POST",
        { id: "sod-2", description: "x", amount: { amount: "10", currency: "USDC", decimals: 6 } },
        { "X-Api-Key": "gatekeeper-1" },
      ),
    );
    // Approve as gatekeeper-2; body claims a different approver — must be ignored.
    const res = await app.request(
      makeRequest(
        "/api/v1/treasury/funding-gates/sod-2/approve",
        "POST",
        { approvedBy: "i-am-whoever-i-say", reason: "ok" },
        { "X-Api-Key": "gatekeeper-2" },
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { status: string; gate1: { approvedBy: string } };
    };
    expect(body.data.status).toBe("gate1-approved");
    // Approver in the result == the authenticated caller, not the body label.
    expect(body.data.gate1.approvedBy).toBe("gatekeeper-2");
  });

  it("a SINGLE caller cannot self-satisfy both funding gates", async () => {
    const app = createGatekeeperApp().app;
    // gatekeeper-2 submits the request (so gatekeeper-2 is the requester).
    await app.request(
      makeRequest(
        "/api/v1/treasury/funding-gates",
        "POST",
        { id: "sod-3", description: "x", amount: { amount: "10", currency: "USDC", decimals: 6 } },
        { "X-Api-Key": "gatekeeper-2" },
      ),
    );
    // gatekeeper-1 approves gate1 (a distinct, valid approver).
    const g1 = await app.request(
      makeRequest(
        "/api/v1/treasury/funding-gates/sod-3/approve",
        "POST",
        {},
        { "X-Api-Key": "gatekeeper-1" },
      ),
    );
    expect(g1.status).toBe(200);

    // gatekeeper-1 attempts to ALSO approve gate2 (forging body.approvedBy is
    // useless now — the actor is auth.identity). A single caller cannot satisfy
    // both gates: the second approval by the same identity is rejected.
    const g2 = await app.request(
      makeRequest(
        "/api/v1/treasury/funding-gates/sod-3/approve",
        "POST",
        { approvedBy: "gatekeeper-2" }, // forged — ignored
        { "X-Api-Key": "gatekeeper-1" },
      ),
    );
    // ALREADY_APPROVED → 409 (the same gatekeeper cannot fill both gates).
    expect(g2.status).toBe(409);

    // The request is NOT fully approved — dual control held.
    const get = await app.request(
      makeRequest(
        "/api/v1/treasury/funding-gates/sod-3",
        "GET",
        undefined,
        { "X-Api-Key": "gatekeeper-1" },
      ),
    );
    const body = (await get.json()) as { data: { status: string } };
    expect(body.data.status).toBe("gate1-approved");
    expect(body.data.status).not.toBe("approved");
  });
});
