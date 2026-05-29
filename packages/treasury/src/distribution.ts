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
  Ledger,
  parseAmount,
  formatAmount,
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
    // must also be ≤ 10000. For fixed, share is an absolute amount (unbounded).
    const boundShares = strategy === "proportional" || strategy === "milestone";
    for (const r of recipients) {
      if (!Number.isInteger(r.share) || r.share < 0) {
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
      const totalShares = recipients.reduce((sum, r) => sum + r.share, 0);
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
        const amount: Money = {
          amount: String(r.share),
          currency: this.currency,
          decimals: this.decimals,
        };
        totalFixed = addMoney(totalFixed, amount);
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

    // Record ledger entries
    const poolAccountId = `distribution:pool:${plan.id}`;
    if (!ledger.hasAccount(poolAccountId)) {
      ledger.registerAccount({
        id: poolAccountId,
        type: "asset",
        name: `Distribution Pool: ${plan.name}`,
      });
    }

    for (const payout of result.payouts) {
      const recipientAccountId = `distribution:recipient:${payout.payeeId}`;
      if (!ledger.hasAccount(recipientAccountId)) {
        ledger.registerAccount({
          id: recipientAccountId,
          type: "liability",
          name: `Distribution Recipient: ${payout.payeeId}`,
        });
      }

      const now = new Date().toISOString();
      const corrId = `distribution:${plan.id}:${payout.payeeId}`;

      const entries: LedgerEntry[] = [
        {
          id: `${corrId}:debit`,
          accountId: poolAccountId,
          type: "debit",
          money: payout.amount,
          timestamp: now,
          correlationId: corrId,
        },
        {
          id: `${corrId}:credit`,
          accountId: recipientAccountId,
          type: "credit",
          money: payout.amount,
          timestamp: now,
          correlationId: corrId,
        },
      ];
      ledger.append(entries, {
        description: `Distribution: ${plan.name} - ${payout.payeeId}`,
      });
    }

    const executed: DistributionPlan = {
      ...plan,
      status: "executed",
      executedAt: new Date().toISOString(),
    };
    this.plans.set(id, executed);

    this.telemetry.record({
      package: "@attestia/treasury",
      op: "distribution.execute",
      level: "info",
      outcome: "ok",
      attributes: { recipientCount: result.payouts.length },
      message: `distribution '${plan.id}' (${plan.strategy}) executed: ${result.totalDistributed.amount} ${result.totalDistributed.currency} to ${result.payouts.length} recipient(s)`,
    });

    return result;
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
      const payoutAmount = (poolAmount * BigInt(recipient.share)) / 10000n;
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
      // share represents the fixed amount for "fixed" strategy
      const raw: Money = {
        amount: String(recipient.share),
        currency: this.currency,
        decimals: this.decimals,
      };
      // Normalize through addMoney so amount gets formatted consistently
      const amount = addMoney(this.zero(), raw);

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
    const totalShares = eligible.reduce((sum, r) => sum + r.share, 0);

    for (const recipient of eligible) {
      // Proportional among milestone-met recipients
      const payoutAmount = totalShares > 0
        ? (poolAmount * BigInt(recipient.share)) / BigInt(totalShares)
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

  private zero(): Money {
    return zeroMoney(this.currency, this.decimals);
  }
}
