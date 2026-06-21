/**
 * Extended Namespace Tests — treasury, vault, governance.
 *
 * Verifies the namespaces the SDK gained to cover the node service's
 * authenticated REST routes:
 * - Treasury: payroll runs, distributions, funding gates
 * - Vault: envelopes, allocate, budget, list, portfolio
 * - Governance: signers, quorum, policy
 * - Auto-pagination via iterate() (cursor following across pages)
 *
 * Mirrors the mock-fetch style of client.test.ts: each test asserts the
 * outgoing method + path + headers + body and the parsed typed response.
 */

import { describe, it, expect, vi } from "vitest";
import { AttestiaClient } from "../src/client.js";

import type {
  PayrollRun,
  DistributionPlan,
  DistributionResult,
  FundingRequest,
  Envelope,
  BudgetSnapshot,
  Portfolio,
  GovernancePolicy,
} from "../src/client.js";

// =============================================================================
// Mock Fetch Helper (same shape as client.test.ts)
// =============================================================================

interface MockRoute {
  method: string;
  pathPrefix: string;
  status: number;
  body: unknown;
}

function createRoutedMockFetch(routes: MockRoute[]): typeof fetch {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
    const method = init?.method ?? "GET";

    const route = routes.find(
      (r) => r.method === method && urlStr.includes(r.pathPrefix),
    );

    if (route === undefined) {
      return new Response(
        JSON.stringify({ error: { code: "NOT_FOUND", message: `No route for ${method} ${urlStr}` } }),
        { status: 404 },
      );
    }

    return new Response(JSON.stringify(route.body), {
      status: route.status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

function makeClient(mockFetch: typeof fetch): AttestiaClient {
  return new AttestiaClient({
    baseUrl: "https://api.example.com",
    apiKey: "test-key",
    fetchFn: mockFetch,
    retries: 0,
  });
}

// =============================================================================
// Fixtures
// =============================================================================

const MONEY = { amount: "1000", currency: "USDC", decimals: 6 } as const;

const SAMPLE_RUN: PayrollRun = {
  id: "run-001",
  period: { start: "2025-01-01", end: "2025-01-31", label: "2025-Jan" },
  status: "draft",
  entries: [],
  totalGross: MONEY,
  totalDeductions: { amount: "0", currency: "USDC", decimals: 6 },
  totalNet: MONEY,
  createdAt: "2025-01-15T10:00:00.000Z",
};

const SAMPLE_PLAN: DistributionPlan = {
  id: "dist-001",
  name: "Q1 grants",
  strategy: "proportional",
  pool: MONEY,
  recipients: [{ payeeId: "alice", share: 10000 }],
  status: "draft",
  createdAt: "2025-01-15T10:00:00.000Z",
};

const SAMPLE_DIST_RESULT: DistributionResult = {
  planId: "dist-001",
  payouts: [{ payeeId: "alice", amount: MONEY }],
  totalDistributed: MONEY,
  remainder: { amount: "0", currency: "USDC", decimals: 6 },
};

const SAMPLE_REQUEST: FundingRequest = {
  id: "fund-001",
  description: "Server costs",
  amount: MONEY,
  requestedBy: "alice",
  status: "pending",
  createdAt: "2025-01-15T10:00:00.000Z",
};

const SAMPLE_ENVELOPE: Envelope = {
  id: "env-001",
  name: "Rent",
  currency: "USDC",
  decimals: 6,
  allocated: "1000",
};

const SAMPLE_BUDGET: BudgetSnapshot = {
  ownerId: "test-tenant",
  envelopes: [SAMPLE_ENVELOPE],
  totalAllocated: "1000",
  totalSpent: "0",
  totalAvailable: "1000",
  currency: "USDC",
  asOf: "2025-01-15T10:00:00.000Z",
};

const SAMPLE_PORTFOLIO: Portfolio = {
  ownerId: "test-tenant",
  nativePositions: [{ currency: "XRP", amount: "100" }],
  tokenPositions: [{ currency: "USDC", amount: "1000", chainId: "eip155:1" }],
  observedAt: "2025-01-15T10:00:00.000Z",
  totals: [{ currency: "USDC", amount: "1000" }],
};

const SAMPLE_POLICY: GovernancePolicy = {
  id: "policy-1",
  version: 1,
  signers: [{ address: "rAlice", label: "Alice", weight: 1 }],
  quorum: 1,
  updatedAt: "2025-01-15T10:00:00.000Z",
};

// =============================================================================
// Treasury — Payroll Runs
// =============================================================================

describe("AttestiaClient treasury.payrollRuns", () => {
  it("creates a payroll run", async () => {
    const mockFetch = createRoutedMockFetch([
      { method: "POST", pathPrefix: "/api/v1/treasury/payroll-runs", status: 201, body: { data: SAMPLE_RUN } },
    ]);
    const client = makeClient(mockFetch);

    const result = await client.treasury.payrollRuns.create({
      id: "run-001",
      period: { start: "2025-01-01", end: "2025-01-31", label: "2025-Jan" },
    });

    expect(result.data.id).toBe("run-001");
    expect(result.status).toBe(201);

    const [url, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toContain("/api/v1/treasury/payroll-runs");
    expect(init.method).toBe("POST");
    expect(init.headers["X-Api-Key"]).toBe("test-key");
    const body = JSON.parse(init.body);
    expect(body.period.label).toBe("2025-Jan");
  });

  it("approves a payroll run", async () => {
    const mockFetch = createRoutedMockFetch([
      {
        method: "POST",
        pathPrefix: "/api/v1/treasury/payroll-runs/run-001/approve",
        status: 200,
        body: { data: { ...SAMPLE_RUN, status: "approved" } },
      },
    ]);
    const client = makeClient(mockFetch);

    const result = await client.treasury.payrollRuns.approve("run-001");
    expect(result.data.status).toBe("approved");
    const [url] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toContain("/payroll-runs/run-001/approve");
  });

  it("executes a payroll run", async () => {
    const mockFetch = createRoutedMockFetch([
      {
        method: "POST",
        pathPrefix: "/api/v1/treasury/payroll-runs/run-001/execute",
        status: 200,
        body: { data: { ...SAMPLE_RUN, status: "executed" } },
      },
    ]);
    const client = makeClient(mockFetch);

    const result = await client.treasury.payrollRuns.execute("run-001");
    expect(result.data.status).toBe("executed");
    const [url] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toContain("/payroll-runs/run-001/execute");
  });

  it("gets a single payroll run", async () => {
    const mockFetch = createRoutedMockFetch([
      { method: "GET", pathPrefix: "/api/v1/treasury/payroll-runs/run-001", status: 200, body: { data: SAMPLE_RUN } },
    ]);
    const client = makeClient(mockFetch);

    const result = await client.treasury.payrollRuns.get("run-001");
    expect(result.data.id).toBe("run-001");
  });

  it("lists payroll runs with cursor + limit", async () => {
    const mockFetch = createRoutedMockFetch([
      {
        method: "GET",
        pathPrefix: "/api/v1/treasury/payroll-runs",
        status: 200,
        body: { data: [SAMPLE_RUN], pagination: { cursor: null, hasMore: false } },
      },
    ]);
    const client = makeClient(mockFetch);

    const result = await client.treasury.payrollRuns.list({ cursor: "abc", limit: 5 });
    expect(result.data.data).toHaveLength(1);
    expect(result.data.pagination.hasMore).toBe(false);

    const [url] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toContain("cursor=abc");
    expect(url).toContain("limit=5");
  });
});

// =============================================================================
// Treasury — Distributions
// =============================================================================

describe("AttestiaClient treasury.distributions", () => {
  it("creates a distribution plan", async () => {
    const mockFetch = createRoutedMockFetch([
      { method: "POST", pathPrefix: "/api/v1/treasury/distributions", status: 201, body: { data: SAMPLE_PLAN } },
    ]);
    const client = makeClient(mockFetch);

    const result = await client.treasury.distributions.create({
      id: "dist-001",
      name: "Q1 grants",
      strategy: "proportional",
      pool: MONEY,
      recipients: [{ payeeId: "alice", share: 10000 }],
    });

    expect(result.data.id).toBe("dist-001");
    expect(result.status).toBe(201);
    const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(init.body);
    expect(body.strategy).toBe("proportional");
    expect(body.recipients[0].payeeId).toBe("alice");
  });

  it("approves a distribution plan", async () => {
    const mockFetch = createRoutedMockFetch([
      {
        method: "POST",
        pathPrefix: "/api/v1/treasury/distributions/dist-001/approve",
        status: 200,
        body: { data: { ...SAMPLE_PLAN, status: "approved" } },
      },
    ]);
    const client = makeClient(mockFetch);

    const result = await client.treasury.distributions.approve("dist-001");
    expect(result.data.status).toBe("approved");
  });

  it("computes a distribution plan (dry-run)", async () => {
    const mockFetch = createRoutedMockFetch([
      {
        method: "POST",
        pathPrefix: "/api/v1/treasury/distributions/dist-001/compute",
        status: 200,
        body: { data: SAMPLE_DIST_RESULT },
      },
    ]);
    const client = makeClient(mockFetch);

    const result = await client.treasury.distributions.compute("dist-001");
    expect(result.data.planId).toBe("dist-001");
    expect(result.data.payouts).toHaveLength(1);
    const [url] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toContain("/distributions/dist-001/compute");
  });

  it("executes a distribution plan", async () => {
    const mockFetch = createRoutedMockFetch([
      {
        method: "POST",
        pathPrefix: "/api/v1/treasury/distributions/dist-001/execute",
        status: 200,
        body: { data: SAMPLE_DIST_RESULT },
      },
    ]);
    const client = makeClient(mockFetch);

    const result = await client.treasury.distributions.execute("dist-001");
    expect(result.data.totalDistributed.amount).toBe("1000");
  });

  it("gets a single distribution plan", async () => {
    const mockFetch = createRoutedMockFetch([
      { method: "GET", pathPrefix: "/api/v1/treasury/distributions/dist-001", status: 200, body: { data: SAMPLE_PLAN } },
    ]);
    const client = makeClient(mockFetch);

    const result = await client.treasury.distributions.get("dist-001");
    expect(result.data.id).toBe("dist-001");
  });

  it("lists distribution plans", async () => {
    const mockFetch = createRoutedMockFetch([
      {
        method: "GET",
        pathPrefix: "/api/v1/treasury/distributions",
        status: 200,
        body: { data: [SAMPLE_PLAN], pagination: { cursor: null, hasMore: false } },
      },
    ]);
    const client = makeClient(mockFetch);

    const result = await client.treasury.distributions.list();
    expect(result.data.data).toHaveLength(1);
  });
});

// =============================================================================
// Treasury — Funding Gates
// =============================================================================

describe("AttestiaClient treasury.fundingGates", () => {
  it("submits a funding request", async () => {
    const mockFetch = createRoutedMockFetch([
      { method: "POST", pathPrefix: "/api/v1/treasury/funding-gates", status: 201, body: { data: SAMPLE_REQUEST } },
    ]);
    const client = makeClient(mockFetch);

    const result = await client.treasury.fundingGates.submit({
      id: "fund-001",
      description: "Server costs",
      amount: MONEY,
      requestedBy: "alice",
    });

    expect(result.data.id).toBe("fund-001");
    expect(result.status).toBe(201);
    const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(init.body);
    expect(body.requestedBy).toBe("alice");
  });

  it("approves a funding gate with approver + reason", async () => {
    const mockFetch = createRoutedMockFetch([
      {
        method: "POST",
        pathPrefix: "/api/v1/treasury/funding-gates/fund-001/approve",
        status: 200,
        body: { data: { ...SAMPLE_REQUEST, status: "gate1-approved" } },
      },
    ]);
    const client = makeClient(mockFetch);

    const result = await client.treasury.fundingGates.approve("fund-001", "bob", "looks good");
    expect(result.data.status).toBe("gate1-approved");
    const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(init.body);
    expect(body.approvedBy).toBe("bob");
    expect(body.reason).toBe("looks good");
  });

  it("approves a funding gate without a reason", async () => {
    const mockFetch = createRoutedMockFetch([
      {
        method: "POST",
        pathPrefix: "/api/v1/treasury/funding-gates/fund-001/approve",
        status: 200,
        body: { data: SAMPLE_REQUEST },
      },
    ]);
    const client = makeClient(mockFetch);

    await client.treasury.fundingGates.approve("fund-001", "bob");
    const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(init.body);
    expect(body.approvedBy).toBe("bob");
    expect(body.reason).toBeUndefined();
  });

  it("rejects a funding request with rejector + reason", async () => {
    const mockFetch = createRoutedMockFetch([
      {
        method: "POST",
        pathPrefix: "/api/v1/treasury/funding-gates/fund-001/reject",
        status: 200,
        body: { data: { ...SAMPLE_REQUEST, status: "rejected" } },
      },
    ]);
    const client = makeClient(mockFetch);

    const result = await client.treasury.fundingGates.reject("fund-001", "carol", "over budget");
    expect(result.data.status).toBe("rejected");
    const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(init.body);
    expect(body.rejectedBy).toBe("carol");
    expect(body.reason).toBe("over budget");
  });

  it("executes a funding request", async () => {
    const mockFetch = createRoutedMockFetch([
      {
        method: "POST",
        pathPrefix: "/api/v1/treasury/funding-gates/fund-001/execute",
        status: 200,
        body: { data: { ...SAMPLE_REQUEST, status: "executed" } },
      },
    ]);
    const client = makeClient(mockFetch);

    const result = await client.treasury.fundingGates.execute("fund-001");
    expect(result.data.status).toBe("executed");
  });

  it("gets a single funding request", async () => {
    const mockFetch = createRoutedMockFetch([
      { method: "GET", pathPrefix: "/api/v1/treasury/funding-gates/fund-001", status: 200, body: { data: SAMPLE_REQUEST } },
    ]);
    const client = makeClient(mockFetch);

    const result = await client.treasury.fundingGates.get("fund-001");
    expect(result.data.id).toBe("fund-001");
  });

  it("lists funding requests", async () => {
    const mockFetch = createRoutedMockFetch([
      {
        method: "GET",
        pathPrefix: "/api/v1/treasury/funding-gates",
        status: 200,
        body: { data: [SAMPLE_REQUEST], pagination: { cursor: null, hasMore: false } },
      },
    ]);
    const client = makeClient(mockFetch);

    const result = await client.treasury.fundingGates.list();
    expect(result.data.data).toHaveLength(1);
  });
});

// =============================================================================
// Vault
// =============================================================================

describe("AttestiaClient vault", () => {
  it("creates an envelope", async () => {
    const mockFetch = createRoutedMockFetch([
      { method: "POST", pathPrefix: "/api/v1/vault/envelopes", status: 201, body: { data: SAMPLE_ENVELOPE } },
    ]);
    const client = makeClient(mockFetch);

    const result = await client.vault.createEnvelope({ id: "env-001", name: "Rent", category: "housing" });
    expect(result.data.id).toBe("env-001");
    expect(result.status).toBe(201);
    const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(init.body);
    expect(body.name).toBe("Rent");
    expect(body.category).toBe("housing");
  });

  it("allocates funds into an envelope", async () => {
    const mockFetch = createRoutedMockFetch([
      {
        method: "POST",
        pathPrefix: "/api/v1/vault/envelopes/env-001/allocate",
        status: 200,
        body: { data: { ...SAMPLE_ENVELOPE, allocated: "2000" } },
      },
    ]);
    const client = makeClient(mockFetch);

    const result = await client.vault.allocate("env-001", MONEY);
    expect(result.data.allocated).toBe("2000");
    const [url, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toContain("/envelopes/env-001/allocate");
    const body = JSON.parse(init.body);
    expect(body.amount.currency).toBe("USDC");
  });

  it("gets the budget snapshot", async () => {
    const mockFetch = createRoutedMockFetch([
      { method: "GET", pathPrefix: "/api/v1/vault/budget", status: 200, body: { data: SAMPLE_BUDGET } },
    ]);
    const client = makeClient(mockFetch);

    const result = await client.vault.budget();
    expect(result.data.totalAllocated).toBe("1000");
    expect(result.data.envelopes).toHaveLength(1);
  });

  it("lists envelopes with pagination", async () => {
    const mockFetch = createRoutedMockFetch([
      {
        method: "GET",
        pathPrefix: "/api/v1/vault/envelopes",
        status: 200,
        body: { data: [SAMPLE_ENVELOPE], pagination: { cursor: null, hasMore: false } },
      },
    ]);
    const client = makeClient(mockFetch);

    const result = await client.vault.listEnvelopes({ limit: 50 });
    expect(result.data.data).toHaveLength(1);
    const [url] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toContain("limit=50");
  });

  it("observes the portfolio", async () => {
    const mockFetch = createRoutedMockFetch([
      { method: "GET", pathPrefix: "/api/v1/vault/portfolio", status: 200, body: { data: SAMPLE_PORTFOLIO } },
    ]);
    const client = makeClient(mockFetch);

    const result = await client.vault.portfolio();
    expect(result.data.ownerId).toBe("test-tenant");
    expect(result.data.nativePositions).toHaveLength(1);
    expect(result.data.tokenPositions[0]!.chainId).toBe("eip155:1");
  });
});

// =============================================================================
// Governance
// =============================================================================

describe("AttestiaClient governance", () => {
  it("adds a signer", async () => {
    const mockFetch = createRoutedMockFetch([
      { method: "POST", pathPrefix: "/api/v1/governance/signers", status: 201, body: { data: SAMPLE_POLICY } },
    ]);
    const client = makeClient(mockFetch);

    const result = await client.governance.addSigner({ address: "rBob", label: "Bob", weight: 2 });
    expect(result.data.signers).toHaveLength(1);
    expect(result.status).toBe(201);
    const [url, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toContain("/api/v1/governance/signers");
    const body = JSON.parse(init.body);
    expect(body.address).toBe("rBob");
    expect(body.weight).toBe(2);
  });

  it("removes a signer by address", async () => {
    const mockFetch = createRoutedMockFetch([
      { method: "POST", pathPrefix: "/api/v1/governance/signers/remove", status: 200, body: { data: SAMPLE_POLICY } },
    ]);
    const client = makeClient(mockFetch);

    const result = await client.governance.removeSigner("rBob");
    expect(result.data.id).toBe("policy-1");
    const [url, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toContain("/api/v1/governance/signers/remove");
    const body = JSON.parse(init.body);
    expect(body.address).toBe("rBob");
  });

  it("changes the quorum", async () => {
    const mockFetch = createRoutedMockFetch([
      { method: "POST", pathPrefix: "/api/v1/governance/quorum", status: 200, body: { data: { ...SAMPLE_POLICY, quorum: 3 } } },
    ]);
    const client = makeClient(mockFetch);

    const result = await client.governance.changeQuorum(3);
    expect(result.data.quorum).toBe(3);
    const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(init.body);
    expect(body.quorum).toBe(3);
  });

  it("gets the current policy", async () => {
    const mockFetch = createRoutedMockFetch([
      { method: "GET", pathPrefix: "/api/v1/governance/policy", status: 200, body: { data: SAMPLE_POLICY } },
    ]);
    const client = makeClient(mockFetch);

    const result = await client.governance.getPolicy();
    expect(result.data.quorum).toBe(1);
    expect(result.data.signers[0]!.address).toBe("rAlice");
  });
});

// =============================================================================
// Auto-Pagination (iterate)
// =============================================================================

describe("AttestiaClient auto-pagination", () => {
  it("pages through a multi-page payroll-run list in order", async () => {
    // Page 1 returns a nextCursor; page 2 returns none (hasMore:false).
    const page1: PayrollRun[] = [
      { ...SAMPLE_RUN, id: "run-001" },
      { ...SAMPLE_RUN, id: "run-002" },
    ];
    const page2: PayrollRun[] = [{ ...SAMPLE_RUN, id: "run-003" }];

    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      // First page has no cursor; second page carries cursor=cursor-1.
      const isSecondPage = urlStr.includes("cursor=cursor-1");
      const body = isSecondPage
        ? { data: page2, pagination: { cursor: null, hasMore: false } }
        : { data: page1, pagination: { cursor: "cursor-1", hasMore: true } };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const client = makeClient(mockFetch);

    const ids: string[] = [];
    for await (const run of client.treasury.payrollRuns.iterate({ limit: 2 })) {
      ids.push(run.id);
    }

    expect(ids).toEqual(["run-001", "run-002", "run-003"]);
    // Two fetches: page 1 (no cursor) then page 2 (cursor-1).
    expect((mockFetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);

    // First call carries the limit but no cursor; second call follows the cursor.
    const [firstUrl] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const [secondUrl] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[1]!;
    expect(firstUrl).toContain("limit=2");
    expect(firstUrl).not.toContain("cursor=");
    expect(secondUrl).toContain("cursor=cursor-1");
    expect(secondUrl).toContain("limit=2");
  });

  it("stops after a single page when hasMore is false", async () => {
    const mockFetch = createRoutedMockFetch([
      {
        method: "GET",
        pathPrefix: "/api/v1/vault/envelopes",
        status: 200,
        body: { data: [SAMPLE_ENVELOPE], pagination: { cursor: null, hasMore: false } },
      },
    ]);
    const client = makeClient(mockFetch);

    const ids: string[] = [];
    for await (const env of client.vault.iterateEnvelopes()) {
      ids.push(env.id);
    }

    expect(ids).toEqual(["env-001"]);
    expect((mockFetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("does not loop forever if hasMore is true but no cursor is returned", async () => {
    // Defensive: a misbehaving server claims hasMore but omits the next cursor.
    const mockFetch = createRoutedMockFetch([
      {
        method: "GET",
        pathPrefix: "/api/v1/treasury/distributions",
        status: 200,
        body: { data: [SAMPLE_PLAN], pagination: { cursor: null, hasMore: true } },
      },
    ]);
    const client = makeClient(mockFetch);

    const ids: string[] = [];
    for await (const plan of client.treasury.distributions.iterate()) {
      ids.push(plan.id);
    }

    expect(ids).toEqual(["dist-001"]);
    // Stops because the next cursor is null even though hasMore is true.
    expect((mockFetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});
