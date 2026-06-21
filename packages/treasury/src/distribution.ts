/**
 * Distribution Engine — DAO & Org distributions.
 *
 * Computes and executes distributions from a funding pool:
 * - Proportional: split by basis points (1/10000th)
 * - Fixed: each recipient gets a fixed amount
 * - Milestone: recipients only receive if milestone is met
 *
 * Rules:
 * - Total proportional shares must be ≤ 10000 basis points
 * - Fixed amounts cannot exceed the pool
 * - Milestone payouts go to a remainder if not met
 * - All arithmetic is bigint via @attestia/ledger money-math
 */

import {
  addMoney,
  subtractMoney,
  zeroMoney,
  isNegative,
  isPositive,
  Ledger,
  parseAmount,
  formatAmount,
  validateMoney,
} from "@attestia/ledger";
import type { Money, Currency, LedgerEntry, Telemetry } from "@attestia/types";
import { NOOP_TELEMETRY } from "@attestia/types";
import type {
  DistributionPlan,
  DistributionRecipient,
  DistributionResult,
  DistributionPayout,
  DistributionStatus,
  DistributionStrategy,
} from "./types.js";

// =============================================================================
// Error
// =============================================================================

export class DistributionError extends Error {
  public readonly code: DistributionErrorCode;
  constructor(code: DistributionErrorCode, message: string) {
    super(message);
    this.name = "DistributionError";
    this.code = code;
  }
}

export type DistributionErrorCode =
  | "PLAN_EXISTS"
  | "PLAN_NOT_FOUND"
  | "INVALID_TRANSITION"
  | "INVALID_SHARES"
  | "DUPLICATE_RECIPIENT"
  | "POOL_EXCEEDED"
  | "NO_RECIPIENTS";

// =============================================================================
// Distribution Engine
// =============================================================================

export class DistributionEngine {
  private readonly plans: Map<string, DistributionPlan> = new Map();
  private readonly currency: Currency;
  private readonly decimals: number;
  private readonly telemetry: Telemetry;

  /**
   * @param telemetry Optional observability sink (D4-B-001). Defaults to
   *   {@link NOOP_TELEMETRY}. Executing a distribution emits
   *   `distribution.execute` with a `{ recipientCount }` attribute; raw
   *   amounts/ids stay in `message`.
   */
  constructor(
    currency: Currency,
    decimals: number,
    telemetry: Telemetry = NOOP_TELEMETRY,
  ) {
    this.currency = currency;
    this.decimals = decimals;
    this.telemetry = telemetry;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Plan management
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Create a distribution plan.
   */
  createPlan(
    id: string,
    name: string,
    strategy: DistributionStrategy,
    pool: Money,
    recipients: readonly DistributionRecipient[],
  ): DistributionPlan {
    if (this.plans.has(id)) {
      throw new DistributionError("PLAN_EXISTS", `Plan '${id}' already exists`);
    }

    if (recipients.length === 0) {
      throw new DistributionError("NO_RECIPIENTS", `Plan '${id}' must have at least one recipient`);
    }

    // Reject duplicate payeeIds: on execute they collide on correlationId
    // (`distribution:${plan.id}:${payeeId}`) and would silently double-credit.
    const seen = new Set<string>();
    for (const r of recipients) {
      if (seen.has(r.payeeId)) {
        throw new DistributionError(
          "DUPLICATE_RECIPIENT",
          `Plan '${id}' has duplicate recipient payeeId '${r.payeeId}'`,
        );
      }
      seen.add(r.payeeId);
    }

    // Validate every individual share before it flows into BigInt(share) and
    // bigint arithmetic during resolution. A fractional value throws an opaque
    // RangeError in BigInt(); a negative mints a negative payout; NaN/Infinity
    // corrupt the math. For proportional/milestone, share is basis points and
    // must also be ≤ 10000.
    //
    // For "fixed", the payout is money, which must NEVER round-trip through a
    // JS number: numbers lose integer precision above 2^53, so
    // `String(9007199254740993)` silently yields "9007199254740992" while
    // Number.isInteger still passes. Callers should supply the decimal-string
    // `amount` (validated via @attestia/ledger). A legacy numeric `share` is
    // still accepted for small amounts, but is rejected above
    // Number.MAX_SAFE_INTEGER so silent precision loss is impossible.
    const boundShares = strategy === "proportional" || strategy === "milestone";
    for (const r of recipients) {
      if (strategy === "fixed") {
        // Prefer the exact decimal-string amount when present.
        if (r.amount !== undefined) {
          try {
            validateMoney(r.amount);
          } catch {
            throw new DistributionError(
              "INVALID_SHARES",
              `Recipient '${r.payeeId}' has an invalid fixed amount '${String(r.amount.amount)}'`,
            );
          }
          if (isNegative(r.amount)) {
            throw new DistributionError(
              "INVALID_SHARES",
              `Recipient '${r.payeeId}' has a negative fixed amount '${r.amount.amount}'`,
            );
          }
          continue; // amount governs; numeric share (if any) is ignored
        }
        // Fall back to the legacy numeric share — must be a safe integer.
        if (r.share === undefined || !Number.isInteger(r.share) || r.share < 0) {
          throw new DistributionError(
            "INVALID_SHARES",
            `Recipient '${r.payeeId}' has invalid share ${String(r.share)}: must be a non-negative integer (or supply a decimal-string amount)`,
          );
        }
        if (r.share > Number.MAX_SAFE_INTEGER) {
          throw new DistributionError(
            "INVALID_SHARES",
            `Recipient '${r.payeeId}' fixed share ${String(r.share)} exceeds Number.MAX_SAFE_INTEGER and would lose precision: supply a decimal-string 'amount' instead`,
          );
        }
        continue;
      }

      // proportional / milestone: share is required basis points.
      if (r.share === undefined || !Number.isInteger(r.share) || r.share < 0) {
        throw new DistributionError(
          "INVALID_SHARES",
          `Recipient '${r.payeeId}' has invalid share ${String(r.share)}: must be a non-negative integer`,
        );
      }
      if (boundShares && r.share > 10000) {
        throw new DistributionError(
          "INVALID_SHARES",
          `Recipient '${r.payeeId}' has invalid share ${String(r.share)}: basis points must not exceed 10000`,
        );
      }
    }

    // Validate proportional shares
    if (strategy === "proportional") {
      const totalShares = recipients.reduce((sum, r) => sum + (r.share ?? 0), 0);
      if (totalShares > 10000) {
        throw new DistributionError(
          "INVALID_SHARES",
          `Proportional shares total ${String(totalShares)} basis points, maximum is 10000`,
        );
      }
    }

    // Validate fixed amounts don't exceed pool
    if (strategy === "fixed") {
      let totalFixed = this.zero();
      for (const r of recipients) {
        totalFixed = addMoney(totalFixed, this.fixedAmountOf(r));
      }
      const check = subtractMoney(pool, totalFixed);
      if (isNegative(check)) {
        throw new DistributionError(
          "POOL_EXCEEDED",
          `Fixed distribution amounts exceed pool of ${pool.amount}`,
        );
      }
    }

    const plan: DistributionPlan = {
      id,
      name,
      strategy,
      pool,
      recipients,
      status: "draft",
      createdAt: new Date().toISOString(),
    };

    this.plans.set(id, plan);
    return plan;
  }

  getPlan(id: string): DistributionPlan {
    const plan = this.plans.get(id);
    if (!plan) {
      throw new DistributionError("PLAN_NOT_FOUND", `Plan '${id}' not found`);
    }
    return plan;
  }

  listPlans(status?: DistributionStatus): readonly DistributionPlan[] {
    const all = [...this.plans.values()];
    return status ? all.filter((p) => p.status === status) : all;
  }

  /**
   * Approve a draft plan.
   */
  approvePlan(id: string): DistributionPlan {
    const plan = this.getPlan(id);
    if (plan.status !== "draft") {
      throw new DistributionError(
        "INVALID_TRANSITION",
        `Cannot approve plan '${id}' in status '${plan.status}'`,
      );
    }

    const approved: DistributionPlan = { ...plan, status: "approved" };
    this.plans.set(id, approved);
    return approved;
  }

  /**
   * Compute distribution payouts (without executing).
   * Returns the plan's resolved payouts and remainder.
   */
  computeDistribution(id: string): DistributionResult {
    const plan = this.getPlan(id);
    return this.resolvePayouts(plan);
  }

  /**
   * Execute a distribution, recording entries in the ledger.
   */
  executeDistribution(id: string, ledger: Ledger): DistributionResult {
    const plan = this.getPlan(id);
    if (plan.status !== "approved") {
      throw new DistributionError(
        "INVALID_TRANSITION",
        `Cannot execute plan '${id}' in status '${plan.status}'`,
      );
    }

    const result = this.resolvePayouts(plan);

    // Atomic execution (A-TREAS-002): the ledger rejects non-positive amounts
    // (Rule 6), so a zero/negative payout mid-loop used to throw after earlier
    // payouts were already committed — an unrecoverable partial distribution
    // that left the plan 'approved' and wedged retries on DUPLICATE_ENTRY_ID.
    //
    // Instead: drop zero payouts (a zero distribution is a no-op, not a ledger
    // write), reject any malformed/negative payout BEFORE touching the ledger,
    // then commit every debit/credit across all payouts in ONE balanced batch.
    // ledger.append validates and commits the whole batch atomically.
    const writable = result.payouts.filter((p) => !this.isZeroAmount(p.amount));
    for (const payout of writable) {
      validateMoney(payout.amount); // well-formed Money
      if (!isPositive(payout.amount)) {
        // Defence in depth — filter above removed zeros; a negative here is a
        // resolution bug. Fail closed before any write.
        throw new DistributionError(
          "INVALID_SHARES",
          `Payout for '${payout.payeeId}' is not strictly positive: '${payout.amount.amount}'`,
        );
      }
    }

    // Ensure the pool account exists (idempotent).
    const poolAccountId = `distribution:pool:${plan.id}`;
    if (!ledger.hasAccount(poolAccountId)) {
      ledger.registerAccount({
        id: poolAccountId,
        type: "asset",
        name: `Distribution Pool: ${plan.name}`,
      });
    }

    // One correlationId for the whole distribution: the ledger requires every
    // entry in a batch to share it (Rule 2), and it makes the distribution a
    // single recoverable transaction. Per-payee entry IDs stay unique.
    const corrId = `distribution:${plan.id}`;
    const now = new Date().toISOString();
    const entries: LedgerEntry[] = [];

    for (const payout of writable) {
      const recipientAccountId = `distribution:recipient:${payout.payeeId}`;
      if (!ledger.hasAccount(recipientAccountId)) {
        ledger.registerAccount({
          id: recipientAccountId,
          type: "liability",
          name: `Distribution Recipient: ${payout.payeeId}`,
        });
      }

      entries.push(
        {
          id: `${corrId}:${payout.payeeId}:debit`,
          accountId: poolAccountId,
          type: "debit",
          money: payout.amount,
          timestamp: now,
          correlationId: corrId,
        },
        {
          id: `${corrId}:${payout.payeeId}:credit`,
          accountId: recipientAccountId,
          type: "credit",
          money: payout.amount,
          timestamp: now,
          correlationId: corrId,
        },
      );
    }

    // Append the entire balanced batch atomically (skip a no-op empty append).
    if (entries.length > 0) {
      ledger.append(entries, {
        description: `Distribution: ${plan.name}`,
      });
    }

    const executed: DistributionPlan = {
      ...plan,
      status: "executed",
      executedAt: new Date().toISOString(),
    };
    this.plans.set(id, executed);

    // The result reflects what was actually written: zero payouts are dropped.
    const writtenResult: DistributionResult = {
      ...result,
      payouts: writable,
    };

    this.telemetry.record({
      package: "@attestia/treasury",
      op: "distribution.execute",
      level: "info",
      outcome: "ok",
      attributes: { recipientCount: writable.length },
      message: `distribution '${plan.id}' (${plan.strategy}) executed: ${result.totalDistributed.amount} ${result.totalDistributed.currency} to ${writable.length} recipient(s)`,
    });

    return writtenResult;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internal state access (for Treasury)
  // ─────────────────────────────────────────────────────────────────────

  exportPlans(): readonly DistributionPlan[] {
    return [...this.plans.values()];
  }

  importPlans(plans: readonly DistributionPlan[]): void {
    for (const p of plans) {
      this.plans.set(p.id, p);
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Private
  // ───────────────────────────────────────────────────────────────────────

  private resolvePayouts(plan: DistributionPlan): DistributionResult {
    switch (plan.strategy) {
      case "proportional":
        return this.resolveProportional(plan);
      case "fixed":
        return this.resolveFixed(plan);
      case "milestone":
        return this.resolveMilestone(plan);
    }
  }

  private resolveProportional(plan: DistributionPlan): DistributionResult {
    const poolAmount = parseAmount(plan.pool.amount, plan.pool.decimals);
    const payouts: DistributionPayout[] = [];
    let totalDistributed = this.zero();

    for (const recipient of plan.recipients) {
      // share is in basis points (1/10000th)
      const payoutAmount = (poolAmount * BigInt(recipient.share ?? 0)) / 10000n;
      const amount: Money = {
        amount: formatAmount(payoutAmount, this.decimals),
        currency: this.currency,
        decimals: this.decimals,
      };

      payouts.push({ payeeId: recipient.payeeId, amount });
      totalDistributed = addMoney(totalDistributed, amount);
    }

    const remainder = subtractMoney(plan.pool, totalDistributed);

    return { planId: plan.id, payouts, totalDistributed, remainder };
  }

  private resolveFixed(plan: DistributionPlan): DistributionResult {
    const payouts: DistributionPayout[] = [];
    let totalDistributed = this.zero();

    for (const recipient of plan.recipients) {
      // Prefer the exact decimal-string amount; fall back to the numeric share.
      // Normalize through addMoney so amount gets formatted consistently.
      const amount = addMoney(this.zero(), this.fixedAmountOf(recipient));

      payouts.push({ payeeId: recipient.payeeId, amount });
      totalDistributed = addMoney(totalDistributed, amount);
    }

    const remainder = subtractMoney(plan.pool, totalDistributed);

    return { planId: plan.id, payouts, totalDistributed, remainder };
  }

  private resolveMilestone(plan: DistributionPlan): DistributionResult {
    const poolAmount = parseAmount(plan.pool.amount, plan.pool.decimals);
    const payouts: DistributionPayout[] = [];
    let totalDistributed = this.zero();

    // Only pay recipients who met their milestone
    const eligible = plan.recipients.filter((r) => r.milestoneMet === true);
    const totalShares = eligible.reduce((sum, r) => sum + (r.share ?? 0), 0);

    for (const recipient of eligible) {
      // Proportional among milestone-met recipients
      const payoutAmount = totalShares > 0
        ? (poolAmount * BigInt(recipient.share ?? 0)) / BigInt(totalShares)
        : 0n;
      const amount: Money = {
        amount: formatAmount(payoutAmount, this.decimals),
        currency: this.currency,
        decimals: this.decimals,
      };

      payouts.push({ payeeId: recipient.payeeId, amount });
      totalDistributed = addMoney(totalDistributed, amount);
    }

    const remainder = subtractMoney(plan.pool, totalDistributed);

    return { planId: plan.id, payouts, totalDistributed, remainder };
  }

  /**
   * Resolve the fixed payout amount for a recipient. Prefers the exact
   * decimal-string {@link DistributionRecipient.amount} (precision-safe for
   * large amounts); falls back to the legacy numeric `share` for small,
   * already-validated values. Validation in {@link createPlan} guarantees one
   * of the two is present and well-formed.
   */
  private fixedAmountOf(recipient: DistributionRecipient): Money {
    if (recipient.amount !== undefined) {
      return {
        amount: recipient.amount.amount,
        currency: this.currency,
        decimals: this.decimals,
      };
    }
    return {
      amount: String(recipient.share ?? 0),
      currency: this.currency,
      decimals: this.decimals,
    };
  }

  /** True when a Money value parses to exactly zero. */
  private isZeroAmount(money: Money): boolean {
    return parseAmount(money.amount, money.decimals) === 0n;
  }

  private zero(): Money {
    return zeroMoney(this.currency, this.decimals);
  }
}
