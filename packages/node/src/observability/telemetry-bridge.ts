/**
 * Telemetry bridge — wires the `@attestia/types` observability contract into
 * this host's existing pino logger and Prometheus {@link MetricsCollector}.
 *
 * Backend packages (event-store, ledger, vault, treasury, reconciler,
 * registrum, chain-observer, witness) emit structured {@link ObservabilityEvent}s
 * to an injected {@link Telemetry} sink, defaulting to NOOP. This class is the
 * sink `@attestia/node` injects, fanning each event out to two destinations:
 *
 *  1. **Structured log** — one pino line at the event's `level`, with the
 *     structured fields `{ package, op, outcome, durationMs, ...attributes }`
 *     and `event.message` as the log message.
 *  2. **Low-cardinality metric** — increments
 *     `attestia_telemetry_total{package, op, outcome}`. The three labels are all
 *     bounded (package/op are code-defined; outcome is one of ok|degraded|failed
 *     |none), so the series count stays small regardless of traffic. Per-event
 *     `attributes` are intentionally NOT turned into labels — they may carry
 *     bounded-but-numerous values that would inflate cardinality.
 *
 * Additionally, for the witness submission flow (D6-B-006) it maps the
 * `@attestia/witness` `submit` outcome event onto the business counter
 * `attestia_witness_total{status}`, which the `AttestiaWitnessFailure` alert in
 * `alerts/attestia-alerts.yml` queries. Without this wiring that series never
 * exists and the alert is dead.
 *
 * Contract (from `@attestia/types`): `record` MUST NOT throw. Observability must
 * never break the operation it observes, so the whole body is wrapped in
 * try/catch and any failure is swallowed (best-effort, last-resort logged).
 */

import type { Logger } from "pino";
import type {
  Telemetry,
  ObservabilityEvent,
  ObservabilityLevel,
} from "@attestia/types";
import type { MetricsCollector } from "../middleware/metrics.js";

/** Metric name for the generic telemetry fan-out counter. */
export const TELEMETRY_COUNTER = "attestia_telemetry_total";

/** Metric name for the witness-submission business counter (D6-B-006). */
export const WITNESS_COUNTER = "attestia_witness_total";

/** The witness package id whose `submit` outcome drives {@link WITNESS_COUNTER}. */
const WITNESS_PACKAGE = "@attestia/witness";

/**
 * Map a telemetry {@link ObservabilityLevel} onto a pino logging method.
 * `debug`/`info`/`warn`/`error` map 1:1 onto pino's same-named levels.
 */
function logAtLevel(
  logger: Logger,
  level: ObservabilityLevel,
  obj: Record<string, unknown>,
  msg?: string,
): void {
  // pino's level methods share the (obj, msg?) signature; select by level.
  switch (level) {
    case "debug":
      logger.debug(obj, msg);
      break;
    case "warn":
      logger.warn(obj, msg);
      break;
    case "error":
      logger.error(obj, msg);
      break;
    case "info":
    default:
      logger.info(obj, msg);
      break;
  }
}

/**
 * A {@link Telemetry} sink that bridges backend observability events to this
 * host's pino logger + Prometheus collector. Stateless aside from its injected
 * dependencies, so a single shared instance can be handed to every service.
 */
export class TelemetryBridge implements Telemetry {
  private readonly logger: Logger;
  private readonly metrics: MetricsCollector;

  constructor(logger: Logger, metrics: MetricsCollector) {
    this.logger = logger;
    this.metrics = metrics;

    // Pre-declare the series so they carry descriptive HELP text and exist in
    // the exposition even before the first event. Idempotent.
    this.metrics.registerCounter(
      TELEMETRY_COUNTER,
      "Backend telemetry events by emitting package, operation, and outcome",
    );
    this.metrics.registerCounter(
      WITNESS_COUNTER,
      "Witness attestation submissions by terminal status (ok|failed)",
    );
  }

  /**
   * Fan a single backend event out to the logger and the metrics collector.
   * MUST NOT throw (see class docs / the `@attestia/types` contract).
   */
  record(event: ObservabilityEvent): void {
    try {
      // ── 1. Structured log line ──────────────────────────────────────────
      const fields: Record<string, unknown> = {
        package: event.package,
        op: event.op,
      };
      if (event.outcome !== undefined) fields.outcome = event.outcome;
      if (event.durationMs !== undefined) fields.durationMs = event.durationMs;
      if (event.attributes !== undefined) {
        // Spread low-cardinality structured attributes as first-class fields.
        for (const [k, v] of Object.entries(event.attributes)) {
          // Never let an attribute clobber the reserved keys above.
          if (k !== "package" && k !== "op" && k !== "outcome" && k !== "durationMs") {
            fields[k] = v;
          }
        }
      }
      logAtLevel(this.logger, event.level, fields, event.message);

      // ── 2. Generic low-cardinality counter ──────────────────────────────
      this.metrics.incrementCounter(TELEMETRY_COUNTER, {
        package: event.package,
        op: event.op,
        // "none" keeps the label present (and the series bounded) for events
        // that carry no outcome, rather than emitting an empty-string label.
        outcome: event.outcome ?? "none",
      });

      // ── 3. Witness business counter (D6-B-006) ──────────────────────────
      // The witness emits op:"submit" with outcome ok|failed for the *terminal*
      // result of a submission (the no-outcome "attempt" event is skipped by
      // the `event.outcome` guard). Map that onto attestia_witness_total{status}
      // so the AttestiaWitnessFailure alert has a live series to query.
      if (
        event.package === WITNESS_PACKAGE &&
        event.op === "submit" &&
        event.outcome !== undefined
      ) {
        this.metrics.incrementCounter(WITNESS_COUNTER, {
          status: event.outcome,
        });
      }
    } catch (err) {
      // Last-resort: never propagate. Try to note it, but even this is guarded.
      try {
        this.logger.error({ err }, "telemetry bridge record failed");
      } catch {
        /* give up silently — observability must never break the caller */
      }
    }
  }
}
