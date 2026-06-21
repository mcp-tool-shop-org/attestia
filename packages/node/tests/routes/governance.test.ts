/**
 * Governance Routes Tests
 *
 * Covers the per-tenant multi-sig governance store via HTTP:
 * - 201 / 200 success shapes (add signer, change quorum, get policy)
 * - 400 validation failure
 * - permission denial — governance mutations require the ADMIN permission, so
 *   an operator (write but not admin) AND a viewer both get 403.
 *
 * Notes:
 * - addSigner without a publicKey does not cryptographically validate the
 *   address, so an arbitrary address string is accepted by the domain. Tests
 *   that exercise publicKey binding are out of scope (the route is a thin
 *   pass-through and the domain owns that validation).
 * - The GovernanceStore throws plain Error (not coded domain errors), so a
 *   business-rule conflict (duplicate signer, quorum > weight) surfaces as 500.
 *   These tests therefore assert success + validation + permission paths, not
 *   the domain-conflict 4xx surface, which does not yet exist (see governance.ts
 *   "DELEGATOR GAP" note).
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

/** Secured app with admin / operator / viewer keys for permission cases. */
function createSecuredApp(): AppInstance {
  const apiKeys = new Map<string, ApiKeyRecord>([
    ["admin-key", { key: "admin-key", role: "admin", tenantId: "test-tenant" }],
    ["operator-key", { key: "operator-key", role: "operator", tenantId: "test-tenant" }],
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

const SIGNER_A = "rSignerAAAAAAAAAAAAAAAAAAAAAAAAA1";
const SIGNER_B = "rSignerBBBBBBBBBBBBBBBBBBBBBBBBB2";

// =============================================================================
// Add signer
// =============================================================================

describe("POST /api/v1/governance/signers", () => {
  let instance: AppInstance;
  beforeEach(() => {
    instance = createTestApp();
  });

  it("adds a signer and returns 201 with the updated policy", async () => {
    const res = await instance.app.request(
      makeRequest("/api/v1/governance/signers", "POST", {
        address: SIGNER_A,
        label: "Treasury lead",
        weight: 2,
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { signers: { address: string; weight: number }[]; version: number };
    };
    expect(body.data.signers.some((s) => s.address === SIGNER_A)).toBe(true);
    expect(body.data.version).toBeGreaterThan(0);
    expect(res.headers.get("ETag")).toBeTruthy();
  });

  it("returns 400 for an invalid body", async () => {
    const res = await instance.app.request(
      makeRequest("/api/v1/governance/signers", "POST", {
        // missing label
        address: SIGNER_A,
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("denies a viewer with 403", async () => {
    const secured = createSecuredApp();
    const res = await secured.app.request(
      makeRequest(
        "/api/v1/governance/signers",
        "POST",
        { address: SIGNER_A, label: "x" },
        { "X-Api-Key": "viewer-key" },
      ),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("denies an OPERATOR with 403 (governance is admin-only, not write)", async () => {
    const secured = createSecuredApp();
    const res = await secured.app.request(
      makeRequest(
        "/api/v1/governance/signers",
        "POST",
        { address: SIGNER_A, label: "x" },
        { "X-Api-Key": "operator-key" },
      ),
    );
    expect(res.status).toBe(403);
  });

  it("allows an ADMIN to add a signer", async () => {
    const secured = createSecuredApp();
    const res = await secured.app.request(
      makeRequest(
        "/api/v1/governance/signers",
        "POST",
        { address: SIGNER_A, label: "lead" },
        { "X-Api-Key": "admin-key" },
      ),
    );
    expect(res.status).toBe(201);
  });
});

// =============================================================================
// Remove signer + change quorum
// =============================================================================

describe("governance mutations", () => {
  let instance: AppInstance;
  beforeEach(() => {
    instance = createTestApp();
  });

  it("removes a signer and returns 200", async () => {
    await instance.app.request(
      makeRequest("/api/v1/governance/signers", "POST", {
        address: SIGNER_A,
        label: "A",
      }),
    );
    await instance.app.request(
      makeRequest("/api/v1/governance/signers", "POST", {
        address: SIGNER_B,
        label: "B",
      }),
    );

    const res = await instance.app.request(
      makeRequest("/api/v1/governance/signers/remove", "POST", {
        address: SIGNER_B,
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { signers: { address: string }[] };
    };
    expect(body.data.signers.some((s) => s.address === SIGNER_B)).toBe(false);
    expect(body.data.signers.some((s) => s.address === SIGNER_A)).toBe(true);
  });

  it("changes the quorum and returns 200", async () => {
    // Add two unit-weight signers so quorum 2 is valid.
    await instance.app.request(
      makeRequest("/api/v1/governance/signers", "POST", {
        address: SIGNER_A,
        label: "A",
      }),
    );
    await instance.app.request(
      makeRequest("/api/v1/governance/signers", "POST", {
        address: SIGNER_B,
        label: "B",
      }),
    );

    const res = await instance.app.request(
      makeRequest("/api/v1/governance/quorum", "POST", { quorum: 2 }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { quorum: number } };
    expect(body.data.quorum).toBe(2);
  });

  it("returns 400 for an invalid quorum body", async () => {
    const res = await instance.app.request(
      makeRequest("/api/v1/governance/quorum", "POST", { quorum: 0 }),
    );
    expect(res.status).toBe(400);
  });

  it("denies a viewer changing quorum with 403", async () => {
    const secured = createSecuredApp();
    const res = await secured.app.request(
      makeRequest(
        "/api/v1/governance/quorum",
        "POST",
        { quorum: 1 },
        { "X-Api-Key": "viewer-key" },
      ),
    );
    expect(res.status).toBe(403);
  });
});

// =============================================================================
// SEAM-2 — governance mutations route through the durability gate AND map
// store conflicts to coded 4xx (not 500).
// =============================================================================

describe("governance conflicts → coded 4xx, not 500 (SEAM-2)", () => {
  let instance: AppInstance;
  beforeEach(() => {
    instance = createTestApp();
  });

  it("a duplicate signer returns 409 CONFLICT, not 500", async () => {
    await instance.app.request(
      makeRequest("/api/v1/governance/signers", "POST", {
        address: SIGNER_A,
        label: "A",
      }),
    );
    // Adding the same signer again is a domain conflict.
    const res = await instance.app.request(
      makeRequest("/api/v1/governance/signers", "POST", {
        address: SIGNER_A,
        label: "A again",
      }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("SIGNER_EXISTS");
    // Never the raw thrown message (no internal detail leaked).
    expect(body.error.message).not.toContain("Signer already exists");
  });

  it("removing an unknown signer returns 404, not 500", async () => {
    const res = await instance.app.request(
      makeRequest("/api/v1/governance/signers/remove", "POST", {
        address: "rUnknownSignerXXXXXXXXXXXXXXXXXXXX",
      }),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SIGNER_NOT_FOUND");
  });

  it("an invalid quorum (exceeds total weight) returns 400, not 500", async () => {
    // One unit-weight signer → total weight 1; quorum 5 is invalid.
    await instance.app.request(
      makeRequest("/api/v1/governance/signers", "POST", {
        address: SIGNER_A,
        label: "A",
      }),
    );
    const res = await instance.app.request(
      makeRequest("/api/v1/governance/quorum", "POST", { quorum: 5 }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_QUORUM");
  });
});

// =============================================================================
// Get policy
// =============================================================================

describe("GET /api/v1/governance/policy", () => {
  it("returns the current policy", async () => {
    const instance = createTestApp();
    const res = await instance.app.request(
      makeRequest("/api/v1/governance/policy"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; version: number; quorum: number; signers: unknown[] };
    };
    expect(body.data.id).toBeTruthy();
    expect(body.data.quorum).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.data.signers)).toBe(true);
  });
});
