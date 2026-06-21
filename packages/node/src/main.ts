/**
 * @attestia/node — Entry point.
 *
 * Bootstraps the Hono app, loads config, starts the HTTP server,
 * and handles graceful shutdown.
 */

import { pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import pino from "pino";
import type { Logger } from "pino";
import { loadConfig, parseApiKeys } from "./config.js";
import type { AppConfig } from "./config.js";
import { createApp } from "./app.js";
import type { AuthConfig } from "./middleware/auth.js";
import type { ApiKeyRecord } from "./types/auth.js";

// =============================================================================
// Re-exports (package public API)
// =============================================================================

export { AttestiaService } from "./services/attestia-service.js";
export type { AttestiaServiceConfig } from "./services/attestia-service.js";
export { TenantRegistry } from "./services/tenant-registry.js";
export { loadConfig, parseApiKeys, ConfigSchema } from "./config.js";
export type { AppConfig, ParsedApiKey } from "./config.js";
export { createApp } from "./app.js";
export type { CreateAppOptions, AppInstance } from "./app.js";
export * from "./types/index.js";

// =============================================================================
// Auth posture
// =============================================================================

/**
 * Error thrown when the process is configured to start in production with no
 * authentication credentials. Production MUST fail closed — refuse to boot —
 * rather than silently fall through to the synthetic-admin "unsecured" path
 * that trusts the client `X-Tenant-Id` header (A-NODE-001).
 */
export class InsecureProductionConfigError extends Error {
  override readonly name = "InsecureProductionConfigError";
  constructor() {
    super(
      "Refusing to start: NODE_ENV=production with no API keys and no JWT " +
        "secret. Set API_KEYS and/or JWT_SECRET, or run with " +
        "NODE_ENV=development for the unsecured local path.",
    );
  }
}

/**
 * Build the auth config from validated app config.
 *
 * Posture rules:
 * - If API keys or a JWT secret are present → return a configured AuthConfig
 *   (secured mode).
 * - If NEITHER is present and `NODE_ENV === "production"` → throw
 *   {@link InsecureProductionConfigError}. Production must never fail open.
 * - If NEITHER is present and NODE_ENV is anything else (development/test) →
 *   return `undefined` and log a warning. This keeps the unsecured dev/test
 *   path working (the synthetic-admin branch in {@link createApp}).
 *
 * Extracted from `main()` so the posture gate is unit-testable without
 * starting an HTTP server.
 */
export function buildAuthConfig(
  config: AppConfig,
  logger: Pick<Logger, "info" | "warn">,
): AuthConfig | undefined {
  const parsedKeys = parseApiKeys(config.API_KEYS);
  if (parsedKeys.length > 0 || config.JWT_SECRET !== undefined) {
    const keyMap = new Map<string, ApiKeyRecord>();
    for (const k of parsedKeys) {
      keyMap.set(k.key, k);
    }
    logger.info(
      { apiKeyCount: parsedKeys.length, jwtEnabled: config.JWT_SECRET !== undefined },
      "Auth configured",
    );
    return {
      apiKeys: keyMap,
      jwtSecret: config.JWT_SECRET,
      jwtIssuer: config.JWT_ISSUER,
    };
  }

  // No credentials. Fail closed in production; allow the unsecured dev path
  // otherwise.
  if (config.NODE_ENV === "production") {
    throw new InsecureProductionConfigError();
  }

  logger.warn("No API keys or JWT secret configured — running in unsecured mode");
  return undefined;
}

// =============================================================================
// Bootstrap
// =============================================================================

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = pino({
    level: config.LOG_LEVEL,
    ...(config.NODE_ENV === "development"
      ? { transport: { target: "pino-pretty" } }
      : {}),
  });

  // Build auth config from env vars. Throws in production when no credentials
  // are configured (fail closed — A-NODE-001).
  const authConfig = buildAuthConfig(config, logger);

  // Witness diagnostics (B-NODE-004): the WITNESS_* block is parsed but no
  // witness is wired into the app yet. If an operator turns it on, say so
  // plainly so they do not believe on-chain witnessing is active when it is not.
  if (config.WITNESS_ENABLED) {
    logger.warn(
      {
        witnessUrl: config.WITNESS_URL,
        witnessAddress: config.WITNESS_ADDRESS,
      },
      "WITNESS_ENABLED=true but no witness is wired in this build — on-chain " +
        "witnessing is INACTIVE and attestia_witness_total will stay empty. " +
        "Do not rely on external witnessing until a witness backend is configured.",
    );
  }

  const { app, tenantRegistry, dispose } = createApp({
    serviceConfig: {
      ownerId: "default",
      defaultCurrency: config.DEFAULT_CURRENCY,
      defaultDecimals: config.DEFAULT_DECIMALS,
    },
    logFn: (entry) => {
      logger.info(entry, `${entry.method} ${entry.path} ${entry.status}`);
    },
    // Bridge backend observability events (event-store/ledger/vault/treasury/
    // reconciler/registrum/witness) onto this same pino logger + Prometheus.
    logger,
    idempotencyTtlMs: config.IDEMPOTENCY_TTL_MS,
    auth: authConfig,
    // When auth is configured, also require auth for /metrics so the secured
    // posture does not leak Prometheus metrics for reconnaissance (A-NODE-002).
    metricsAuth: authConfig,
    rateLimit: { rpm: config.RATE_LIMIT_RPM, burst: config.RATE_LIMIT_BURST },
    // Real server: run the in-memory store sweepers (B-NODE-001/002). They are
    // unref'd and released by dispose() on shutdown.
    enableStoreSweepers: true,
  });

  const server = serve({
    fetch: app.fetch,
    port: config.PORT,
    hostname: config.HOST,
  });

  logger.info(
    { port: config.PORT, host: config.HOST },
    "Attestia node started",
  );

  // ─── Graceful shutdown (B-NODE-003) ─────────────────────────────────
  // Order matters: stop accepting/await draining connections, stop the store
  // sweepers, stop tenant services, then exit. A double signal is ignored, and
  // a bounded force-exit timer guarantees termination even if a drain hangs.
  let shuttingDown = false;
  const SHUTDOWN_DEADLINE_MS = 10_000;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      // Orchestrators often escalate signals (SIGTERM → SIGINT). The first one
      // owns shutdown; subsequent signals are no-ops, not a second exit race.
      logger.warn({ signal }, "Shutdown already in progress — ignoring signal");
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, "Shutdown signal received");

    // Hard deadline: if draining hangs, still terminate. Unref'd so the timer
    // itself never keeps the process alive once everything else has settled.
    const forceExit = setTimeout(() => {
      logger.error(
        { deadlineMs: SHUTDOWN_DEADLINE_MS },
        "Graceful shutdown exceeded deadline — forcing exit",
      );
      process.exit(1);
    }, SHUTDOWN_DEADLINE_MS);
    forceExit.unref?.();

    try {
      // Await server close so in-flight requests (e.g. a ledger append) finish
      // before we tear down the services they depend on. @hono/node-server's
      // close() is callback-based; promisify it.
      await new Promise<void>((resolve, reject) => {
        server.close((err?: Error) => (err ? reject(err) : resolve()));
      });
      // Stop background sweepers, then tenant services.
      dispose();
      await tenantRegistry.stopAll();
      logger.info("Shutdown complete");
      clearTimeout(forceExit);
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "Error during graceful shutdown");
      clearTimeout(forceExit);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

// Only run when executed directly (not when imported as a library or by the
// test suite). Importing this module for its public re-exports must NOT bind a
// port or call process.exit. We compare the resolved entry script against this
// module's URL.
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().catch((err: unknown) => {
    // Fail closed: an insecure-production refusal (A-NODE-001) or any other
    // startup fault prints a clear fatal error and exits non-zero.
    // eslint-disable-next-line no-console
    console.error("Fatal startup error:", err);
    process.exit(1);
  });
}
