/**
 * Stage C humanization / hardening (PB-VT-001..007).
 *
 * Covers the proactive-health fixes:
 * - PB-VT-001: PortfolioObserver surfaces partial failures (errors + partial)
 *   and emits a degraded `portfolio.observe` telemetry event.
 * - PB-VT-002: Vault.restoreFromSnapshot restores committed state directly, so
 *   a snapshot that would break a replay-based restore now restores; a corrupt
 *   snapshot fails closed before any state is mutated.
 * - PB-VT-003: an unrecognised snapshot version is rejected.
 * - PB-VT-004: import* fail closed on a non-empty target / duplicate ids.
 * - PB-VT-005: budget/intent rejection paths emit telemetry.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ObservabilityEvent, Telemetry } from "@attestia/types";
import { ObserverRegistry } from "@attestia/chain-observer";
import type {
  ChainObserver,
  BalanceResult,
  TokenBalance,
  TransferEvent,
} from "@attestia/chain-observer";
import { PortfolioObserver } from "../src/portfolio.js";
import { BudgetEngine, BudgetError } from "../src/budget.js";
import { IntentManager, IntentError } from "../src/intent-manager.js";
import { Vault, VaultError } from "../src/vault.js";
import type { VaultConfig, VaultSnapshot, Envelope } from "../src/types.js";

// =============================================================================
// Helpers
// =============================================================================

function captureSink(): { telemetry: Telemetry; events: ObservabilityEvent[] } {
  const events: ObservabilityEvent[] = [];
  return { events, telemetry: { record: (e) => events.push(e) } };
}

function usdc(amount: string) {
  return { amount, currency: "USDC", decimals: 6 };
}

function mockObserver(chainId: string, balance = "1000000000000000000"): ChainObserver {
  return {
    chainId,
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockResolvedValue({
      chainId,
      connected: true,
      latestBlock: 1,
      checkedAt: new Date().toISOString(),
    }),
    getBalance: vi.fn().mockResolvedValue({
      chainId,
      address: "0xAddr",
      balance,
      decimals: 18,
      symbol: "ETH",
      atBlock: 1,
      observedAt: new Date().toISOString(),
    } satisfies BalanceResult),
    getTokenBalance: vi.fn().mockResolvedValue({
      chainId,
      address: "0xAddr",
      token: "0xTok",
      symbol: "USDC",
      balance: "1000000",
      decimals: 6,
      observedAt: new Date().toISOString(),
    } satisfies TokenBalance),
    getTransfers: vi.fn().mockResolvedValue([] as readonly TransferEvent[]),
  };
}

const CONFIG: VaultConfig = {
  ownerId: "user-1",
  watchedAddresses: [{ chainId: "eip155:1", address: "0xAddr" }],
  defaultCurrency: "USDC",
  defaultDecimals: 6,
};

// =============================================================================
// PB-VT-001 — portfolio partial-failure surfacing
// =============================================================================

describe("PortfolioObserver partial-failure surfacing (PB-VT-001)", () => {
  it("returns errors + partial=false on a fully-observed portfolio", async () => {
    const registry = new ObserverRegistry();
    registry.register(mockObserver("eip155:1"));
    const portfolio = new PortfolioObserver(registry);

    const result = await portfolio.observe("owner-1", [
      { chainId: "eip155:1", address: "0xA" },
    ]);

    expect(result.partial).toBe(false);
    expect(result.errors).toEqual([]);
  });

  it("surfaces a missing-observer chain as a structured error + partial flag", async () => {
    const registry = new ObserverRegistry();
    registry.register(mockObserver("eip155:1"));
    const sink = captureSink();
    const portfolio = new PortfolioObserver(registry, sink.telemetry);

    const result = await portfolio.observe("owner-1", [
      { chainId: "eip155:1", address: "0xA" },
      { chainId: "eip155:999", address: "0xB" }, // no observer
    ]);

    expect(result.partial).toBe(true);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.chainId).toBe("eip155:999");
    expect(result.errors[0]!.reason).toContain("No observer");
    // Totals still computed from the reachable chain.
    expect(result.nativePositions).toHaveLength(1);

    // Telemetry: degraded portfolio.observe with low-cardinality counts only.
    const evt = sink.events.find((e) => e.op === "portfolio.observe");
    expect(evt).toBeDefined();
    expect(evt!.outcome).toBe("degraded");
    expect(evt!.attributes).toEqual({ chainsTotal: 2, chainsFailed: 1 });
    // No raw address/reason leaks into attributes.
    expect(evt!.message).toContain("partial");
  });

  it("surfaces an RPC failure as an error and keeps the rest of the portfolio", async () => {
    const registry = new ObserverRegistry();
    const failing = mockObserver("eip155:1");
    (failing.getBalance as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("RPC timeout"),
    );
    registry.register(failing);
    const portfolio = new PortfolioObserver(registry);

    const result = await portfolio.observe("owner-1", [
      { chainId: "eip155:1", address: "0xA" },
    ]);

    expect(result.partial).toBe(true);
    expect(result.errors[0]!.reason).toContain("RPC timeout");
    expect(result.nativePositions).toHaveLength(0);
  });

  it("records a malformed balance string as an error instead of throwing", async () => {
    const registry = new ObserverRegistry();
    const bad = mockObserver("eip155:1", "not-a-number");
    registry.register(bad);
    const portfolio = new PortfolioObserver(registry);

    const result = await portfolio.observe("owner-1", [
      { chainId: "eip155:1", address: "0xA" },
    ]);

    // Does not throw; the bad balance is surfaced and excluded from totals.
    expect(result.partial).toBe(true);
    expect(result.errors.some((e) => e.reason.includes("Malformed"))).toBe(true);
    expect(result.totals).toHaveLength(0);
  });

  it("keeps same-symbol-different-decimals positions as separate totals", async () => {
    const registry = new ObserverRegistry();
    // Two chains report 'USDC' but with different decimals — must NOT be summed.
    const c1 = mockObserver("eip155:1");
    (c1.getBalance as ReturnType<typeof vi.fn>).mockResolvedValue({
      chainId: "eip155:1",
      address: "0xA",
      balance: "1000000",
      decimals: 6,
      symbol: "USDC",
      atBlock: 1,
      observedAt: new Date().toISOString(),
    });
    const c2 = mockObserver("eip155:2");
    (c2.getBalance as ReturnType<typeof vi.fn>).mockResolvedValue({
      chainId: "eip155:2",
      address: "0xA",
      balance: "1000000000000000000",
      decimals: 18,
      symbol: "USDC",
      atBlock: 1,
      observedAt: new Date().toISOString(),
    });
    registry.register(c1);
    registry.register(c2);
    const portfolio = new PortfolioObserver(registry);

    const result = await portfolio.observe("owner-1", [
      { chainId: "eip155:1", address: "0xA" },
      { chainId: "eip155:2", address: "0xA" },
    ]);

    // Two distinct totals (one per decimals), not one wrong merged total.
    expect(result.totals).toHaveLength(2);
  });
});

// =============================================================================
// PB-VT-002 / PB-VT-003 — robust restore + version check
// =============================================================================

describe("Vault.restoreFromSnapshot robustness (PB-VT-002/003)", () => {
  let registry: ObserverRegistry;
  beforeEach(() => {
    registry = new ObserverRegistry();
    registry.register(mockObserver("eip155:1"));
  });

  it("restores a snapshot whose spent equals allocated (replay edge case)", () => {
    // Build an envelope fully spent. A direct-state restore must succeed.
    const vault = new Vault(CONFIG, registry);
    vault.createEnvelope("env", "Ops");
    vault.allocateToEnvelope("env", usdc("100.000000"));
    vault.declareIntent("i-1", "transfer", "spend all", { amount: usdc("100.000000") }, "env");
    vault.approveIntent("i-1");
    vault.markIntentExecuting("i-1");
    vault.recordIntentExecution("i-1", "eip155:1", "0xTx");

    const snap = vault.snapshot();
    expect(snap.envelopes[0]!.spent).toBe("100.000000");
    expect(snap.envelopes[0]!.available).toBe("0.000000");

    const restored = vault.restoreFromSnapshot(snap, registry);
    const budget = restored.getBudget();
    expect(budget.totalSpent).toBe("100.000000");
    expect(budget.totalAvailable).toBe("0.000000");
  });

  it("restores a snapshot whose ordering would break a replay (spent before alloc)", () => {
    // A hand-built snapshot where spent==allocated. A replay path that did
    // spend() before fully allocating would throw INSUFFICIENT_BUDGET; the
    // direct restore handles it because it sets terminal state.
    const env: Envelope = {
      id: "env",
      name: "Migrated",
      currency: "USDC",
      decimals: 6,
      allocated: "50.000000",
      spent: "50.000000",
      available: "0.000000",
      createdAt: new Date().toISOString(),
    };
    const snap: VaultSnapshot = {
      version: 1,
      config: CONFIG,
      envelopes: [env],
      intents: [],
      savedAt: new Date().toISOString(),
    };

    const vault = new Vault(CONFIG, registry);
    const restored = vault.restoreFromSnapshot(snap, registry);
    const budget = restored.getBudget();
    expect(budget.envelopes[0]!.allocated).toBe("50.000000");
    expect(budget.envelopes[0]!.spent).toBe("50.000000");
    expect(budget.envelopes[0]!.available).toBe("0.000000");
  });

  it("fails closed on a corrupt envelope (spent > allocated) without partial state", () => {
    const env: Envelope = {
      id: "bad",
      name: "Corrupt",
      currency: "USDC",
      decimals: 6,
      allocated: "10.000000",
      spent: "20.000000", // invariant violation
      available: "-10.000000",
      createdAt: new Date().toISOString(),
    };
    const snap: VaultSnapshot = {
      version: 1,
      config: CONFIG,
      envelopes: [env],
      intents: [],
      savedAt: new Date().toISOString(),
    };

    const vault = new Vault(CONFIG, registry);
    expect(() => vault.restoreFromSnapshot(snap, registry)).toThrow(VaultError);
    try {
      vault.restoreFromSnapshot(snap, registry);
    } catch (e) {
      expect((e as VaultError).code).toBe("RESTORE_INVALID");
      expect((e as VaultError).hint).toContain("allocated >= spent");
    }
  });

  it("rejects an unrecognised snapshot version with an actionable hint", () => {
    const snap = {
      version: 99,
      config: CONFIG,
      envelopes: [],
      intents: [],
      savedAt: new Date().toISOString(),
    } as unknown as VaultSnapshot;

    const vault = new Vault(CONFIG, registry);
    try {
      vault.restoreFromSnapshot(snap, registry);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(VaultError);
      expect((e as VaultError).code).toBe("UNSUPPORTED_SNAPSHOT_VERSION");
      expect((e as VaultError).hint).toContain("Migrate");
    }
  });

  it("emits a vault.restore telemetry event", () => {
    const vault = new Vault(CONFIG, registry);
    vault.createEnvelope("env", "Ops");
    vault.allocateToEnvelope("env", usdc("5.000000"));
    const snap = vault.snapshot();

    const sink = captureSink();
    vault.restoreFromSnapshot(snap, registry, sink.telemetry);

    const evt = sink.events.find((e) => e.op === "vault.restore");
    expect(evt).toBeDefined();
    expect(evt!.outcome).toBe("ok");
    expect(evt!.attributes).toMatchObject({ envelopeCount: 1, snapshotVersion: 1 });
  });
});

// =============================================================================
// PB-VT-004 — import guards
// =============================================================================

describe("import* fail closed (PB-VT-004)", () => {
  it("rejects importIntents into a non-empty manager", () => {
    const budget = new BudgetEngine("o", "USDC", 6);
    const intents = new IntentManager(budget);
    intents.declare("i-1", "transfer", "d", "o", {});
    expect(() => intents.importIntents([])).toThrow(IntentError);
    try {
      intents.importIntents([]);
    } catch (e) {
      expect((e as IntentError).code).toBe("IMPORT_NOT_EMPTY");
    }
  });

  it("rejects a duplicate intent id within the import batch", () => {
    const budget = new BudgetEngine("o", "USDC", 6);
    const intents = new IntentManager(budget);
    const stub = {
      id: "dup",
      status: "declared" as const,
      kind: "transfer" as const,
      description: "d",
      declaredBy: "o",
      declaredAt: new Date().toISOString(),
      params: {},
    };
    expect(() => intents.importIntents([stub, { ...stub }])).toThrow(/Duplicate/);
  });

  it("restoreEnvelope rejects a duplicate envelope id", () => {
    const budget = new BudgetEngine("o", "USDC", 6);
    budget.createEnvelope("env", "Ops");
    const env: Envelope = {
      id: "env",
      name: "Ops",
      currency: "USDC",
      decimals: 6,
      allocated: "0",
      spent: "0",
      available: "0",
      createdAt: new Date().toISOString(),
    };
    expect(() => budget.restoreEnvelope(env)).toThrow(BudgetError);
  });
});

// =============================================================================
// PB-VT-005 — rejection-path telemetry
// =============================================================================

describe("rejection-path telemetry (PB-VT-005)", () => {
  it("emits budget.rejected when a spend exceeds available", () => {
    const sink = captureSink();
    const budget = new BudgetEngine("o", "USDC", 6, sink.telemetry);
    budget.createEnvelope("env", "Ops");
    budget.allocate("env", usdc("10.000000"));

    expect(() => budget.spend("env", usdc("20.000000"))).toThrow(BudgetError);
    const evt = sink.events.find((e) => e.op === "budget.rejected");
    expect(evt).toBeDefined();
    expect(evt!.outcome).toBe("degraded");
    expect(evt!.attributes).toEqual({ reason: "INSUFFICIENT_BUDGET" });
  });

  it("emits intent.declare degraded when a declare exceeds the envelope budget", () => {
    const sink = captureSink();
    const budget = new BudgetEngine("o", "USDC", 6, sink.telemetry);
    const intents = new IntentManager(budget, sink.telemetry);
    budget.createEnvelope("env", "Ops");
    budget.allocate("env", usdc("5.000000"));

    expect(() =>
      intents.declare("i-1", "transfer", "too big", "o", { amount: usdc("10.000000") }, "env"),
    ).toThrow(IntentError);
    const evt = sink.events.find(
      (e) => e.op === "intent.declare" && e.attributes?.reason === "BUDGET_EXCEEDED",
    );
    expect(evt).toBeDefined();
    expect(evt!.outcome).toBe("degraded");
  });

  it("emits a degraded intent.transition on an invalid transition", () => {
    const sink = captureSink();
    const budget = new BudgetEngine("o", "USDC", 6, sink.telemetry);
    const intents = new IntentManager(budget, sink.telemetry);
    intents.declare("i-1", "transfer", "d", "o", {});
    // declared -> executed is invalid (must be approved first).
    expect(() => intents.markExecuting("i-1")).toThrow(IntentError);
    const evt = sink.events.find(
      (e) =>
        e.op === "intent.transition" && e.attributes?.reason === "INVALID_TRANSITION",
    );
    expect(evt).toBeDefined();
    expect(evt!.outcome).toBe("degraded");
  });
});
