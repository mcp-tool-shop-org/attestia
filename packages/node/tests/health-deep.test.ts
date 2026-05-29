/**
 * Tests for deep health check (/ready endpoint).
 */

import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";
import { createTestApp, jsonRequest } from "./setup.js";

/**
 * App with the opt-in readiness counts enabled (V2-002). The default app
 * exposes only boolean readiness on the unauthenticated probe.
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

describe("deep health check", () => {
  it("GET /health returns 200 always", async () => {
    const { app } = createTestApp();
    const res = await app.request(jsonRequest("/health"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.timestamp).toBeDefined();
  });

  it("GET /ready returns 200 with no tenants initialized", async () => {
    const { app } = createTestApp();
    const res = await app.request(jsonRequest("/ready"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ready");
    // Default probe is boolean-only — no counts (V2-002).
    expect(body.tenants).toBeUndefined();
  });

  it("GET /ready returns 200 after tenant is used", async () => {
    // Counts enabled so we can observe the aggregate readiness numbers.
    const { app } = createCountsApp();

    // Trigger tenant creation by making an API request
    await app.request(jsonRequest("/api/v1/intents"));

    const res = await app.request(jsonRequest("/ready"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ready");
    expect(body.tenants).toBeGreaterThan(0);

    // Aggregate readiness counts are reported (opt-in); no per-tenant
    // breakdown is exposed on this endpoint (D6-A-003).
    expect(body.ready).toBeGreaterThan(0);
    expect(body.notReady).toBe(0);
    expect(body.subsystems).toBeUndefined();
  });

  it("GET /ready returns 503 when service is stopped", async () => {
    const { app, tenantRegistry } = createTestApp();

    // Create a tenant, then stop it
    const service = tenantRegistry.getOrCreate("test-tenant");
    await service.stop();

    const res = await app.request(jsonRequest("/ready"));
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.status).toBe("not_ready");
  });

  it("GET /ready reports an aggregate not-ready count when a tenant is down", async () => {
    // Counts enabled so the aggregate not-ready number is present to assert on.
    const { app, tenantRegistry } = createCountsApp();

    const service = tenantRegistry.getOrCreate("test-tenant");
    await service.stop();

    const res = await app.request(jsonRequest("/ready"));
    const body = await res.json();

    // Aggregate-only: the down tenant is counted but never named (D6-A-003).
    expect(body.status).toBe("not_ready");
    expect(body.notReady).toBeGreaterThan(0);
    expect(body.subsystems).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("test-tenant");
  });

  it("GET /ready reports timestamp", async () => {
    const { app } = createTestApp();
    const res = await app.request(jsonRequest("/ready"));
    const body = await res.json();

    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
