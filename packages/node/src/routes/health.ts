/**
 * Health check routes.
 *
 * GET /health — Liveness probe (always 200 if server is running)
 * GET /ready  — Readiness probe (deep health: event store integrity + writability)
 */

import { Hono } from "hono";
import type { Logger } from "pino";
import type { AppEnv } from "../types/api-contract.js";
import type { TenantRegistry } from "../services/tenant-registry.js";
import type { MetricsCollector } from "../middleware/metrics.js";

/** Metric name for the readiness gauge-as-counter of not-ready tenants (B-NODE-007). */
export const READINESS_FAILURE_COUNTER = "attestia_readiness_failures_total";

export interface HealthRouteOptions {
  /**
   * Expose aggregate tenant counts (`tenants`/`ready`/`notReady`) on the
   * unauthenticated `/ready` probe.
   *
   * Default: false (fail-closed). `/ready` is mounted BEFORE auth, so even an
   * aggregate tenant count lets an unauthenticated caller probe how many
   * tenants exist and watch that number change over time (enumeration,
   * V2-002). By default the probe returns only boolean readiness
   * (`status` + `timestamp`). Operators who need the counts can opt in here —
   * or, better, expose them behind admin auth.
   */
  readonly exposeReadinessCounts?: boolean;
  /**
   * Logger for readiness-flip diagnostics (B-NODE-007). When a tenant fails
   * readiness, a structured WARN is emitted naming the failing subsystem
   * (`writable` vs `integrity`) so the flip is observable in logs even though
   * the unauthenticated probe body stays minimal for security. Tenant ids are
   * NOT logged at WARN level by default to preserve the no-enumeration posture;
   * the failing subsystem reason is the operational signal.
   */
  readonly logger?: Pick<Logger, "warn"> | undefined;
  /** Metrics collector incremented when a tenant fails readiness (B-NODE-007). */
  readonly metrics?: Pick<MetricsCollector, "incrementCounter"> | undefined;
}

export function createHealthRoutes(
  tenantRegistry: TenantRegistry,
  options: HealthRouteOptions = {},
): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const exposeCounts = options.exposeReadinessCounts ?? false;
  const logger = options.logger;
  const metrics = options.metrics;

  routes.get("/health", (c) => {
    return c.json({
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  });

  routes.get("/ready", async (c) => {
    const tenantIds = tenantRegistry.tenantIds();

    // Deep health is computed PER tenant. This endpoint is mounted before auth,
    // so the default response exposes ONLY boolean readiness — no per-tenant
    // IDs (D6-A-003) and no aggregate counts (V2-002). Even a count is an
    // enumeration signal on an unauthenticated probe; counts are opt-in via
    // exposeReadinessCounts and otherwise belong behind admin auth.
    let readyCount = 0;
    let notReadyCount = 0;

    for (const tenantId of tenantIds) {
      const service = await tenantRegistry.getOrCreate(tenantId);

      // Deep health: check event store integrity + writability
      const { writable, integrity } = service.checkEventStoreWritable();
      const eventStoreOk = writable && integrity.valid;
      const serviceReady = service.isReady() && eventStoreOk;

      if (serviceReady) {
        readyCount++;
      } else {
        notReadyCount++;

        // B-NODE-007: a not-ready result was previously computed and discarded.
        // Emit a structured signal naming WHICH subsystem failed so an operator
        // paged by a failing probe knows whether it is a writability, integrity
        // (hash-chain), or service-lifecycle problem — without the probe body
        // having to leak per-tenant detail. The metric label is the failing
        // reason (low cardinality), not the tenant id.
        const reason = !service.isReady()
          ? "service_not_ready"
          : !integrity.valid
            ? "integrity"
            : "not_writable";
        logger?.warn(
          { reason, subsystem: "event-store" },
          "Tenant failed readiness check",
        );
        metrics?.incrementCounter(READINESS_FAILURE_COUNTER, { reason });
      }
    }

    // If no tenants have been initialized yet, we're still ready
    // (tenants are created on first request).
    const allReady = notReadyCount === 0;
    const status = allReady ? 200 : 503;

    const body: {
      status: string;
      timestamp: string;
      tenants?: number;
      ready?: number;
      notReady?: number;
    } = {
      status: allReady ? "ready" : "not_ready",
      timestamp: new Date().toISOString(),
    };

    // Counts are off by default (V2-002). When explicitly enabled, expose only
    // aggregate counts — never per-tenant detail.
    if (exposeCounts) {
      body.tenants = tenantIds.length;
      body.ready = readyCount;
      body.notReady = notReadyCount;
    }

    return c.json(body, status as 200);
  });

  return routes;
}
