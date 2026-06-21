/**
 * Budget Engine — Envelope-based budgeting.
 *
 * Manages a set of budget envelopes, each tracking:
 * - Allocated amount (how much is budgeted)
 * - Spent amount (how much has been consumed by executed intents)
 * - Available amount (allocated - spent)
 *
 * Evolved from NextLedger's envelope budgeting concept.
 *
 * Rules:
 * - All arithmetic uses bigint (via @attestia/ledger money-math)
 * - Envelopes are append-only updated (new state, old preserved)
 * - Spending requires sufficient available balance
 * - Single currency per envelope
 */

import {
  addMoney,
  subtractMoney,
  isPositive,
  isNegative,
  compareMoney,
} from "@attestia/ledger";
import type { Money, Currency, Telemetry } from "@attestia/types";
import { NOOP_TELEMETRY } from "@attestia/types";
import type { Envelope, BudgetSnapshot } from "./types.js";

// =============================================================================
// Error
// =============================================================================

export class BudgetError extends Error {
  public readonly code: BudgetErrorCode;
  constructor(code: BudgetErrorCode, message: string) {
    super(message);
    this.name = "BudgetError";
    this.code = code;
  }
}

export type BudgetErrorCode =
  | "ENVELOPE_EXISTS"
  | "ENVELOPE_NOT_FOUND"
  | "INSUFFICIENT_BUDGET"
  | "INVALID_AMOUNT"
  | "CURRENCY_MISMATCH"
  | "INVALID_ENVELOPE_STATE";

// =============================================================================
// Budget Engine
// =============================================================================

export class BudgetEngine {
  private readonly envelopes: Map<string, Envelope> = new Map();
  private readonly ownerId: string;
  private readonly currency: Currency;
  private readonly decimals: number;
  private readonly telemetry: Telemetry;

  /**
   * @param telemetry Optional observability sink (D4-B-001). Defaults to
   *   {@link NOOP_TELEMETRY}, so budgeting stays silent unless a host injects a
   *   sink. Raw amounts/ids go in event `message`, never `attributes`.
   */
  constructor(
    ownerId: string,
    currency: Currency,
    decimals: number,
    telemetry: Telemetry = NOOP_TELEMETRY,
  ) {
    this.ownerId = ownerId;
    this.currency = currency;
    this.decimals = decimals;
    this.telemetry = telemetry;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Envelope management
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Create a new budget envelope.
   */
  createEnvelope(
    id: string,
    name: string,
    category?: string,
  ): Envelope {
    if (this.envelopes.has(id)) {
      throw new BudgetError("ENVELOPE_EXISTS", `Envelope '${id}' already exists`);
    }

    const base = {
      id,
      name,
      currency: this.currency,
      decimals: this.decimals,
      allocated: "0",
      spent: "0",
      available: "0",
      createdAt: new Date().toISOString(),
    };
    const envelope: Envelope = category !== undefined
      ? { ...base, category }
      : base;

    this.envelopes.set(id, envelope);
    return envelope;
  }

  /**
   * Get an envelope by ID.
   */
  getEnvelope(id: string): Envelope {
    const envelope = this.envelopes.get(id);
    if (!envelope) {
      throw new BudgetError("ENVELOPE_NOT_FOUND", `Envelope '${id}' not found`);
    }
    return envelope;
  }

  /**
   * Check if an envelope exists.
   */
  hasEnvelope(id: string): boolean {
    return this.envelopes.has(id);
  }

  /**
   * List all envelopes.
   */
  listEnvelopes(): readonly Envelope[] {
    return [...this.envelopes.values()];
  }

  /**
   * Get envelopes by category.
   */
  getByCategory(category: string): readonly Envelope[] {
    return [...this.envelopes.values()].filter(
      (e) => e.category === category,
    );
  }

  // ───────────────────────────────────────────────────────────────────────
  // Budget operations
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Allocate funds to an envelope (increase the budget).
   */
  allocate(envelopeId: string, amount: Money): Envelope {
    const envelope = this.getEnvelope(envelopeId);
    this.assertCurrency(amount);
    this.assertPositive(amount);

    const newAllocated = this.add(envelope.allocated, amount.amount);
    const newAvailable = this.subtract(newAllocated, envelope.spent);

    const updated: Envelope = {
      ...envelope,
      allocated: newAllocated,
      available: newAvailable,
    };

    this.envelopes.set(envelopeId, updated);
    return updated;
  }

  /**
   * Deallocate funds from an envelope (decrease the budget).
   * Cannot deallocate below what has been spent.
   */
  deallocate(envelopeId: string, amount: Money): Envelope {
    const envelope = this.getEnvelope(envelopeId);
    this.assertCurrency(amount);
    this.assertPositive(amount);

    const newAllocated = this.subtract(envelope.allocated, amount.amount);
    const newAvailable = this.subtract(newAllocated, envelope.spent);

    // Check that deallocating doesn't go below spent
    const availableMoney: Money = {
      amount: newAvailable,
      currency: this.currency,
      decimals: this.decimals,
    };
    if (isNegative(availableMoney)) {
      throw new BudgetError(
        "INSUFFICIENT_BUDGET",
        `Cannot deallocate ${amount.amount} from '${envelopeId}': would go below spent amount (${envelope.spent})`,
      );
    }

    const updated: Envelope = {
      ...envelope,
      allocated: newAllocated,
      available: newAvailable,
    };

    this.envelopes.set(envelopeId, updated);
    return updated;
  }

  /**
   * Record spending from an envelope (triggered by executed intents).
   * Fails if insufficient available balance.
   */
  spend(envelopeId: string, amount: Money): Envelope {
    const envelope = this.getEnvelope(envelopeId);
    this.assertCurrency(amount);
    this.assertPositive(amount);

    // Check sufficient available
    const available: Money = {
      amount: envelope.available,
      currency: this.currency,
      decimals: this.decimals,
    };
    if (compareMoney(amount, available) > 0) {
      // Limit pressure is operationally interesting — surface it before throwing
      // so repeated budget-ceiling hits are visible to monitoring, not silent.
      // The reason is a low-cardinality enum; raw id/amounts stay in `message`.
      this.telemetry.record({
        package: "@attestia/vault",
        op: "budget.rejected",
        level: "warn",
        outcome: "degraded",
        attributes: { reason: "INSUFFICIENT_BUDGET" },
        message: `spend rejected on envelope '${envelopeId}': need ${amount.amount} ${amount.currency}, available ${envelope.available}`,
      });
      throw new BudgetError(
        "INSUFFICIENT_BUDGET",
        `Insufficient budget in '${envelopeId}': need ${amount.amount}, available ${envelope.available}`,
      );
    }

    const newSpent = this.add(envelope.spent, amount.amount);
    const newAvailable = this.subtract(envelope.allocated, newSpent);

    const updated: Envelope = {
      ...envelope,
      spent: newSpent,
      available: newAvailable,
    };

    this.envelopes.set(envelopeId, updated);

    // Raw envelope id + amount live in `message` (high-cardinality); attributes
    // stay empty to remain metric-safe.
    this.telemetry.record({
      package: "@attestia/vault",
      op: "budget.spend",
      level: "info",
      outcome: "ok",
      message: `spent ${amount.amount} ${amount.currency} from envelope '${envelopeId}' (available ${newAvailable})`,
    });

    return updated;
  }

  /**
   * Reverse a spend (e.g., when an intent fails or is refunded).
   *
   * Fails closed if {@link amount} exceeds the envelope's recorded `spent`:
   * over-reversing (e.g. double failure-handling on the same intent) would
   * drive `spent` negative and inflate `available` beyond `allocated`,
   * corrupting the envelope. You can never un-spend more than was spent.
   */
  reverseSpend(envelopeId: string, amount: Money): Envelope {
    const envelope = this.getEnvelope(envelopeId);
    this.assertCurrency(amount);
    this.assertPositive(amount);

    // Floor at zero: cannot reverse more than has been spent.
    const spent: Money = {
      amount: envelope.spent,
      currency: this.currency,
      decimals: this.decimals,
    };
    if (compareMoney(amount, spent) > 0) {
      throw new BudgetError(
        "INVALID_AMOUNT",
        `Cannot reverse ${amount.amount} from '${envelopeId}': exceeds spent amount (${envelope.spent})`,
      );
    }

    const newSpent = this.subtract(envelope.spent, amount.amount);
    const newAvailable = this.subtract(envelope.allocated, newSpent);

    const updated: Envelope = {
      ...envelope,
      spent: newSpent,
      available: newAvailable,
    };

    this.envelopes.set(envelopeId, updated);

    this.telemetry.record({
      package: "@attestia/vault",
      op: "budget.reverse",
      level: "info",
      outcome: "ok",
      message: `reversed ${amount.amount} ${amount.currency} on envelope '${envelopeId}' (available ${newAvailable})`,
    });

    return updated;
  }

  /**
   * Restore an envelope's committed state DIRECTLY, without replaying
   * allocate()/spend() against the live guards.
   *
   * Replaying spend() during restore is fragile: a valid snapshot whose
   * `spent` happens to exceed the `available` the guard computes mid-replay
   * (e.g. ordering differences, a future flooring change, or migrated data)
   * would throw INSUFFICIENT_BUDGET and abort the whole restore, leaving a
   * half-built vault. Instead we set the terminal `allocated`/`spent` fields
   * and recompute `available = allocated - spent` so any consistent snapshot
   * restores deterministically.
   *
   * We still fail CLOSED on a genuinely inconsistent envelope: `allocated`
   * and `spent` must be non-negative and `spent` must not exceed `allocated`
   * (that would imply a negative balance, which the spend/deallocate guards
   * make impossible in live operation). Such an envelope is corruption, not a
   * valid backup, and is rejected with INVALID_ENVELOPE_STATE before any
   * mutation so the engine is never left partially populated.
   */
  restoreEnvelope(env: Envelope): Envelope {
    if (this.envelopes.has(env.id)) {
      throw new BudgetError(
        "ENVELOPE_EXISTS",
        `Envelope '${env.id}' already exists`,
      );
    }

    const allocated: Money = {
      amount: env.allocated,
      currency: this.currency,
      decimals: this.decimals,
    };
    const spent: Money = {
      amount: env.spent,
      currency: this.currency,
      decimals: this.decimals,
    };

    if (isNegative(allocated)) {
      throw new BudgetError(
        "INVALID_ENVELOPE_STATE",
        `Cannot restore envelope '${env.id}': allocated '${env.allocated}' is negative`,
      );
    }
    if (isNegative(spent)) {
      throw new BudgetError(
        "INVALID_ENVELOPE_STATE",
        `Cannot restore envelope '${env.id}': spent '${env.spent}' is negative`,
      );
    }
    // spent must not exceed allocated → available would be negative.
    if (compareMoney(spent, allocated) > 0) {
      throw new BudgetError(
        "INVALID_ENVELOPE_STATE",
        `Cannot restore envelope '${env.id}': spent '${env.spent}' exceeds allocated '${env.allocated}' (would yield a negative balance)`,
      );
    }

    const available = this.subtract(env.allocated, env.spent);
    const restored: Envelope = {
      ...env,
      currency: this.currency,
      decimals: this.decimals,
      allocated: env.allocated,
      spent: env.spent,
      available,
    };

    this.envelopes.set(env.id, restored);
    return restored;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Snapshot
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Take a budget snapshot (for reporting or persistence).
   */
  snapshot(): BudgetSnapshot {
    const envelopes = this.listEnvelopes();

    let totalAllocated = "0";
    let totalSpent = "0";
    let totalAvailable = "0";

    for (const e of envelopes) {
      totalAllocated = this.add(totalAllocated, e.allocated);
      totalSpent = this.add(totalSpent, e.spent);
      totalAvailable = this.add(totalAvailable, e.available);
    }

    return {
      ownerId: this.ownerId,
      envelopes,
      totalAllocated,
      totalSpent,
      totalAvailable,
      currency: this.currency,
      asOf: new Date().toISOString(),
    };
  }

  /**
   * Restore from a snapshot. An optional telemetry sink can be re-attached to
   * the restored engine (snapshots carry no sink — it is a runtime concern).
   */
  static fromSnapshot(
    snapshot: BudgetSnapshot,
    telemetry: Telemetry = NOOP_TELEMETRY,
  ): BudgetEngine {
    const engine = new BudgetEngine(
      snapshot.ownerId,
      snapshot.currency,
      snapshot.envelopes[0]?.decimals ?? 6,
      telemetry,
    );

    for (const env of snapshot.envelopes) {
      engine.envelopes.set(env.id, env);
    }

    return engine;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Private helpers
  // ───────────────────────────────────────────────────────────────────────

  private add(a: string, b: string): string {
    const result = addMoney(
      { amount: a, currency: this.currency, decimals: this.decimals },
      { amount: b, currency: this.currency, decimals: this.decimals },
    );
    return result.amount;
  }

  private subtract(a: string, b: string): string {
    const result = subtractMoney(
      { amount: a, currency: this.currency, decimals: this.decimals },
      { amount: b, currency: this.currency, decimals: this.decimals },
    );
    return result.amount;
  }

  private assertCurrency(amount: Money): void {
    if (amount.currency !== this.currency) {
      throw new BudgetError(
        "CURRENCY_MISMATCH",
        `Expected currency '${this.currency}', got '${amount.currency}'`,
      );
    }
  }

  private assertPositive(amount: Money): void {
    if (!isPositive(amount)) {
      throw new BudgetError(
        "INVALID_AMOUNT",
        `Amount must be positive, got '${amount.amount}'`,
      );
    }
  }
}
