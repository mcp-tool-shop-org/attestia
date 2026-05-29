/**
 * @attestia/node — Entry point.
 *
 * Bootstraps the Hono app, loads config, starts the HTTP server,
 * and handles graceful shutdown.
 */

import { serve } from "@hono/node-server";
import pino from "pino";
import { loadConfig, parseApiKeys } from "./config.js";
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

  // Build auth config from env vars
  let authConfig: AuthConfig | undefined;
  const parsedKeys = parseApiKeys(config.API_KEYS);
  if (parsedKeys.length > 0 || config.JWT_SECRET !== undefined) {
    const keyMap = new Map<string, ApiKeyRecord>();
    for (const k of parsedKeys) {
      keyMap.set(k.key, k);
    }
    authConfig = {
      apiKeys: keyMap,
      jwtSecret: config.JWT_SECRET,
      jwtIssuer: config.JWT_ISSUER,
    };
    logger.info(
      { apiKeyCount: parsedKeys.length, jwtEnabled: config.JWT_SECRET !== undefined },
      "Auth configured",
    );
  } else {
    logger.warn("No API keys or JWT secret configured — running in unsecured mode");
  }

  const { app, tenantRegistry } = createApp({
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
    rateLimit: { rpm: config.RATE_LIMIT_RPM, burst: config.RATE_LIMIT_BURST },
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

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Shutdown signal received");
    server.close();
    await tenantRegistry.stopAll();
    logger.info("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

// Only run when executed directly (not when imported)
main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error("Fatal startup error:", err);
  process.exit(1);
});
