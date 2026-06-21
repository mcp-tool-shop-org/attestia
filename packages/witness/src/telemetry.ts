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
   * Record that a single `submitAndWait` attempt hit its per-attempt deadline
   * (PB-WCO-002) (level warn, outcome degraded). The attempt is treated as a
   * possibly-applied transient: the retry loop will fire and the next attempt's
   * fixed-hash idempotency check recovers a lost-but-applied tx. A rising rate
   * of this event signals a degrading / half-open XRPL connection.
   *
   * @param timeoutMs The deadline that elapsed.
   * @param attempt 1-based attempt number that timed out.
   */
  submitTimeout(timeoutMs: number, attempt: number): void {
    this.emit({
      op: "submit.timeout",
      level: "warn",
      outcome: "degraded",
      attributes: { attempt },
      message:
        `submitAndWait exceeded the per-attempt deadline of ${timeoutMs}ms on attempt ${attempt}; ` +
        `treating as possibly-applied transient — retrying with the same fixed-hash blob, ` +
        `the idempotency check will recover it if it landed`,
    });
  }

  /**
   * Record that the XRPL connection was found dropped mid-submit and a
   * best-effort reconnect was attempted (PB-WCO-003) (level warn, outcome
   * degraded). Previously a mid-run drop bricked the submitter silently — every
   * subsequent submit failed fast with "not connected" and no recovery. This
   * surfaces the drop AND whether the in-loop reconnect succeeded.
   *
   * @param outcome `"reconnected"` if the reconnect succeeded, `"failed"` if not.
   * @param attempt 1-based attempt number on which the drop was detected.
   */
  connectionLost(outcome: "reconnected" | "failed", attempt: number): void {
    this.emit({
      op: "submit.connection_lost",
      level: outcome === "reconnected" ? "warn" : "error",
      outcome: "degraded",
      attributes: { attempt, reconnected: outcome === "reconnected" },
      message:
        outcome === "reconnected"
          ? `XRPL connection was dropped mid-submit (attempt ${attempt}); reconnected and continuing with the same fixed-hash blob`
          : `XRPL connection was dropped mid-submit (attempt ${attempt}) and reconnect FAILED; ` +
            `host must call connect() to recover — submissions will fail until then`,
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
