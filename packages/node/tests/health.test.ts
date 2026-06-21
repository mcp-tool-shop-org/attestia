/**
 * Tests for health check endpoints.
 *
 * Verifies:
 * - GET /health returns 200 with status "ok"
 * - GET /ready returns 200 with status "ready" (no tenants)
 * - GET /ready reflects tenant readiness
 * - X-Request-Id is set on responses
 */

import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";
import { createTestApp, jsonRequest } from "./setup.js";

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const { app } = createTestApp();
    const res = await app.request("/health");

    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string; timestamp: string };
    expect(body.status).toBe("ok");
    expect(body.timestamp).toBeDefined();
  });

  it("includes X-Request-Id header", async () => {
    const { app } = createTestApp();
    const res = await app.request("/health");

    expect(res.headers.get("X-Request-Id")).toBeDefined();
  });

  it("preserves incoming X-Request-Id", async () => {
    const { app } = createTestApp();
    const res = await app.request(
      jsonRequest("/health", "GET", undefined, {
        "X-Request-Id": "test-req-123",
      }),
    );

    expect(res.headers.get("X-Request-Id")).toBe("test-req-123");
  });
});

/**
 * App with the opt-in readiness counts enabled (V2-002).
 * The default app exposes only boolean readiness on the unauthenticated probe.
 */
function createCountsApp() {
  return createApp({
    serviceConfig: {
      ownerId: "test-tenant",
      defaultCurrency: "USDC",
      defaultDecimals: 6,
    },
    exposeReadinessCounts: true,
  });
}

describe("GET /ready", () => {
  it("returns 200 ready when no tenants initialized", async () => {
    const { app } = createTestApp();
    const res = await app.request("/ready");

    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ready");
  });

  it("returns only boolean readiness by default — no counts leaked (V2-002)", async () => {
    const { app, tenantRegistry } = createTestApp();
    await tenantRegistry.getOrCreate("tenant-1");

    const res = await app.request("/ready");
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ready");
    expect(body.timestamp).toBeDefined();
    // Counts must be ABSENT on the unauthenticated probe by default.
    expect(body.tenants).toBeUndefined();
    expect(body.ready).toBeUndefined();
    expect(body.notReady).toBeUndefined();
  });

  it("exposes aggregate counts only when explicitly opted in", async () => {
    const { app, tenantRegistry } = createCountsApp();

    // Create a tenant
    await tenantRegistry.getOrCreate("tenant-1");

    const res = await app.request("/ready");
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      status: string;
      tenants: number;
      ready: number;
      notReady: number;
    };
    expect(body.status).toBe("ready");
    expect(body.tenants).toBe(1);
    expect(body.ready).toBe(1);
    expect(body.notReady).toBe(0);
  });

  it("returns 503 when a tenant is not ready", async () => {
    const { app, tenantRegistry } = createTestApp();

    // Create a tenant and stop it
    const service = await tenantRegistry.getOrCreate("tenant-1");
    await service.stop();

    const res = await app.request("/ready");
    expect(res.status).toBe(503);

    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("not_ready");
  });
});

describe("error handling", () => {
  it("returns error envelope for unknown routes", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/v1/nonexistent");

    expect(res.status).toBe(404);
  });
});

// =============================================================================
// D6-A-003 [MEDIUM, security]: /ready must not leak tenant IDs
// =============================================================================

describe("GET /ready tenant enumeration (D6-A-003)", () => {
  it("does not leak per-tenant IDs on the unauthenticated readiness endpoint", async () => {
    const { app, tenantRegistry } = createTestApp();

    // Two tenants with recognisable IDs.
    await tenantRegistry.getOrCreate("acme-corp");
    await tenantRegistry.getOrCreate("globex-inc");

    const res = await app.request("/ready");
    expect(res.status).toBe(200);

    const raw = await res.text();
    // The raw payload must not contain any tenant identifier.
    expect(raw).not.toContain("acme-corp");
    expect(raw).not.toContain("globex-inc");

    const body = JSON.parse(raw) as {
      status: string;
      subsystems?: Record<string, unknown>;
    };

    expect(body.status).toBe("ready");
    // If a subsystems map is present it must not be keyed by tenant IDs.
    if (body.subsystems !== undefined) {
      const keys = Object.keys(body.subsystems);
      expect(keys).not.toContain("acme-corp");
      expect(keys).not.toContain("globex-inc");
    }
  });

  it("still reports aggregate readiness (boolean) without leaking a count", async () => {
    const { app, tenantRegistry } = createTestApp();
    await tenantRegistry.getOrCreate("tenant-1");
    await tenantRegistry.getOrCreate("tenant-2");

    const res = await app.request("/ready");
    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string; tenants?: number };
    expect(body.status).toBe("ready");
    // The count is suppressed on the unauthenticated probe by default (V2-002).
    expect(body.tenants).toBeUndefined();
  });

  it("still returns 503 not_ready when a tenant is down (without leaking which)", async () => {
    const { app, tenantRegistry } = createTestApp();
    const svc = await tenantRegistry.getOrCreate("secret-tenant");
    await svc.stop();

    const res = await app.request("/ready");
    expect(res.status).toBe(503);

    const raw = await res.text();
    expect(raw).not.toContain("secret-tenant");

    const body = JSON.parse(raw) as { status: string };
    expect(body.status).toBe("not_ready");
  });
});

// =============================================================================
// M4: Security headers
// =============================================================================

describe("security headers (M4)", () => {
  it("includes security headers on every response", async () => {
    const { app } = createTestApp();
    const res = await app.request("/health");

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Content-Security-Policy")).toBe("default-src 'none'");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
  });
});
