/**
 * Tests for TenantRegistry — has(), stopAll(), and the SEAM-1 init contract.
 *
 * SEAM-1 (DUR-COMPOSED-001): getOrCreate() must initialize() a newly-created
 * service before returning it, so a registry-created tenant WITH persistence
 * restores its durable state on first access. The bare-service path (new
 * AttestiaService + await initialize()) always worked; the registry path — the
 * production multi-tenant path used by middleware/tenant.ts, app.ts, and
 * routes/health.ts — previously did NOT call initialize(), so a restarted
 * tenant came up EMPTY and silently diverged from the audit log.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TenantRegistry } from "../src/services/tenant-registry.js";

const defaultConfig = {
  ownerId: "default",
  defaultCurrency: "USDC",
  defaultDecimals: 6,
};

describe("TenantRegistry", () => {
  it("has() returns false for unknown tenant", async () => {
    const registry = new TenantRegistry(defaultConfig);
    expect(registry.has("nonexistent")).toBe(false);
  });

  it("has() returns true after getOrCreate", async () => {
    const registry = new TenantRegistry(defaultConfig);
    await registry.getOrCreate("tenant-a");
    expect(registry.has("tenant-a")).toBe(true);
    expect(registry.has("tenant-b")).toBe(false);
  });

  it("stopAll() clears the registry", async () => {
    const registry = new TenantRegistry(defaultConfig);
    await registry.getOrCreate("t1");
    await registry.getOrCreate("t2");

    expect(registry.tenantIds().length).toBe(2);

    await registry.stopAll();

    expect(registry.tenantIds().length).toBe(0);
    expect(registry.has("t1")).toBe(false);
    expect(registry.has("t2")).toBe(false);
  });
});

// =============================================================================
// SEAM-1 — registry path restores durable tenant state on lazy create
// =============================================================================

describe("TenantRegistry — durable restore on lazy create (SEAM-1)", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "attestia-registry-restore-"));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("a NEW registry over the same dataDir restores a tenant's state on first getOrCreate", async () => {
    const TENANT = "acme";

    // ── First registry: lazily create the tenant and do durable work. ──
    const r1 = new TenantRegistry({ ...defaultConfig, persistence: { dataDir } });
    const s1 = await r1.getOrCreate(TENANT);
    s1.declareIntent("i-1", "transfer", "Payroll batch", { toAddress: "0xpayroll" });
    s1.approveIntent("i-1", "CFO approved");
    expect(s1.getIntent("i-1")?.status).toBe("approved");
    // Clean shutdown flushes a final snapshot of every subsystem.
    await r1.stopAll();

    // ── Discard r1 (simulate process exit). A NEW registry over the SAME
    //    dataDir must lazily create the tenant on first getOrCreate AND restore
    //    its durable state — not come up empty. ──
    const r2 = new TenantRegistry({ ...defaultConfig, persistence: { dataDir } });
    expect(r2.has(TENANT)).toBe(false);
    const s2 = await r2.getOrCreate(TENANT);

    // RESTORED, not empty: the intent is present at the right status. Before the
    // fix (getOrCreate never called initialize → restoreAll), this was undefined.
    expect(s2.getIntent("i-1")).toBeDefined();
    expect(s2.getIntent("i-1")?.status).toBe("approved");

    await r2.stopAll();
  });

  it("concurrent getOrCreate for the same new tenant share ONE init (no double-init / race)", async () => {
    const TENANT = "shared-init";
    const registry = new TenantRegistry({
      ...defaultConfig,
      persistence: { dataDir },
    });

    // Fire several concurrent getOrCreate calls before any has resolved.
    const [a, b, c] = await Promise.all([
      registry.getOrCreate(TENANT),
      registry.getOrCreate(TENANT),
      registry.getOrCreate(TENANT),
    ]);

    // All resolve to the SAME instance (cached) and the service is ready.
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a.isReady()).toBe(true);

    await registry.stopAll();
  });

  it("in-memory (no persistence) tenants are unaffected and still ready", async () => {
    const registry = new TenantRegistry(defaultConfig);
    const service = await registry.getOrCreate("mem-tenant");
    expect(service.isReady()).toBe(true);
    // No persistence → no domain-event appends (byte-identical in-memory path).
    service.declareIntent("i-1", "transfer", "d", { toAddress: "0xabc" });
    expect(service.readAllEvents().length).toBe(0);
    await registry.stopAll();
  });
});
