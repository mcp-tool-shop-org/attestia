/**
 * Hono application factory.
 *
 * Creates the Hono app with middleware and routes.
 * Separated from main.ts for testability — tests create the app
 * without starting the HTTP server.
 */

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { pino } from "pino";
import type { Logger } from "pino";
import type { AppEnv } from "./types/api-contract.js";
import { TenantRegistry } from "./services/tenant-registry.js";
import type { AttestiaServiceConfig } from "./services/attestia-service.js";
import { TelemetryBridge } from "./observability/telemetry-bridge.js";
import { handleError } from "./middleware/error-handler.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { loggerMiddleware } from "./middleware/logger.js";
import type { RequestLogEntry } from "./middleware/logger.js";
import {
  idempotencyMiddleware,
  InMemoryIdempotencyStore,
} from "./middleware/idempotency.js";
import { authMiddleware } from "./middleware/auth.js";
import type { AuthConfig } from "./middleware/auth.js";
import { tenantMiddleware } from "./middleware/tenant.js";
import {
  rateLimitMiddleware,
  TokenBucketStore,
} from "./middleware/rate-limit.js";
import {
  metricsMiddleware,
  MetricsCollector,
} from "./middleware/metrics.js";
import { createHealthRoutes } from "./routes/health.js";
import { createIntentRoutes } from "./routes/intents.js";
import { createEventRoutes } from "./routes/events.js";
import { createVerifyRoutes } from "./routes/verify.js";
import { createAttestationRoutes } from "./routes/attestation.js";
import { createMetricsRoute } from "./routes/metrics.js";
import { createExportRoutes } from "./routes/export.js";
import { createPublicVerifyRoutes } from "./routes/public-verify.js";
import type { PublicVerifyDeps } from "./routes/public-verify.js";
import { createPublicOpenApiRoutes } from "./routes/public-openapi.js";
import { createProofRoutes, createPublicProofRoutes } from "./routes/proofs.js";
import { createComplianceRoutes, createPublicComplianceRoutes } from "./routes/compliance.js";
import { createAuditLogRoutes } from "./routes/audit-log.js";
import { AuditLog } from "./services/audit-log.js";
import { createErrorEnvelope } from "./types/error.js";

// =============================================================================
// App Config
// =============================================================================

export interface CreateAppOptions {
  readonly serviceConfig: AttestiaServiceConfig;
  readonly logFn?: (entry: RequestLogEntry) => void;
  /**
   * Pino logger the telemetry bridge logs backend observability events to.
   * When omitted, a silent pino instance is used so tests stay quiet while the
   * metrics half of the bridge still records. `main.ts` passes its real logger.
   */
  readonly logger?: Logger | undefined;
  readonly idempotencyTtlMs?: number;
  /** Default tenant ID used when no auth/tenant middleware is active */
  readonly defaultTenantId?: string;
  /** Auth configuration. When provided, auth middleware is enabled. */
  readonly auth?: AuthConfig | undefined;
  /** Rate limit configuration. When provided with auth, rate limiting is enabled. */
  readonly rateLimit?: { rpm: number; burst: number } | undefined;
  /** Enable metrics collection. Default: true */
  readonly enableMetrics?: boolean | undefined;
  /**
   * Auth configuration for /metrics endpoint.
   * When provided, metrics require authentication (prevents reconnaissance).
   * When not provided, metrics are unauthenticated (backward compatible for dev).
   */
  readonly metricsAuth?: AuthConfig | undefined;
  /** Public verification endpoint configuration */
  readonly publicVerify?: PublicVerifyDeps | undefined;
  /**
   * Expose aggregate tenant counts on the unauthenticated /ready probe.
   * Default: false (fail-closed — see HealthRouteOptions, V2-002).
   */
  readonly exposeReadinessCounts?: boolean | undefined;
  /**
   * Maximum accepted request body size, in bytes, for /api/* and the public
   * routes. Default: {@link DEFAULT_MAX_BODY_BYTES}. Requests exceeding this are
   * rejected with 413 PAYLOAD_TOO_LARGE before any JSON parsing or Zod
   * validation runs (A-NODE-005), bounding memory use from
   * `validate.ts`/`c.req.json()` buffering.
   */
  readonly maxBodyBytes?: number | undefined;
}

/**
 * Default request body-size cap (5 MiB). Sized above the largest legitimate
 * payload — a full reconciliation request (three arrays of up to 10k entries,
 * each entry a few hundred bytes) — while still bounding unauthenticated
 * memory exposure.
 */
export const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024;

// =============================================================================
// Factory
// =============================================================================

export interface AppInstance {
  readonly app: Hono<AppEnv>;
  readonly tenantRegistry: TenantRegistry;
  readonly idempotencyStore: InMemoryIdempotencyStore;
  readonly metricsCollector: MetricsCollector;
  readonly auditLog: AuditLog;
  readonly rateLimitStore?: TokenBucketStore | undefined;
}

/**
 * Create the Hono application with all middleware and routes.
 */
export function createApp(options: CreateAppOptions): AppInstance {
  const metricsCollector = new MetricsCollector();

  // Telemetry bridge: fans backend observability events out to pino + the
  // Prometheus collector. A single shared instance is threaded into every
  // domain service (it is stateless). When no logger is supplied (tests),
  // a silent pino keeps logs quiet while metrics still record.
  const bridgeLogger = options.logger ?? pino({ level: "silent" });
  const telemetryBridge = new TelemetryBridge(bridgeLogger, metricsCollector);

  const tenantRegistry = new TenantRegistry({
    ...options.serviceConfig,
    telemetry: options.serviceConfig.telemetry ?? telemetryBridge,
  });
  const idempotencyStore = new InMemoryIdempotencyStore(
    options.idempotencyTtlMs ?? 86400000,
  );
  const auditLog = new AuditLog();
  const defaultTenantId = options.defaultTenantId ?? options.serviceConfig.ownerId;
  const enableMetrics = options.enableMetrics !== false;

  let rateLimitStore: TokenBucketStore | undefined;
  if (options.rateLimit !== undefined) {
    rateLimitStore = new TokenBucketStore(options.rateLimit);
  }

  const app = new Hono<AppEnv>();

  // ─── Global Middleware ───────────────────────────────────────────
  app.use("*", requestIdMiddleware());

  // Security headers
  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Content-Security-Policy", "default-src 'none'");
    c.header("Referrer-Policy", "no-referrer");
  });

  if (options.logFn !== undefined) {
    app.use("*", loggerMiddleware(options.logFn));
  }

  if (enableMetrics) {
    app.use("*", metricsMiddleware(metricsCollector));
  }

  // ─── Body-size limit (A-NODE-005) ───────────────────────────────
  // Reject oversized bodies with a structured 413 BEFORE c.req.json()/Zod
  // buffers them. Scoped to the write surfaces (/api/* and /public/*); the
  // bodyless health/metrics probes are unaffected. Honors Content-Length and
  // also streams-and-counts chunked bodies (see hono bodyLimit).
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const bodyLimitMiddleware = bodyLimit({
    maxSize: maxBodyBytes,
    onError: (c) =>
      c.json(
        createErrorEnvelope(
          "PAYLOAD_TOO_LARGE",
          "Request body exceeds the maximum allowed size.",
          `Reduce the payload to at most ${maxBodyBytes} bytes and retry.`,
        ),
        413,
      ),
  });
  app.use("/api/*", bodyLimitMiddleware);
  app.use("/public/*", bodyLimitMiddleware);

  // ─── Error Handler ──────────────────────────────────────────────
  app.onError(handleError);

  // ─── Health Routes (no auth required) ───────────────────────────
  const healthRoutes = createHealthRoutes(tenantRegistry, {
    exposeReadinessCounts: options.exposeReadinessCounts ?? false,
  });
  app.route("/", healthRoutes);

  // ─── Metrics Route ──────────────────────────────────────────────
  if (enableMetrics) {
    if (options.metricsAuth !== undefined) {
      // Secured: require auth for metrics (prevents reconnaissance)
      const metricsApp = new Hono<AppEnv>();
      metricsApp.use("*", authMiddleware(options.metricsAuth));
      metricsApp.route("/", createMetricsRoute(metricsCollector));
      app.route("/", metricsApp);
    } else {
      // Unsecured: backward compatible for dev/testing
      app.route("/", createMetricsRoute(metricsCollector));
    }
  }

  // ─── Public Routes (no auth required) ──────────────────────────
  app.route("/public/v1/verify", createPublicVerifyRoutes(options.publicVerify));
  app.route("/public/v1/proofs", createPublicProofRoutes());
  app.route("/public/v1/compliance", createPublicComplianceRoutes());
  app.route("/public/v1", createPublicOpenApiRoutes());

  // ─── API Routes ─────────────────────────────────────────────────
  if (options.auth !== undefined) {
    // Secured mode: auth → tenant → rate-limit → idempotency
    app.use("/api/*", authMiddleware(options.auth));
    app.use("/api/*", tenantMiddleware(tenantRegistry));

    if (rateLimitStore !== undefined) {
      app.use("/api/*", rateLimitMiddleware(rateLimitStore));
    }
  } else {
    // Unsecured mode (tests, dev): use default tenant with synthetic admin auth
    app.use("/api/*", async (c, next) => {
      const tenantId = c.req.header("X-Tenant-Id") ?? defaultTenantId;
      const service = tenantRegistry.getOrCreate(tenantId);
      c.set("service", service);
      // Set synthetic auth so requirePermission() works in unsecured mode
      c.set("auth", {
        type: "api-key" as const,
        identity: "unsecured-dev",
        role: "admin" as const,
        tenantId,
      });
      await next();
    });
  }

  // Idempotency for POST /api/* requests
  app.use("/api/*", idempotencyMiddleware(idempotencyStore));

  // Mount v1 API routes
  const routeDeps = { metrics: metricsCollector, auditLog };
  app.route("/api/v1/intents", createIntentRoutes(routeDeps));
  app.route("/api/v1/events", createEventRoutes());
  app.route("/api/v1/verify", createVerifyRoutes());
  app.route("/api/v1", createAttestationRoutes(routeDeps));
  app.route("/api/v1/export", createExportRoutes());
  app.route("/api/v1/proofs", createProofRoutes());
  app.route("/api/v1/compliance", createComplianceRoutes());
  app.route("/api/v1/audit-logs", createAuditLogRoutes(auditLog));

  return { app, tenantRegistry, idempotencyStore, metricsCollector, auditLog, rateLimitStore };
}
