/**
 * Reconciler integration tests
 *
 * Tests the top-level Reconciler coordinating all matchers + attestor.
 */
import { describe, it, expect } from "vitest";
import { StructuralRegistrar } from "@attestia/registrum";
import { Reconciler } from "../src/reconciler.js";
import type {
  ReconcilableIntent,
  ReconcilableLedgerEntry,
  ReconcilableChainEvent,
} from "../src/types.js";

function usdc(amount: string): { amount: string; currency: string; decimals: number } {
  return { amount, currency: "USDC", decimals: 6 };
}

describe("Reconciler", () => {
  describe("full reconciliation", () => {
    it("produces a clean report when all records match", () => {
      const reconciler = new Reconciler();

      const intents: ReconcilableIntent[] = [
        {
          id: "intent-1",
          status: "executed",
          kind: "transfer",
          amount: usdc("100.000000"),
          chainId: "eth:1",
          txHash: "0xtx1",
          declaredAt: "2024-01-01T00:00:00Z",
          correlationId: "corr-1",
        },
      ];
      const entries: ReconcilableLedgerEntry[] = [
        {
          id: "entry-1",
          accountId: "expense",
          type: "debit",
          money: usdc("100.000000"),
          timestamp: "2024-01-01T00:00:01Z",
          intentId: "intent-1",
          txHash: "0xtx1",
          correlationId: "corr-1",
        },
        {
          id: "entry-2",
          accountId: "cash",
          type: "credit",
          money: usdc("100.000000"),
          timestamp: "2024-01-01T00:00:01Z",
          intentId: "intent-1",
          txHash: "0xtx1",
          correlationId: "corr-1",
        },
      ];
      const events: ReconcilableChainEvent[] = [
        {
          chainId: "eth:1",
          txHash: "0xtx1",
          from: "0xsender",
          to: "0xreceiver",
          amount: "100000000",
          decimals: 6,
          symbol: "USDC",
          timestamp: "2024-01-01T00:00:01Z",
        },
      ];

      const report = reconciler.reconcile({ intents, ledgerEntries: entries, chainEvents: events });

      expect(report.summary.allReconciled).toBe(true);
      expect(report.summary.matchedCount).toBeGreaterThan(0);
      expect(report.summary.mismatchCount).toBe(0);
      expect(report.summary.missingCount).toBe(0);
      expect(report.summary.totalIntents).toBe(1);
      expect(report.summary.totalLedgerEntries).toBe(2);
      expect(report.summary.totalChainEvents).toBe(1);
    });

    it("detects mismatches across all dimensions", () => {
      const reconciler = new Reconciler();

      const intents: ReconcilableIntent[] = [
        {
          id: "intent-bad",
          status: "executed",
          kind: "transfer",
          amount: usdc("100.000000"),
          txHash: "0xbad",
          declaredAt: "2024-01-01T00:00:00Z",
        },
      ];
      const entries: ReconcilableLedgerEntry[] = [
        {
          id: "entry-bad",
          accountId: "expense",
          type: "debit",
          money: usdc("90.000000"), // Mismatch with intent
          timestamp: "2024-01-01T00:00:01Z",
          intentId: "intent-bad",
          txHash: "0xbad",
          correlationId: "corr-bad",
        },
      ];
      const events: ReconcilableChainEvent[] = [
        {
          chainId: "eth:1",
          txHash: "0xbad",
          from: "0xsender",
          to: "0xreceiver",
          amount: "80000000", // 80 USDC — different from both
          decimals: 6,
          symbol: "USDC",
          timestamp: "2024-01-01T00:00:01Z",
        },
      ];

      const report = reconciler.reconcile({ intents, ledgerEntries: entries, chainEvents: events });

      expect(report.summary.allReconciled).toBe(false);
      expect(report.summary.mismatchCount).toBeGreaterThan(0);
      expect(report.summary.discrepancies.length).toBeGreaterThan(0);
    });

    it("handles empty inputs gracefully", () => {
      const reconciler = new Reconciler();
      const report = reconciler.reconcile({
        intents: [],
        ledgerEntries: [],
        chainEvents: [],
      });

      expect(report.summary.allReconciled).toBe(true);
      expect(report.summary.totalIntents).toBe(0);
      expect(report.summary.totalLedgerEntries).toBe(0);
      expect(report.summary.totalChainEvents).toBe(0);
    });
  });

  describe("scope filtering", () => {
    it("filters by intentId", () => {
      const reconciler = new Reconciler();
      const intents: ReconcilableIntent[] = [
        {
          id: "i-a",
          status: "executed",
          kind: "transfer",
          amount: usdc("100.000000"),
          txHash: "0xa",
          declaredAt: "2024-01-01T00:00:00Z",
        },
        {
          id: "i-b",
          status: "executed",
          kind: "transfer",
          amount: usdc("200.000000"),
          txHash: "0xb",
          declaredAt: "2024-01-01T00:00:00Z",
        },
      ];

      const report = reconciler.reconcile({
        intents,
        ledgerEntries: [],
        chainEvents: [],
        scope: { intentId: "i-a" },
      });

      // Only intent i-a is in scope — i-b should be excluded
      expect(report.summary.totalIntents).toBe(1);
    });

    it("filters by time range", () => {
      const reconciler = new Reconciler();
      const intents: ReconcilableIntent[] = [
        {
          id: "i-early",
          status: "executed",
          kind: "transfer",
          declaredAt: "2024-01-01T00:00:00Z",
        },
        {
          id: "i-late",
          status: "executed",
          kind: "transfer",
          declaredAt: "2024-06-01T00:00:00Z",
        },
      ];

      const report = reconciler.reconcile({
        intents,
        ledgerEntries: [],
        chainEvents: [],
        scope: { from: "2024-03-01T00:00:00Z" },
      });

      expect(report.summary.totalIntents).toBe(1);
    });
  });

  describe("attestation", () => {
    it("attests a reconciliation report through Registrum", async () => {
      const registrar = new StructuralRegistrar({ mode: "legacy" });
      const reconciler = new Reconciler({
        registrar,
        attestorId: "reconciler-1",
      });

      const report = reconciler.reconcile({
        intents: [],
        ledgerEntries: [],
        chainEvents: [],
      });

      const attestation = await reconciler.attest(report);
      expect(attestation.allReconciled).toBe(true);
      expect(attestation.attestedBy).toBe("reconciler-1");
      expect(attestation.reportHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("reconcileAndAttest does both in one call", async () => {
      const registrar = new StructuralRegistrar({ mode: "legacy" });
      const reconciler = new Reconciler({
        registrar,
        attestorId: "reconciler-1",
      });

      const { report, attestation } = await reconciler.reconcileAndAttest({
        intents: [],
        ledgerEntries: [],
        chainEvents: [],
      });

      expect(report.summary.allReconciled).toBe(true);
      expect(attestation.reconciliationId).toBe(report.id);
    });

    it("throws when attesting without registrar", async () => {
      const reconciler = new Reconciler();
      const report = reconciler.reconcile({
        intents: [],
        ledgerEntries: [],
        chainEvents: [],
      });

      await expect(reconciler.attest(report)).rejects.toThrow(/no registrar/i);
    });

    it("requires attestorId when registrar is provided", () => {
      const registrar = new StructuralRegistrar({ mode: "legacy" });
      expect(() => new Reconciler({ registrar })).toThrow(/attestorId/i);
    });
  });

  describe("report structure", () => {
    it("includes report id and timestamp", () => {
      const reconciler = new Reconciler();
      const report = reconciler.reconcile({
        intents: [],
        ledgerEntries: [],
        chainEvents: [],
      });

      expect(report.id).toMatch(/^recon:/);
      expect(report.timestamp).toBeTruthy();
      expect(report.scope).toEqual({});
    });
  });

  describe("deterministic attestation hash (D4-A-001)", () => {
    // The attestor SHA-256s the report for immutable-attestation replay
    // verification. Identical reconciliation inputs MUST produce an identical
    // reportHash so a later replay can prove the attestation was honest.
    // Volatile fields (id, timestamp) must therefore be excluded from the
    // integrity hash.
    const intents: ReconcilableIntent[] = [
      {
        id: "intent-det",
        status: "executed",
        kind: "transfer",
        amount: usdc("100.000000"),
        chainId: "eth:1",
        txHash: "0xdet",
        declaredAt: "2024-01-01T00:00:00Z",
        correlationId: "corr-det",
      },
    ];
    const entries: ReconcilableLedgerEntry[] = [
      {
        id: "entry-det",
        accountId: "expense",
        type: "debit",
        money: usdc("100.000000"),
        timestamp: "2024-01-01T00:00:01Z",
        intentId: "intent-det",
        txHash: "0xdet",
        correlationId: "corr-det",
      },
    ];
    const events: ReconcilableChainEvent[] = [
      {
        chainId: "eth:1",
        txHash: "0xdet",
        from: "0xsender",
        to: "0xreceiver",
        amount: "100000000",
        decimals: 6,
        symbol: "USDC",
        timestamp: "2024-01-01T00:00:01Z",
      },
    ];

    it("reconciling identical inputs twice yields the same reportHash", async () => {
      // Same reconciler reconciled twice: the per-run counter guarantees the
      // two report ids differ (:1 vs :2), so this deterministically proves
      // volatile metadata varies while the integrity hash stays constant.
      const registrar = new StructuralRegistrar({ mode: "legacy" });
      const reconciler = new Reconciler({ registrar, attestorId: "det-1" });

      const { report: reportA, attestation: attA } = await reconciler.reconcileAndAttest({
        intents,
        ledgerEntries: entries,
        chainEvents: events,
      });
      const { report: reportB, attestation: attB } = await reconciler.reconcileAndAttest({
        intents,
        ledgerEntries: entries,
        chainEvents: events,
      });

      // Volatile metadata differs run-to-run...
      expect(reportA.id).not.toBe(reportB.id);
      // ...but the integrity hash must be identical for identical content.
      expect(attA.reportHash).toBe(attB.reportHash);
      expect(attA.reportHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("changed content (a discrepancy) changes the reportHash", async () => {
      const registrarClean = new StructuralRegistrar({ mode: "legacy" });
      const reconcilerClean = new Reconciler({ registrar: registrarClean, attestorId: "det-clean" });

      const registrarDirty = new StructuralRegistrar({ mode: "legacy" });
      const reconcilerDirty = new Reconciler({ registrar: registrarDirty, attestorId: "det-dirty" });

      const { attestation: cleanAtt } = await reconcilerClean.reconcileAndAttest({
        intents,
        ledgerEntries: entries,
        chainEvents: events,
      });

      // Same intent, but ledger debit is short by 10 → amount-mismatch.
      const dirtyEntries: ReconcilableLedgerEntry[] = [
        { ...entries[0]!, money: usdc("90.000000") },
      ];
      const { attestation: dirtyAtt } = await reconcilerDirty.reconcileAndAttest({
        intents,
        ledgerEntries: dirtyEntries,
        chainEvents: events,
      });

      expect(cleanAtt.reportHash).not.toBe(dirtyAtt.reportHash);
    });
  });
});
