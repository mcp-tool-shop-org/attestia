/**
 * @attestia/witness — submission telemetry helpers.
 *
 * Witness submission is the riskiest external-IO surface in the stack: it signs
 * and broadcasts fund-affecting XRPL transactions and recovers lost-but-applied
 * txs via a fixed-hash idempotency check. These helpers emit structured
 * {@link ObservabilityEvent}s for that flow (D3-B-001) through an injected sink,
 * defaulting to {@link NOOP_TELEMETRY} so the package stays silent and
 * dependency-free unless a host wires a sink.
 *
 * Contract (inherited from @attestia/types):
 * - `attributes` MUST be low-cardinality (safe as metric labels). Only bounded
 *   values like `attempt` go there. Unbounded detail (txHash, ledgerIndex) goes
 *   in `message`, NEVER in `attributes`.
 * - Emitting MUST NOT throw into the caller — observability never breaks the
 *   operation it observes.
 */

import { type Telemetry, NOOP_TELEMETRY } from "@attestia/types";

const PACKAGE = "@attestia/witness";

/**
 * A thin wrapper over an injected {@link Telemetry} sink that scopes events to
 * the witness package and guarantees emit-never-throws. Both XrplSubmitter and
 * MultiSigSubmitter use this so the emitted event shape is identical.
 */
export class SubmitTelemetry {
  private readonly sink: Telemetry;

  constructor(sink: Telemetry | undefined) {
    this.sink = sink ?? NOOP_TELEMETRY;
  }

  /** Record a `submit` attempt is starting (level info). */
  attempt(): void {
    this.emit({
      op: "submit",
      level: "info",
      message: "submitting attestation transaction",
    });
  }

  /**
   * Record a retry of the submission (level warn).
   * @param attempt 1-based retry number (the Nth retry after the first attempt).
   */
  retry(attempt: number): void {
    this.emit({
      op: "submit.retry",
      level: "warn",
      attributes: { attempt },
      message: `retrying attestation submission (attempt ${attempt})`,
    });
  }

  /**
   * Record an idempotent hit — a lost-but-applied tx recovered via the
   * fixed-hash existence check (level warn). This is a critical operational
   * signal: it means a prior submission's response was lost but the tx DID apply
   * on-ledger, and we recognized it instead of double-submitting.
   *
   * @param detail Human-readable detail (txHash / ledgerIndex) for the message.
   */
  idempotentHit(detail: string): void {
    this.emit({
      op: "submit.idempotent_hit",
      level: "warn",
      message: `idempotent hit: lost-but-applied tx recovered on-chain (${detail})`,
    });
  }

  /**
   * Record the final outcome of a submission (level info on ok, error on fail).
   *
   * @param outcome `"ok"` when the tx is witnessed, `"failed"` when exhausted.
   * @param durationMs Wall-clock duration of the whole submit() call.
   * @param detail Human-readable detail (txHash / ledgerIndex, or error) — goes
   *   in `message`, NOT in `attributes` (per the low-cardinality rule).
   */
  final(outcome: "ok" | "failed", durationMs: number, detail: string): void {
    this.emit({
      op: "submit",
      level: outcome === "ok" ? "info" : "error",
      outcome,
      durationMs,
      message: detail,
    });
  }

  /** Internal: stamp the package and forward to the sink, swallowing any throw. */
  private emit(event: {
    op: string;
    level: "debug" | "info" | "warn" | "error";
    outcome?: "ok" | "degraded" | "failed";
    durationMs?: number;
    attributes?: Record<string, string | number | boolean>;
    message?: string;
  }): void {
    try {
      this.sink.record({ package: PACKAGE, ...event });
    } catch {
      /* observability must never throw into the caller */
    }
  }
}
