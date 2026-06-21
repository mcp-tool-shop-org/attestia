/**
 * Durability tests for AttestiaService persistence mode.
 *
 * These tests prove the HYBRID durable design:
 *   - DEFAULT (no persistence) is byte-identical to the original service:
 *     writes NO files and appends NO domain events.
 *   - PERSISTENT mode survives a full discard-and-rebuild with the SAME dataDir
 *     + ownerId: intent status, payroll run, budget envelope and ledger balances
 *     all restore, and the durable event log hash-chain verifies.
 *   - The durable event log is the AUDIT TRUTH: it contains the expected domain
 *     events in order; in default mode it stays empty (existing behavior).
 *   - A corrupt snapshot fails closed: that subsystem starts empty + a warn is
 *     emitted, with no crash.
 *   - A crash window (event log ahead of the latest snapshot) is detected and a
 *     gap warn is emitted, never silently swallowed.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { AttestiaService } from "../../src/services/attestia-service.js";
import type { Telemetry, ObservabilityEvent } from "@attestia/types";
import { tenantPaths } from "../../src/services/persistence-paths.js";

const OWNER = "tenant-durable-1";
const USDC = (amount: string) => ({ amount, currency: "USDC", decimals: 6 });

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "attestia-durable-"));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

/** A telemetry sink that captures every recorded event for assertions. */
function captureSink(): { sink: Telemetry; events: ObservabilityEvent[] } {
  const events: ObservabilityEvent[] = [];
  return {
    events,
    sink: {
      record(e: ObservabilityEvent): void {
        events.push(e);
      },
    },
  };
}

/** Build a persistent service for the shared OWNER + dataDir. */
function makePersistentService(telemetry?: Telemetry): AttestiaService {
  return new AttestiaService({
    ownerId: OWNER,
    defaultCurrency: "USDC",
    defaultDecimals: 6,
    ...(telemetry ? { telemetry } : {}),
    persistence: { dataDir },
  });
}

describe("default config (no persistence) — in-memory path untouched", () => {
  it("writes NO files and behaves identically", async () => {
    const before = readdirSync(dataDir);
    expect(before.length).toBe(0);

    const service = new AttestiaService({
      ownerId: OWNER,
      defaultCurrency: "USDC",
      defaultDecimals: 6,
    });
    await service.initialize();

    // Full intent lifecycle works.
    service.declareIntent("i-1", "transfer", "Send 100 USDC", { toAddress: "0xabc" });
    service.approveIntent("i-1", "ok");
    expect(service.getIntent("i-1")?.status).toBe("approved");

    // No tenant directory is ever created for the default in-memory service.
    expect(existsSync(tenantPaths(dataDir, OWNER).tenantDir)).toBe(false);
    expect(readdirSync(dataDir).length).toBe(0);

    // And the event store stays EMPTY (no domain-event appends in default mode).
    expect(service.readAllEvents().length).toBe(0);
  });
});

describe("durable round-trip — survive discard + rebuild", () => {
  it("restores intent, payroll run, envelope and ledger balances; chain verifies", async () => {
    // ── First instance: do real work. ──
    const s1 = makePersistentService();
    await s1.initialize();

    // Intent: declare + approve.
    s1.declareIntent("i-1", "transfer", "Payroll batch", { toAddress: "0xpayroll" });
    s1.approveIntent("i-1", "CFO approved");

    // Payroll: register payee + schedule, create + approve + execute a run.
    s1.registerPayee("p-1", "Alice", "0xAlice");
    s1.setPaySchedule("p-1", [
      { id: "base", name: "Base", type: "base", amount: USDC("5000"), recurring: true, taxable: true },
    ]);
    s1.createPayrollRun("run-1", { start: "2025-01-01", end: "2025-01-31", label: "2025-Jan" });
    s1.approvePayrollRun("run-1");
    const executedRun = s1.executePayrollRun("run-1");
    expect(executedRun.status).toBe("executed");

    // Budget: create + allocate an envelope.
    s1.createEnvelope("env-1", "Operating", "ops");
    s1.allocateToEnvelope("env-1", USDC("1000"));

    // The standalone service ledger (used for export / GlobalStateHash) is the
    // ledger covered by the durable snapshot set. Seed + capture it so we can
    // assert it round-trips. (The Treasury's INTERNAL ledger is a derived
    // side-effect of run execution and is NOT part of the Treasury snapshot
    // contract — see the ceiling note in attestia-service.ts.)
    s1.ledger.registerAccount({ id: "cash", type: "asset", name: "Cash" });
    s1.ledger.registerAccount({ id: "rev", type: "income", name: "Revenue" });
    s1.ledger.append([
      {
        id: "le-1",
        accountId: "cash",
        type: "debit",
        money: USDC("250"),
        timestamp: "2025-01-15T00:00:00Z",
        correlationId: "tx-1",
      },
      {
        id: "le-2",
        accountId: "rev",
        type: "credit",
        money: USDC("250"),
        timestamp: "2025-01-15T00:00:00Z",
        correlationId: "tx-1",
      },
    ]);
    // Capture the standalone ledger snapshot for round-trip comparison.
    const ledgerSnapshotBefore = s1.getStateSnapshot().globalStateHash.subsystems.ledger;

    // Clean shutdown flushes a final snapshot of all subsystems (including the
    // directly-appended standalone ledger entries above).
    await s1.stop();

    // ── Discard s1 (simulate process exit). A new instance with the SAME
    //    dataDir + ownerId must come up with full state. ──
    const s2 = makePersistentService();
    await s2.initialize();

    // Intent restored at the right status.
    expect(s2.getIntent("i-1")?.status).toBe("approved");

    // Payroll run restored and still executed.
    const restoredRun = s2.getPayrollRun("run-1");
    expect(restoredRun.status).toBe("executed");
    expect(restoredRun.entries.length).toBe(1);
    expect(s2.listPayrollRuns().map((r) => r.id)).toContain("run-1");

    // Envelope restored with its allocation.
    const restoredEnvelope = s2.listEnvelopes().find((e) => e.id === "env-1");
    expect(restoredEnvelope).toBeDefined();
    // The budget engine normalizes amounts to the envelope's decimals (USDC = 6).
    expect(restoredEnvelope?.allocated).toBe("1000.000000");

    // Standalone service ledger (export ledger) restored — same subsystem hash.
    const ledgerSnapshotAfter = s2.getStateSnapshot().globalStateHash.subsystems.ledger;
    expect(ledgerSnapshotAfter).toBe(ledgerSnapshotBefore);
    expect(s2.ledger.getEntries().length).toBe(2);

    // Durable event log hash-chain verifies after reload.
    const integrity = s2.checkEventStoreWritable();
    expect(integrity.writable).toBe(true);
    expect(integrity.integrity.valid).toBe(true);
  });
});

describe("audit log — durable event store is the audit truth", () => {
  it("contains the expected domain events in order (persistent mode)", async () => {
    const s = makePersistentService();
    await s.initialize();

    s.declareIntent("i-1", "transfer", "d", { toAddress: "0xabc" });
    s.approveIntent("i-1", "ok");
    s.createEnvelope("env-1", "Ops");
    s.allocateToEnvelope("env-1", USDC("500"));

    const types = s.readAllEvents().map((e) => e.event.type);
    expect(types).toEqual([
      "vault.intent.declared",
      "vault.intent.approved",
      "vault.budget.allocated",
    ]);
  });

  it("stays EMPTY in default in-memory mode (existing behavior)", async () => {
    const s = new AttestiaService({
      ownerId: OWNER,
      defaultCurrency: "USDC",
      defaultDecimals: 6,
    });
    await s.initialize();

    s.declareIntent("i-1", "transfer", "d", { toAddress: "0xabc" });
    s.approveIntent("i-1", "ok");

    expect(s.readAllEvents().length).toBe(0);
  });
});

describe("corrupt-snapshot — fail closed, start empty, warn, no crash", () => {
  it("tampering a snapshot file makes that subsystem restore empty + emit a warn", async () => {
    // Seed real state so a vault snapshot exists.
    const s1 = makePersistentService();
    await s1.initialize();
    s1.declareIntent("i-1", "transfer", "d", { toAddress: "0xabc" });
    s1.approveIntent("i-1", "ok");
    await s1.stop(); // flush final snapshots

    // Tamper the latest vault snapshot file: break its stateHash integrity.
    // FileSnapshotStore stores each stream under a dir named sha256(streamId)
    // sliced to 32 hex chars (see snapshot-store.ts _streamDir), so we recompute
    // that to locate the vault stream's directory.
    const { snapshotBaseDir } = tenantPaths(dataDir, OWNER);
    const vaultStreamDirName = createHash("sha256").update("vault").digest("hex").slice(0, 32);
    const vaultDir = join(snapshotBaseDir, vaultStreamDirName);
    const files = readdirSync(vaultDir).filter((f) => /^\d+\.json$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    // Highest-version file is the one restore loads.
    const latest = files.map((f) => Number(f.replace(".json", ""))).sort((a, b) => a - b).pop()!;
    const target = join(vaultDir, `${latest}.json`);
    // Append garbage so the persisted state no longer matches its stateHash.
    writeFileSync(target, JSON.stringify({ tampered: true, garbage: "x".repeat(8) }), "utf8");

    // Reload: the vault snapshot fails closed → vault starts empty + a warn.
    const { sink, events } = captureSink();
    const s2 = makePersistentService(sink);
    await s2.initialize(); // must NOT throw

    // Vault started empty — the tampered intent is gone.
    expect(s2.getIntent("i-1")).toBeUndefined();

    // A corrupt/restore warn naming the vault stream was emitted.
    const warned = events.some(
      (e) =>
        e.level === "warn" &&
        (e.op === "restore.corrupt" || e.op === "restore.failed") &&
        e.attributes?.stream === "vault",
    );
    expect(warned).toBe(true);
  });
});

describe("crash-window — event log ahead of snapshot emits a gap warn", () => {
  it("an extra event appended after the last snapshot is detected on restore", async () => {
    // onShutdown cadence so snapshots only happen in stop(): this lets us append
    // an event AFTER the last snapshot without auto-snapshotting it.
    const s1 = new AttestiaService({
      ownerId: OWNER,
      defaultCurrency: "USDC",
      defaultDecimals: 6,
      persistence: { dataDir, snapshotCadence: "onShutdown" },
    });
    await s1.initialize();
    s1.declareIntent("i-1", "transfer", "d", { toAddress: "0xabc" });
    s1.snapshotAll(); // snapshot set stamped at the current log position

    // Append one more event AFTER the snapshot — the documented crash window.
    s1.approveIntent("i-1", "ok");
    // NOTE: no further snapshotAll(), and we do NOT call stop() (which would snapshot).

    // Reload: live log is ahead of the manifest → gap warn.
    const { sink, events } = captureSink();
    const s2 = new AttestiaService({
      ownerId: OWNER,
      defaultCurrency: "USDC",
      defaultDecimals: 6,
      telemetry: sink,
      persistence: { dataDir, snapshotCadence: "onShutdown" },
    });
    await s2.initialize();

    const gapWarn = events.find(
      (e) => e.op === "restore.crashWindow" && e.level === "warn",
    );
    expect(gapWarn).toBeDefined();
    expect(Number(gapWarn?.attributes?.gap)).toBeGreaterThanOrEqual(1);
  });
});

describe("per-tenant isolation — no cross-tenant leakage", () => {
  it("two tenants under the same dataDir get distinct full-hash directories", async () => {
    const a = new AttestiaService({
      ownerId: "tenant-a",
      defaultCurrency: "USDC",
      defaultDecimals: 6,
      persistence: { dataDir },
    });
    const b = new AttestiaService({
      ownerId: "tenant-b",
      defaultCurrency: "USDC",
      defaultDecimals: 6,
      persistence: { dataDir },
    });
    await a.initialize();
    await b.initialize();

    a.declareIntent("only-a", "transfer", "d", { toAddress: "0xa" });
    b.declareIntent("only-b", "transfer", "d", { toAddress: "0xb" });

    const dirA = tenantPaths(dataDir, "tenant-a").tenantDir;
    const dirB = tenantPaths(dataDir, "tenant-b").tenantDir;
    expect(dirA).not.toBe(dirB);

    // Each tenant only sees its own intent.
    expect(a.getIntent("only-a")).toBeDefined();
    expect(a.getIntent("only-b")).toBeUndefined();
    expect(b.getIntent("only-b")).toBeDefined();
    expect(b.getIntent("only-a")).toBeUndefined();

    // The directory name is the FULL 64-char sha256 hex, not a slice.
    const name = dirA.split(/[\\/]/).pop()!;
    expect(name).toMatch(/^[0-9a-f]{64}$/);
  });
});
