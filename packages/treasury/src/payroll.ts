/**
 * Payroll Engine — Deterministic payroll computation.
 *
 * Given a schedule (payees + components), produces a PayrollRun:
 * - Sums all positive components as gross pay
 * - Sums all deductions
 * - Net pay = gross - deductions
 * - All arithmetic is bigint via @attestia/ledger money-math
 * - Results are deterministic: same schedule → same run
 *
 * Rules:
 * - Runs are immutable once created
 * - Only "draft" runs can be approved; only "approved" runs can be executed
 * - Execution records the run in the double-entry ledger
 */

import {
  addMoney,
  subtractMoney,
  zeroMoney,
  isPositive,
  validateMoney,
  Ledger,
} from "@attestia/ledger";
import type { Money, Currency, LedgerEntry, Telemetry } from "@attestia/types";
import { NOOP_TELEMETRY } from "@attestia/types";
import type {
  Payee,
  PayComponent,
  PayrollScheduleEntry,
  PayrollRun,
  PayrollRunStatus,
  PayrollEntry,
  ResolvedPayComponent,
  PayPeriod,
} from "./types.js";

// =============================================================================
// Error
// =============================================================================

export class PayrollError extends Error {
  public readonly code: PayrollErrorCode;
  constructor(code: PayrollErrorCode, message: string) {
    super(message);
    this.name = "PayrollError";
    this.code = code;
  }
}

export type PayrollErrorCode =
  | "PAYEE_EXISTS"
  | "PAYEE_NOT_FOUND"
  | "PAYEE_INACTIVE"
  | "RUN_EXISTS"
  | "RUN_NOT_FOUND"
  | "INVALID_TRANSITION"
  | "NO_COMPONENTS"
  | "INVALID_AMOUNT";

// =============================================================================
// Payroll Engine
// =============================================================================

export class PayrollEngine {
  private readonly payees: Map<string, Payee> = new Map();
  private readonly schedules: Map<string, PayrollScheduleEntry> = new Map();
  private readonly runs: Map<string, PayrollRun> = new Map();
  private readonly currency: Currency;
  private readonly decimals: number;
  private readonly telemetry: Telemetry;

  /**
   * @param telemetry Optional observability sink (D4-B-001). Defaults to
   *   {@link NOOP_TELEMETRY}. Executing a run emits `payroll.run` with a
   *   `{ recipientCount }` attribute; raw totals/ids stay in `message`.
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
  // Payee management
  // ───────────────────────────────────────────────────────────────────────

  registerPayee(
    id: string,
    name: string,
    address: string,
    chainId?: string,
  ): Payee {
    if (this.payees.has(id)) {
      throw new PayrollError("PAYEE_EXISTS", `Payee '${id}' already exists`);
    }

    const base = {
      id,
      name,
      address,
      status: "active" as const,
      registeredAt: new Date().toISOString(),
    };
    const payee: Payee = chainId !== undefined
      ? { ...base, chainId }
      : base;

    this.payees.set(id, payee);
    return payee;
  }

  getPayee(id: string): Payee {
    const payee = this.payees.get(id);
    if (!payee) {
      throw new PayrollError("PAYEE_NOT_FOUND", `Payee '${id}' not found`);
    }
    return payee;
  }

  updatePayeeStatus(
    id: string,
    status: Payee["status"],
  ): Payee {
    const payee = this.getPayee(id);
    const updated: Payee = { ...payee, status };
    this.payees.set(id, updated);
    return updated;
  }

  listPayees(status?: Payee["status"]): readonly Payee[] {
    const all = [...this.payees.values()];
    return status ? all.filter((p) => p.status === status) : all;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Schedule management
  // ───────────────────────────────────────────────────────────────────────

  setSchedule(
    payeeId: string,
    components: readonly PayComponent[],
  ): PayrollScheduleEntry {
    this.getPayee(payeeId); // Validate exists

    if (components.length === 0) {
      throw new PayrollError("NO_COMPONENTS", `Schedule for '${payeeId}' must have at least one component`);
    }

    // Validate all components have correct currency
    for (const comp of components) {
      if (comp.amount.currency !== this.currency) {
        throw new PayrollError(
          "INVALID_AMOUNT",
          `Component '${comp.id}' has currency '${comp.amount.currency}', expected '${this.currency}'`,
        );
      }
    }

    const entry: PayrollScheduleEntry = { payeeId, components };
    this.schedules.set(payeeId, entry);
    return entry;
  }

  getSchedule(payeeId: string): PayrollScheduleEntry | undefined {
    return this.schedules.get(payeeId);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Payroll runs
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Create a new payroll run. Deterministically computes all entries
   * from the current schedules for active payees.
   */
  createRun(id: string, period: PayPeriod): PayrollRun {
    if (this.runs.has(id)) {
      throw new PayrollError("RUN_EXISTS", `Payroll run '${id}' already exists`);
    }

    const entries: PayrollEntry[] = [];
    let totalGross = this.zero();
    let totalDeductions = this.zero();
    let totalNet = this.zero();

    // Process each active payee that has a schedule
    for (const [payeeId, schedule] of this.schedules) {
      const payee = this.payees.get(payeeId);
      if (!payee || payee.status !== "active") continue;

      const entry = this.computeEntry(payeeId, schedule.components);
      entries.push(entry);

      totalGross = addMoney(totalGross, entry.grossPay);
      totalDeductions = addMoney(totalDeductions, entry.deductions);
      totalNet = addMoney(totalNet, entry.netPay);
    }

    const run: PayrollRun = {
      id,
      period,
      status: "draft",
      entries,
      totalGross,
      totalDeductions,
      totalNet,
      createdAt: new Date().toISOString(),
    };

    this.runs.set(id, run);
    return run;
  }

  getRun(id: string): PayrollRun {
    const run = this.runs.get(id);
    if (!run) {
      throw new PayrollError("RUN_NOT_FOUND", `Payroll run '${id}' not found`);
    }
    return run;
  }

  listRuns(status?: PayrollRunStatus): readonly PayrollRun[] {
    const all = [...this.runs.values()];
    return status ? all.filter((r) => r.status === status) : all;
  }

  /**
   * Approve a draft payroll run. Only drafts can be approved.
   */
  approveRun(id: string): PayrollRun {
    const run = this.getRun(id);
    if (run.status !== "draft") {
      throw new PayrollError(
        "INVALID_TRANSITION",
        `Cannot approve run '${id}' in status '${run.status}' (must be 'draft')`,
      );
    }

    const approved: PayrollRun = { ...run, status: "approved" };
    this.runs.set(id, approved);
    return approved;
  }

  /**
   * Execute a payroll run, recording all entries in the ledger.
   *
   * Each payee's net pay is debited from the payroll expense account
   * and credited to the payee's account.
   */
  executeRun(id: string, ledger: Ledger): PayrollRun {
    const run = this.getRun(id);
    if (run.status !== "approved") {
      throw new PayrollError(
        "INVALID_TRANSITION",
        `Cannot execute run '${id}' in status '${run.status}' (must be 'approved')`,
      );
    }

    // Atomic execution (A-TREAS-003): computeEntry's netPay = gross -
    // deductions has no floor, so an entry whose deductions meet or exceed
    // gross yields a zero/negative netPay. The ledger rejects non-positive
    // amounts (Rule 6), so appending per-entry used to throw mid-loop after
    // earlier payees were already committed — wedging the run (still
    // 'approved') and colliding on corrId on retry. Pre-validate EVERY entry's
    // netPay (well-formed and strictly positive) BEFORE any ledger write, then
    // commit the whole run as one balanced batch.
    for (const entry of run.entries) {
      try {
        validateMoney(entry.netPay);
      } catch {
        throw new PayrollError(
          "INVALID_AMOUNT",
          `Payee '${entry.payeeId}' has a malformed net pay '${String(entry.netPay.amount)}'`,
        );
      }
      if (!isPositive(entry.netPay)) {
        throw new PayrollError(
          "INVALID_AMOUNT",
          `Payee '${entry.payeeId}' has net pay '${entry.netPay.amount}' ${entry.netPay.currency}, which is not strictly positive — refusing to execute run '${run.id}'`,
        );
      }
    }

    // Ensure accounts exist
    const expenseAccountId = `payroll:expense:${run.period.label}`;
    if (!ledger.hasAccount(expenseAccountId)) {
      ledger.registerAccount({
        id: expenseAccountId,
        type: "expense",
        name: `Payroll Expense: ${run.period.label}`,
      });
    }

    // One correlationId for the whole run: the ledger requires every entry in
    // a batch to share it (Rule 2), and it makes the run a single recoverable
    // transaction. Per-payee entry IDs stay unique.
    const corrId = `payroll:${run.id}`;
    const now = new Date().toISOString();
    const entries: LedgerEntry[] = [];

    for (const entry of run.entries) {
      const payeeAccountId = `payroll:payee:${entry.payeeId}`;
      if (!ledger.hasAccount(payeeAccountId)) {
        ledger.registerAccount({
          id: payeeAccountId,
          type: "liability",
          name: `Payee: ${entry.payeeId}`,
        });
      }

      // Double-entry: debit expense, credit payee liability
      entries.push(
        {
          id: `${corrId}:${entry.payeeId}:debit`,
          accountId: expenseAccountId,
          type: "debit",
          money: entry.netPay,
          timestamp: now,
          correlationId: corrId,
        },
        {
          id: `${corrId}:${entry.payeeId}:credit`,
          accountId: payeeAccountId,
          type: "credit",
          money: entry.netPay,
          timestamp: now,
          correlationId: corrId,
        },
      );
    }

    // Append the entire balanced batch atomically (skip a no-op empty run).
    if (entries.length > 0) {
      ledger.append(entries, {
        description: `Payroll: ${run.period.label}`,
      });
    }

    const executed: PayrollRun = {
      ...run,
      status: "executed",
      executedAt: new Date().toISOString(),
    };
    this.runs.set(id, executed);
    this.telemetry.record({
      package: "@attestia/treasury",
      op: "payroll.run",
      level: "info",
      outcome: "ok",
      attributes: { recipientCount: run.entries.length },
      message: `payroll run '${run.id}' (${run.period.label}) executed: net ${run.totalNet.amount} ${run.totalNet.currency} to ${run.entries.length} payee(s)`,
    });
    return executed;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internal state access (for Treasury)
  // ─────────────────────────────────────────────────────────────────────

  exportPayees(): readonly Payee[] {
    return [...this.payees.values()];
  }

  exportRuns(): readonly PayrollRun[] {
    return [...this.runs.values()];
  }

  importPayees(payees: readonly Payee[]): void {
    for (const p of payees) {
      this.payees.set(p.id, p);
    }
  }

  importRuns(runs: readonly PayrollRun[]): void {
    for (const r of runs) {
      this.runs.set(r.id, r);
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Private
  // ───────────────────────────────────────────────────────────────────────

  private computeEntry(
    payeeId: string,
    components: readonly PayComponent[],
  ): PayrollEntry {
    let grossPay = this.zero();
    let deductions = this.zero();
    const resolved: ResolvedPayComponent[] = [];

    for (const comp of components) {
      resolved.push({
        componentId: comp.id,
        name: comp.name,
        type: comp.type,
        amount: comp.amount,
      });

      if (comp.type === "deduction") {
        deductions = addMoney(deductions, comp.amount);
      } else {
        grossPay = addMoney(grossPay, comp.amount);
      }
    }

    const netPay = subtractMoney(grossPay, deductions);

    return {
      payeeId,
      grossPay,
      deductions,
      netPay,
      components: resolved,
    };
  }

  private zero(): Money {
    return zeroMoney(this.currency, this.decimals);
  }
}
