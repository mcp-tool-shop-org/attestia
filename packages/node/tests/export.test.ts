/**
 * Tests for export endpoints.
 *
 * GET /api/v1/export/events — NDJSON event stream
 * GET /api/v1/export/state  — State snapshot + GlobalStateHash
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestApp, jsonRequest } from "./setup.js";
import type { AppInstance } from "../src/app.js";

let instance: AppInstance;

beforeEach(() => {
  instance = createTestApp();
});

describe("GET /api/v1/export/events", () => {
  it("returns empty body when no events exist", async () => {
    const { app } = instance;
    const res = await app.request("/api/v1/export/events");

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/x-ndjson");

    const text = await res.text();
    expect(text).toBe("");
  });

  it("returns valid NDJSON content type", async () => {
    const { app } = instance;

    const res = await app.request("/api/v1/export/events");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/x-ndjson");

    const text = await res.text();
    // If there are events, each line must be valid JSON
    if (text.trim().length > 0) {
      const lines = text.trim().split("\n");
      for (const line of lines) {
        const parsed = JSON.parse(line);
        expect(parsed).toHaveProperty("event");
        expect(parsed).toHaveProperty("streamId");
      }
    }
  });
});

describe("GET /api/v1/export/state", () => {
  it("returns state snapshot with GlobalStateHash", async () => {
    const { app } = instance;
    const res = await app.request("/api/v1/export/state");

    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      data: {
        ledgerSnapshot: unknown;
        registrumSnapshot: unknown;
        globalStateHash: {
          hash: string;
          computedAt: string;
          subsystems: { ledger: string; registrum: string };
        };
      };
    };

    expect(body.data.ledgerSnapshot).toBeDefined();
    expect(body.data.registrumSnapshot).toBeDefined();
    expect(body.data.globalStateHash).toBeDefined();
    expect(body.data.globalStateHash.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.data.globalStateHash.subsystems.ledger).toMatch(/^[0-9a-f]{64}$/);
    expect(body.data.globalStateHash.subsystems.registrum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("GlobalStateHash is deterministic", async () => {
    const { app } = instance;

    const res1 = await app.request("/api/v1/export/state");
    const body1 = (await res1.json()) as {
      data: { globalStateHash: { hash: string } };
    };

    const res2 = await app.request("/api/v1/export/state");
    const body2 = (await res2.json()) as {
      data: { globalStateHash: { hash: string } };
    };

    expect(body1.data.globalStateHash.hash).toBe(body2.data.globalStateHash.hash);
  });
});

// =============================================================================
// B-NODE-006 [degradation]: the export STREAMS NDJSON one line per event
// (no full-history buffering) and surfaces the event count in a header so
// auditors can detect truncation.
// =============================================================================

describe("export events streaming (B-NODE-006)", () => {
  /** Append N events to the default tenant's event store. */
  async function seedEvents(tenantRegistry: AppInstance["tenantRegistry"], n: number): Promise<void> {
    const service = await tenantRegistry.getOrCreate("test-tenant");
    for (let i = 0; i < n; i++) {
      service.eventStore.append("export.stream", [
        {
          type: "export.test.event",
          metadata: {
            eventId: `evt-${i}`,
            timestamp: new Date().toISOString(),
            actor: "test",
            correlationId: `corr-${i}`,
            source: "vault",
          },
          payload: { i },
        },
      ]);
    }
  }

  it("sets X-Total-Count to the streamed line count", async () => {
    const { app, tenantRegistry } = createTestApp();
    await seedEvents(tenantRegistry, 3);

    const res = await app.request(
      jsonRequest("/api/v1/export/events", "GET", undefined, {
        "X-Tenant-Id": "test-tenant",
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/x-ndjson");

    const total = Number(res.headers.get("X-Total-Count"));
    const text = await res.text();
    const lines = text.length > 0 ? text.trimEnd().split("\n") : [];

    expect(total).toBe(3);
    // Header count matches the streamed line count exactly (truncation detector).
    expect(lines.length).toBe(total);
  });

  it("streams each event as its own valid JSON line (NDJSON)", async () => {
    const { app, tenantRegistry } = createTestApp();
    await seedEvents(tenantRegistry, 4);

    const res = await app.request(
      jsonRequest("/api/v1/export/events", "GET", undefined, {
        "X-Tenant-Id": "test-tenant",
      }),
    );

    const text = await res.text();
    const lines = text.trimEnd().split("\n");
    expect(lines.length).toBe(4);
    for (const line of lines) {
      // Each line independently parses — the hallmark of NDJSON streaming.
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("returns an empty body and X-Total-Count 0 when there are no events", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/v1/export/events");

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Total-Count")).toBe("0");
    expect(await res.text()).toBe("");
  });
});
