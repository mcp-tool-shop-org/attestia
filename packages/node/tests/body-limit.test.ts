/**
 * Tests for the HTTP body-size limit (A-NODE-005) and bounded open-ended
 * record schemas.
 *
 * A-NODE-005:
 *  - Oversized request bodies on /api/* and /public/* are rejected with a
 *    structured 413 BEFORE c.req.json()/Zod buffers them.
 *  - Legitimate-size bodies still pass.
 *  - `z.record(z.unknown())` snapshot/extra fields are now bounded: a record
 *    with too many entries (or too large serialized) is rejected by validation.
 */

import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";
import type { AppInstance } from "../src/app.js";
import { jsonRequest } from "./setup.js";
import {
  ReplayVerifySchema,
  boundedRecord,
  MAX_RECORD_ENTRIES,
} from "../src/types/dto.js";

function appWithLimit(maxBodyBytes: number): AppInstance {
  return createApp({
    serviceConfig: { ownerId: "test-tenant", defaultCurrency: "USDC", defaultDecimals: 6 },
    maxBodyBytes,
  });
}

// =============================================================================
// A-NODE-005 — body-size guard
// =============================================================================

describe("A-NODE-005 — request body-size limit", () => {
  it("rejects an oversized /api/* body with a structured 413", async () => {
    const instance = appWithLimit(1024); // 1 KiB cap

    const huge = {
      id: "intent-1",
      kind: "transfer",
      description: "x".repeat(4096), // well over 1 KiB
      params: {},
    };

    const res = await instance.app.request(jsonRequest("/api/v1/intents", "POST", huge));
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(body.error.message).toBeTruthy();
  });

  it("rejects an oversized /public/* body with 413", async () => {
    const instance = appWithLimit(512);
    const huge = {
      reportId: "r1",
      verifierId: "v1",
      verdict: "PASS",
      subsystemChecks: [],
      discrepancies: ["x".repeat(2048)],
      bundleHash: "b".repeat(64),
      verifiedAt: "2025-06-15T00:00:00Z",
    };

    const res = await instance.app.request(
      jsonRequest("/public/v1/verify/submit-report", "POST", huge),
    );
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("accepts a legitimately-sized body under the cap", async () => {
    const instance = appWithLimit(64 * 1024); // generous 64 KiB cap

    const ok = {
      id: "intent-ok",
      kind: "transfer",
      description: "Send 100 USDC",
      params: { fromAddress: "0xabc", toAddress: "0xdef" },
    };

    const res = await instance.app.request(jsonRequest("/api/v1/intents", "POST", ok));
    expect(res.status).toBe(201);
  });
});

// =============================================================================
// A-NODE-005 — bounded records
// =============================================================================

describe("A-NODE-005 — bounded open-ended record schemas", () => {
  it("boundedRecord rejects a record with too many entries", () => {
    const tooMany: Record<string, unknown> = {};
    for (let i = 0; i < MAX_RECORD_ENTRIES + 1; i++) tooMany[`k${i}`] = 1;
    const result = boundedRecord().safeParse(tooMany);
    expect(result.success).toBe(false);
  });

  it("boundedRecord rejects a record exceeding the serialized-size cap", () => {
    // 100 entries, each value a 4 KiB string → ~400 KiB > 256 KiB cap.
    const big: Record<string, unknown> = {};
    for (let i = 0; i < 100; i++) big[`k${i}`] = "x".repeat(4096);
    const result = boundedRecord().safeParse(big);
    expect(result.success).toBe(false);
  });

  it("boundedRecord accepts a normal small record", () => {
    const result = boundedRecord().safeParse({ a: 1, b: "two", c: { nested: true } });
    expect(result.success).toBe(true);
  });

  it("ReplayVerifySchema rejects an oversized snapshot record", () => {
    const big: Record<string, unknown> = {};
    for (let i = 0; i < MAX_RECORD_ENTRIES + 1; i++) big[`k${i}`] = i;
    const result = ReplayVerifySchema.safeParse({
      ledgerSnapshot: big,
      registrumSnapshot: {},
    });
    expect(result.success).toBe(false);
  });

  it("ReplayVerifySchema accepts normal snapshots", () => {
    const result = ReplayVerifySchema.safeParse({
      ledgerSnapshot: { accounts: 3, version: 1 },
      registrumSnapshot: { entries: 5 },
    });
    expect(result.success).toBe(true);
  });
});
