/**
 * Tests for reconciliation and attestation routes.
 *
 * POST /api/v1/reconcile    — Run reconciliation
 * POST /api/v1/attest       — Attest a reconciliation
 * GET  /api/v1/attestations — List attestation records
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestApp, jsonRequest } from "./setup.js";
import type { AppInstance } from "../src/app.js";

let instance: AppInstance;

beforeEach(() => {
  instance = createTestApp();
});

const validReconcileBody = {
  intents: [
    {
      id: "i1",
      status: "executed",
      kind: "transfer",
      declaredAt: "2025-01-01T00:00:00Z",
      chainId: "evm:1",
      txHash: "0xabc",
    },
  ],
  ledgerEntries: [
    {
      id: "le1",
      accountId: "acc-1",
      type: "debit" as const,
      money: { amount: "100", currency: "USDC", decimals: 6 },
      timestamp: "2025-01-01T00:00:01Z",
      intentId: "i1",
      txHash: "0xabc",
      correlationId: "corr-1",
    },
  ],
  chainEvents: [
    {
      chainId: "evm:1",
      txHash: "0xabc",
      from: "0xsender",
      to: "0xreceiver",
      amount: "100000000",
      decimals: 6,
      symbol: "USDC",
      timestamp: "2025-01-01T00:00:02Z",
    },
  ],
};

describe("POST /api/v1/reconcile", () => {
  it("reconciles valid input and returns a report", async () => {
    const { app } = instance;
    const res = await app.request(
      jsonRequest("/api/v1/reconcile", "POST", validReconcileBody),
    );

    expect(res.status).toBe(200);

    const body = (await res.json()) as { data: { id: string } };
    expect(body.data).toBeDefined();
    expect(body.data.id).toBeDefined();
  });

  it("returns 400 for invalid input", async () => {
    const { app } = instance;
    const res = await app.request(
      jsonRequest("/api/v1/reconcile", "POST", {
        // missing required fields
        intents: [],
      }),
    );

    expect(res.status).toBe(400);
  });

  it("supports optional scope", async () => {
    const { app } = instance;
    const res = await app.request(
      jsonRequest("/api/v1/reconcile", "POST", {
        ...validReconcileBody,
        scope: {
          from: "2025-01-01T00:00:00Z",
          to: "2025-12-31T23:59:59Z",
        },
      }),
    );

    expect(res.status).toBe(200);
  });

  it("surfaces machine-readable structured discrepancies on a mismatch (D4-B-002)", async () => {
    const { app } = instance;
    // An on-chain event whose txHash matches no declared intent/ledger entry,
    // and a ledger entry whose chain leg is therefore missing → a clear,
    // normalization-independent reconciliation mismatch.
    const orphanChainEvent = {
      chainId: "evm:1",
      txHash: "0xdeadbeef",
      from: "0xsender",
      to: "0xreceiver",
      amount: "100000000",
      decimals: 6,
      symbol: "USDC",
      timestamp: "2025-01-01T00:00:02Z",
    };
    const res = await app.request(
      jsonRequest("/api/v1/reconcile", "POST", {
        ...validReconcileBody,
        chainEvents: [orphanChainEvent],
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { summary: { allReconciled: boolean } };
    };
    expect(body.data.summary.allReconciled).toBe(false);
    // The report carries machine-readable discrepancies (code + dimension),
    // not just prose — surfaced verbatim in the API response.
    const serialized = JSON.stringify(body.data);
    expect(serialized).toContain("structuredDiscrepancies");
    expect(serialized).toMatch(/MISSING_|AMOUNT_MISMATCH|CURRENCY_MISMATCH/);
  });
});

describe("POST /api/v1/attest", () => {
  it("reconciles and attests, returning 201", async () => {
    const { app } = instance;
    const res = await app.request(
      jsonRequest("/api/v1/attest", "POST", validReconcileBody),
    );

    expect(res.status).toBe(201);

    const body = (await res.json()) as { data: { reportHash: string } };
    expect(body.data).toBeDefined();
    expect(body.data.reportHash).toBeDefined();
  });
});

describe("GET /api/v1/attestations", () => {
  it("returns empty list initially", async () => {
    const { app } = instance;
    const res = await app.request("/api/v1/attestations");

    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      data: unknown[];
      pagination: { hasMore: boolean };
    };
    expect(body.data).toEqual([]);
    expect(body.pagination.hasMore).toBe(false);
  });

  it("returns attestations after attesting", async () => {
    const { app } = instance;

    // Create an attestation
    await app.request(
      jsonRequest("/api/v1/attest", "POST", validReconcileBody),
    );

    const res = await app.request("/api/v1/attestations");
    expect(res.status).toBe(200);

    const body = (await res.json()) as { data: { reportHash: string }[] };
    expect(body.data.length).toBe(1);
  });
});
