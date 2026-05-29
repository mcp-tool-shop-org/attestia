/**
 * @attestia/types — Observability contract.
 *
 * A zero-dependency, OpenTelemetry-inspired telemetry sink that backend
 * packages emit structured events to. Injection is optional: a package given
 * no sink emits nothing (the default is {@link NOOP_TELEMETRY}), keeping the
 * libraries dependency-free and silent unless a host (e.g. `@attestia/node`)
 * wires a sink that bridges to its logger + metrics.
 *
 * Design rules (inherited from the stack):
 * - Zero runtime dependencies.
 * - `record` MUST NOT throw — observability must never break the operation it
 *   observes. Implementations are responsible for catching internally.
 * - `attributes` MUST be low-cardinality (safe as metric labels / structured
 *   log fields). Never put unbounded values (raw ids, amounts, addresses) in
 *   `attributes`; put human detail in `message`.
 */

/** Severity of a telemetry event, mapped to log levels by hosts. */
export type ObservabilityLevel = "debug" | "info" | "warn" | "error";

/** Coarse outcome of an operation, mapped to metric status labels by hosts. */
export type ObservabilityOutcome = "ok" | "degraded" | "failed";

/**
 * A single structured telemetry event.
 *
 * `op` is the operation/span name (e.g. `"eventstore.append"`,
 * `"witness.submit"`, `"reconcile"`). Together with `package` and `outcome` it
 * forms a low-cardinality key a host can turn into a metric series.
 */
export interface ObservabilityEvent {
  /** Emitting package, e.g. `"@attestia/witness"`. */
  readonly package: string;
  /** Operation name, e.g. `"submit"`, `"append"`, `"reconcile"`. */
  readonly op: string;
  readonly level: ObservabilityLevel;
  /** Coarse status; omit for purely informational events. */
  readonly outcome?: ObservabilityOutcome;
  /** Wall-clock duration of the operation, when measured. */
  readonly durationMs?: number;
  /** Low-cardinality structured fields (safe as metric labels). */
  readonly attributes?: Readonly<Record<string, string | number | boolean>>;
  /** Human-readable detail (NOT a metric label). */
  readonly message?: string;
}

/**
 * The sink backend packages emit to. Implementations bridge to a logger and/or
 * metrics system (see `@attestia/node` for a pino + Prometheus bridge).
 * `record` MUST NOT throw.
 */
export interface Telemetry {
  record(event: ObservabilityEvent): void;
}

/**
 * A no-op {@link Telemetry}. Backend packages default to this when no sink is
 * injected, so observability is opt-in and never imposes a dependency or cost
 * on consumers that don't want it.
 */
export const NOOP_TELEMETRY: Telemetry = {
  record(): void {
    /* intentionally empty — see NOOP_TELEMETRY docs */
  },
};
