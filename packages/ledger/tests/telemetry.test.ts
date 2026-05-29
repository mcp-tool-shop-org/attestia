/**
 * Tests for the optional observability sink on the Ledger (D2-B-001).
 *
 * Verifies:
 * - A capturing Telemetry sees an "append" event with entryCount on success.
 * - A "trialBalance" failed event is emitted when the trial balance is
 *   unbalanced (corruption), and the original LedgerError still propagates.
 * - The default (no sink injected) emits nothing and behaves identically.
 * - A throwing sink never breaks a ledger operation.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type {
  AccountRef,
  LedgerEntry,
  Money,
  ObservabilityEvent,
  Telemetry,
} from "@attestia/types";
import { Ledger } from "../src/ledger.js";
import { LedgerError } from "../src/types.js";

// ─── Fixtures ────────────────────────────────────────────────────────────

const TS = "2024-01-15T10:00:00.000Z";
const CASH: AccountRef = { id: "cash", type: "asset", name: "Cash" };
const REVENUE: AccountRef = { id: "revenue", type: "income", name: "Revenue" };

function usdc(amount: string): Money {
  return { amount, currency: "USDC", decimals: 6 };
}

function makeEntry(
  id: string,
  accountId: string,
  type: "debit" | "credit",
  money: Money,
  correlationId: string,
): LedgerEntry {
  return { id, accountId, type, money, timestamp: TS, correlationId };
}

/** A Telemetry that records every event for assertion. */
class CapturingTelemetry implements Telemetry {
  readonly events: ObservabilityEvent[] = [];
  record(event: ObservabilityEvent): void {
    this.events.push(event);
  }
  byOp(op: string): ObservabilityEvent[] {
    return this.events.filter((e) => e.op === op);
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("Ledger telemetry (D2-B-001)", () => {
  let telemetry: CapturingTelemetry;
  let ledger: Ledger;

  beforeEach(() => {
    telemetry = new CapturingTelemetry();
    ledger = new Ledger({ telemetry });
    ledger.registerAccount(CASH, TS);
    ledger.registerAccount(REVENUE, TS);
  });

  it("emits an append event with entryCount and ok outcome", () => {
    ledger.append([
      makeEntry("e1", "cash", "debit", usdc("100.000000"), "tx1"),
      makeEntry("e2", "revenue", "credit", usdc("100.000000"), "tx1"),
    ]);

    const appends = telemetry.byOp("append");
    expect(appends).toHaveLength(1);
    const ev = appends[0]!;
    expect(ev.package).toBe("@attestia/ledger");
    expect(ev.outcome).toBe("ok");
    expect(ev.level).toBe("info");
    expect(ev.attributes?.entryCount).toBe(2);
    expect(typeof ev.durationMs).toBe("number");
  });

  it("does not emit on a failed (unbalanced) append", () => {
    expect(() =>
      ledger.append([
        makeEntry("e1", "cash", "debit", usdc("100.000000"), "tx1"),
        makeEntry("e2", "revenue", "credit", usdc("99.000000"), "tx1"),
      ]),
    ).toThrow(LedgerError);

    // A rejected transaction is not a committed append — nothing recorded.
    expect(telemetry.byOp("append")).toHaveLength(0);
  });

  it("emits a trialBalance failed event when state is corrupt, then rethrows", () => {
    // Inject a corrupt, unbalanced entry directly into private state to simulate
    // tampering/partial-write. A self-consistent ledger could never reach this.
    const corrupt = makeEntry("bad", "cash", "debit", usdc("50.000000"), "corruptTx");
    (ledger as unknown as { _entries: LedgerEntry[] })._entries.push(corrupt);

    expect(() => ledger.getTrialBalance(TS)).toThrow(LedgerError);

    const failures = telemetry.byOp("trialBalance");
    expect(failures).toHaveLength(1);
    const ev = failures[0]!;
    expect(ev.package).toBe("@attestia/ledger");
    expect(ev.outcome).toBe("failed");
    expect(ev.level).toBe("error");
    expect(ev.attributes?.code).toBe("UNBALANCED_TRANSACTION");
  });

  it("emits nothing on a balanced getTrialBalance", () => {
    ledger.append([
      makeEntry("e1", "cash", "debit", usdc("100.000000"), "tx1"),
      makeEntry("e2", "revenue", "credit", usdc("100.000000"), "tx1"),
    ]);
    telemetry.events.length = 0;

    const tb = ledger.getTrialBalance(TS);
    expect(tb.balanced).toBe(true);
    expect(telemetry.byOp("trialBalance")).toHaveLength(0);
  });

  it("defaults to a silent no-op sink when none is injected", () => {
    const silent = new Ledger();
    silent.registerAccount(CASH, TS);
    silent.registerAccount(REVENUE, TS);

    // Must not throw and must behave identically.
    const result = silent.append([
      makeEntry("e1", "cash", "debit", usdc("10.000000"), "tx1"),
      makeEntry("e2", "revenue", "credit", usdc("10.000000"), "tx1"),
    ]);
    expect(result.entryCount).toBe(2);
  });

  it("a throwing sink never breaks the operation", () => {
    const hostile: Telemetry = {
      record() {
        throw new Error("sink exploded");
      },
    };
    const guarded = new Ledger({ telemetry: hostile });
    guarded.registerAccount(CASH, TS);
    guarded.registerAccount(REVENUE, TS);

    const result = guarded.append([
      makeEntry("e1", "cash", "debit", usdc("10.000000"), "tx1"),
      makeEntry("e2", "revenue", "credit", usdc("10.000000"), "tx1"),
    ]);
    expect(result.entryCount).toBe(2);
  });
});
