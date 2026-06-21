/**
 * Vault Budget / Portfolio Routes Tests
 *
 * Covers envelopes + budget + portfolio via HTTP:
 * - 201 / 200 success shapes
 * - 400 validation failure
 * - 404 not-found (allocate into a missing envelope)
 * - cursor pagination (envelopes)
 * - permission denial (a viewer hitting a write route gets 403)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../../src/app.js";
import type { AppInstance } from "../../src/app.js";
import type { ApiKeyRecord } from "../../src/types/auth.js";

function createTestApp(): AppInstance {
  return createApp({
    serviceConfig: {
      ownerId: "test-tenant",
      defaultCurrency: "USDC",
      defaultDecimals: 6,
    },
  });
}

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

// =============================================================================
// Envelopes
// =============================================================================

describe("POST /api/v1/vault/envelopes", () => {
  let instance: AppInstance;
  beforeEach(() => {
    instance = createTestApp();
  });

  it("creates an envelope and returns 201", async () => {
    const res = await instance.app.request(
      makeRequest("/api/v1/vault/envelopes", "POST", {
        id: "env-1",
        name: "Rent",
        category: "fixed",
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string; name: string } };
    expect(body.data.id).toBe("env-1");
    expect(body.data.name).toBe("Rent");
    expect(res.headers.get("ETag")).toBeTruthy();
  });

  it("returns 400 for an invalid body", async () => {
    const res = await instance.app.request(
      makeRequest("/api/v1/vault/envelopes", "POST", {
        // missing name
        id: "env-bad",
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
        "/api/v1/vault/envelopes",
        "POST",
        { id: "env-403", name: "x" },
        { "X-Api-Key": "viewer-key" },
      ),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });
});

describe("POST /api/v1/vault/envelopes/:id/allocate", () => {
  let instance: AppInstance;
  beforeEach(() => {
    instance = createTestApp();
  });

  it("allocates into an existing envelope", async () => {
    await instance.app.request(
      makeRequest("/api/v1/vault/envelopes", "POST", {
        id: "env-alloc",
        name: "Savings",
      }),
    );
    const res = await instance.app.request(
      makeRequest("/api/v1/vault/envelopes/env-alloc/allocate", "POST", {
        amount: { amount: "250", currency: "USDC", decimals: 6 },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { allocated: string } };
    // Money is normalized to the envelope's configured decimals (6).
    expect(body.data.allocated).toBe("250.000000");
  });

  it("returns 404 allocating into a missing envelope", async () => {
    const res = await instance.app.request(
      makeRequest("/api/v1/vault/envelopes/ghost/allocate", "POST", {
        amount: { amount: "1", currency: "USDC", decimals: 6 },
      }),
    );
    expect(res.status).toBe(404);
    // The domain raises a specific ENVELOPE_NOT_FOUND code (still a 404 class).
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ENVELOPE_NOT_FOUND");
  });
});

describe("GET /api/v1/vault/envelopes", () => {
  let instance: AppInstance;
  beforeEach(() => {
    instance = createTestApp();
  });

  it("returns an empty list when none exist", async () => {
    const res = await instance.app.request(
      makeRequest("/api/v1/vault/envelopes"),
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
    for (const id of ["e-a", "e-b"]) {
      await instance.app.request(
        makeRequest("/api/v1/vault/envelopes", "POST", { id, name: id }),
      );
    }
    const res = await instance.app.request(
      makeRequest("/api/v1/vault/envelopes?limit=1"),
    );
    const body = (await res.json()) as {
      data: { id: string }[];
      pagination: { cursor: string | null; hasMore: boolean };
    };
    expect(body.data.length).toBe(1);
    expect(body.pagination.hasMore).toBe(true);
    expect(body.pagination.cursor).not.toBeNull();
  });
});

// =============================================================================
// Budget + portfolio
// =============================================================================

describe("GET /api/v1/vault/budget", () => {
  it("returns the budget snapshot", async () => {
    const instance = createTestApp();
    await instance.app.request(
      makeRequest("/api/v1/vault/envelopes", "POST", {
        id: "env-budget",
        name: "Groceries",
      }),
    );
    const res = await instance.app.request(
      makeRequest("/api/v1/vault/budget"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { envelopes: { id: string }[] };
    };
    expect(Array.isArray(body.data.envelopes)).toBe(true);
    expect(body.data.envelopes.some((e) => e.id === "env-budget")).toBe(true);
  });
});

describe("GET /api/v1/vault/portfolio", () => {
  it("returns a portfolio observation", async () => {
    const instance = createTestApp();
    const res = await instance.app.request(
      makeRequest("/api/v1/vault/portfolio"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data).toBeDefined();
    expect(typeof body.data).toBe("object");
  });
});
