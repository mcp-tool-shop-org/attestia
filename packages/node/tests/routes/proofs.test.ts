/**
 * Proof Generation & Verification Routes Tests
 *
 * Verifies:
 * - Merkle root endpoint returns root hash
 * - Attestation proof generation (happy path)
 * - Invalid attestation ID → 404
 * - Proof verification (valid + invalid)
 * - Public proof verification (no auth)
 * - Proof round-trip: generate → verify
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../../src/app.js";
import type { AppInstance } from "../../src/app.js";

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

function makeRequest(
  path: string,
  method: string = "GET",
  body?: unknown,
): Request {
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new Request(`http://localhost${path}`, init);
}

/**
 * Submit a reconciliation and attestation to create test data.
 * Returns the attestation ID.
 */
async function createAttestation(instance: AppInstance): Promise<string> {
  const reconcileBody = {
    intents: [
      {
        id: `intent-${Date.now()}-${Math.random()}`,
        status: "executed",
        kind: "payment",
        chainId: "eip155:1",
        txHash: "0x" + "a".repeat(64),
        declaredAt: "2025-06-15T00:00:00Z",
      },
    ],
    ledgerEntries: [
      {
        id: `entry-${Date.now()}-${Math.random()}`,
        accountId: "cash",
        type: "debit",
        money: { amount: "100.000000", currency: "USDC", decimals: 6 },
        timestamp: "2025-06-15T00:00:00Z",
        correlationId: "tx-1",
      },
    ],
    chainEvents: [
      {
        txHash: "0x" + "a".repeat(64),
        chainId: "eip155:1",
        from: "0x" + "1".repeat(40),
        to: "0x" + "2".repeat(40),
        amount: "100.000000",
        symbol: "USDC",
        decimals: 6,
        timestamp: "2025-06-15T00:00:00Z",
      },
    ],
  };

  const res = await instance.app.request(
    makeRequest("/api/v1/attest", "POST", reconcileBody),
  );

  if (res.status !== 201) {
    const text = await res.text();
    throw new Error(`Failed to create attestation: ${res.status} — ${text}`);
  }

  const body = (await res.json()) as { data: { id: string } };
  return body.data.id;
}

// =============================================================================
// Merkle Root
// =============================================================================

describe("GET /api/v1/proofs/merkle-root", () => {
  let instance: AppInstance;

  beforeEach(() => {
    instance = createTestApp();
  });

  it("returns null root when no attestations exist", async () => {
    const res = await instance.app.request(
      makeRequest("/api/v1/proofs/merkle-root"),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { merkleRoot: string | null; leafCount: number };
    };
    expect(body.data.merkleRoot).toBeNull();
    expect(body.data.leafCount).toBe(0);
  });

  it("returns merkle root after attestations are created", async () => {
    await createAttestation(instance);
    await createAttestation(instance);

    const res = await instance.app.request(
      makeRequest("/api/v1/proofs/merkle-root"),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { merkleRoot: string; leafCount: number; computedAt: string };
    };
    expect(body.data.merkleRoot).toBeTruthy();
    expect(body.data.merkleRoot.length).toBe(64);
    expect(body.data.leafCount).toBe(2);
    expect(body.data.computedAt).toBeTruthy();
  });
});

// =============================================================================
// Attestation Proof Generation
// =============================================================================

describe("GET /api/v1/proofs/attestation/:id", () => {
  let instance: AppInstance;

  beforeEach(() => {
    instance = createTestApp();
  });

  it("generates proof package for existing attestation", async () => {
    const attId = await createAttestation(instance);

    const res = await instance.app.request(
      makeRequest(`/api/v1/proofs/attestation/${attId}`),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        version: number;
        attestation: unknown;
        attestationHash: string;
        merkleRoot: string;
        inclusionProof: { leafHash: string; leafIndex: number; siblings: unknown[]; root: string };
        packagedAt: string;
        packageHash: string;
      };
    };

    expect(body.data.version).toBe(1);
    expect(body.data.attestationHash).toBeTruthy();
    expect(body.data.attestationHash.length).toBe(64);
    expect(body.data.merkleRoot).toBeTruthy();
    expect(body.data.merkleRoot.length).toBe(64);
    expect(body.data.inclusionProof).toBeDefined();
    expect(body.data.inclusionProof.leafIndex).toBe(0);
    expect(body.data.packageHash).toBeTruthy();
    expect(body.data.packageHash.length).toBe(64);
  });

  it("returns 404 for non-existent attestation", async () => {
    const res = await instance.app.request(
      makeRequest("/api/v1/proofs/attestation/att:nonexistent"),
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("generates correct proof for multiple attestations", async () => {
    const attId1 = await createAttestation(instance);
    const attId2 = await createAttestation(instance);

    // Proof for first attestation
    const res1 = await instance.app.request(
      makeRequest(`/api/v1/proofs/attestation/${attId1}`),
    );
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as {
      data: { inclusionProof: { leafIndex: number }; merkleRoot: string };
    };
    expect(body1.data.inclusionProof.leafIndex).toBe(0);

    // Proof for second attestation
    const res2 = await instance.app.request(
      makeRequest(`/api/v1/proofs/attestation/${attId2}`),
    );
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as {
      data: { inclusionProof: { leafIndex: number }; merkleRoot: string };
    };
    expect(body2.data.inclusionProof.leafIndex).toBe(1);

    // Same Merkle root
    expect(body1.data.merkleRoot).toBe(body2.data.merkleRoot);
  });
});

// =============================================================================
// Proof Verification (API)
// =============================================================================

describe("POST /api/v1/proofs/verify", () => {
  let instance: AppInstance;

  beforeEach(() => {
    instance = createTestApp();
  });

  it("verifies a valid proof package", async () => {
    const attId = await createAttestation(instance);

    // Generate proof
    const genRes = await instance.app.request(
      makeRequest(`/api/v1/proofs/attestation/${attId}`),
    );
    const genBody = (await genRes.json()) as { data: unknown };

    // Verify proof
    const verRes = await instance.app.request(
      makeRequest("/api/v1/proofs/verify", "POST", genBody.data),
    );

    expect(verRes.status).toBe(200);
    const verBody = (await verRes.json()) as {
      data: { valid: boolean; verifiedAt: string };
    };
    expect(verBody.data.valid).toBe(true);
    expect(verBody.data.verifiedAt).toBeTruthy();
  });

  it("rejects a tampered proof package", async () => {
    const attId = await createAttestation(instance);

    const genRes = await instance.app.request(
      makeRequest(`/api/v1/proofs/attestation/${attId}`),
    );
    const genBody = (await genRes.json()) as { data: Record<string, unknown> };

    // Tamper with the attestation data
    const tampered = {
      ...genBody.data,
      attestationHash: "0".repeat(64),
    };

    const verRes = await instance.app.request(
      makeRequest("/api/v1/proofs/verify", "POST", tampered),
    );

    expect(verRes.status).toBe(200);
    const verBody = (await verRes.json()) as { data: { valid: boolean } };
    expect(verBody.data.valid).toBe(false);
  });

  it("rejects invalid proof schema", async () => {
    const verRes = await instance.app.request(
      makeRequest("/api/v1/proofs/verify", "POST", { bad: "data" }),
    );

    expect(verRes.status).toBe(400);
    const body = (await verRes.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("accepts a proof package POSTed without 'attestation' (schema validation passes, matching Zod 3)", async () => {
    const attId = await createAttestation(instance);

    const genRes = await instance.app.request(
      makeRequest(`/api/v1/proofs/attestation/${attId}`),
    );
    const genBody = (await genRes.json()) as { data: Record<string, unknown> };

    const { attestation: _omitted, ...withoutAttestation } = genBody.data;
    expect("attestation" in withoutAttestation).toBe(false);

    const apiRes = await instance.app.request(
      makeRequest("/api/v1/proofs/verify", "POST", withoutAttestation),
    );
    expect(apiRes.status).toBe(200);
    const apiBody = (await apiRes.json()) as { data: { valid: boolean } };
    expect(apiBody.data.valid).toBe(false);

    const pubRes = await instance.app.request(
      makeRequest("/public/v1/proofs/verify", "POST", withoutAttestation),
    );
    expect(pubRes.status).toBe(200);
    const pubBody = (await pubRes.json()) as { data: { valid: boolean } };
    expect(pubBody.data.valid).toBe(false);
  });
});

// =============================================================================
// Public Proof Verification
// =============================================================================

describe("POST /public/v1/proofs/verify", () => {
  it("verifies a valid proof without auth", async () => {
    const instance = createTestApp();
    const attId = await createAttestation(instance);

    // Generate proof via API
    const genRes = await instance.app.request(
      makeRequest(`/api/v1/proofs/attestation/${attId}`),
    );
    const genBody = (await genRes.json()) as { data: unknown };

    // Verify via public endpoint (no auth)
    const verRes = await instance.app.request(
      makeRequest("/public/v1/proofs/verify", "POST", genBody.data),
    );

    expect(verRes.status).toBe(200);
    const verBody = (await verRes.json()) as {
      data: { valid: boolean; verifiedAt: string };
    };
    expect(verBody.data.valid).toBe(true);
  });

  it("rejects tampered proof via public endpoint", async () => {
    const instance = createTestApp();
    const attId = await createAttestation(instance);

    const genRes = await instance.app.request(
      makeRequest(`/api/v1/proofs/attestation/${attId}`),
    );
    const genBody = (await genRes.json()) as { data: Record<string, unknown> };

    const tampered = {
      ...genBody.data,
      packageHash: "f".repeat(64),
    };

    const verRes = await instance.app.request(
      makeRequest("/public/v1/proofs/verify", "POST", tampered),
    );

    expect(verRes.status).toBe(200);
    const verBody = (await verRes.json()) as { data: { valid: boolean } };
    expect(verBody.data.valid).toBe(false);
  });
});

// =============================================================================
// Round-Trip: Generate → Serialize → Verify
// =============================================================================

describe("proof round-trip", () => {
  it("generate → JSON serialize → verify succeeds", async () => {
    const instance = createTestApp();

    // Create multiple attestations
    await createAttestation(instance);
    await createAttestation(instance);
    const attId = await createAttestation(instance);

    // Generate proof
    const genRes = await instance.app.request(
      makeRequest(`/api/v1/proofs/attestation/${attId}`),
    );
    expect(genRes.status).toBe(200);
    const genBody = (await genRes.json()) as { data: unknown };

    // Simulate serialization round-trip
    const serialized = JSON.stringify(genBody.data);
    const deserialized = JSON.parse(serialized);

    // Verify deserialized proof
    const verRes = await instance.app.request(
      makeRequest("/api/v1/proofs/verify", "POST", deserialized),
    );

    expect(verRes.status).toBe(200);
    const verBody = (await verRes.json()) as { data: { valid: boolean } };
    expect(verBody.data.valid).toBe(true);
  });
});
