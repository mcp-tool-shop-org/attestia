/**
 * Tests for the production auth posture gate (A-NODE-001) and the secured
 * /metrics wiring (A-NODE-002).
 *
 * A-NODE-001: In production with NO API keys and NO JWT secret, the process
 * MUST refuse to start (fail closed) rather than warn and fall through to the
 * synthetic-admin "unsecured" path that trusts the client X-Tenant-Id header.
 * The dev/test unsecured path MUST keep working.
 *
 * A-NODE-002: When auth is configured, /metrics must require auth in the
 * secured posture. main.ts passes `metricsAuth: authConfig`. createApp's
 * metricsAuth wiring is covered here at the app level.
 */

import { describe, it, expect } from "vitest";
import {
  buildAuthConfig,
  InsecureProductionConfigError,
} from "../src/main.js";
import { loadConfig } from "../src/config.js";
import { createApp } from "../src/app.js";

// A no-op logger so we can assert on behavior, not output.
const silentLogger = { info: () => {}, warn: () => {} };

// =============================================================================
// A-NODE-001 — production fails closed
// =============================================================================

describe("buildAuthConfig — production posture gate (A-NODE-001)", () => {
  it("THROWS in production when no API keys and no JWT secret are configured", () => {
    const config = loadConfig({ NODE_ENV: "production" }); // no API_KEYS, no JWT_SECRET
    expect(() => buildAuthConfig(config, silentLogger)).toThrow(
      InsecureProductionConfigError,
    );
  });

  it("does NOT throw in production when API keys are configured", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      API_KEYS: "secret-key:admin:tenant-1",
    });
    const auth = buildAuthConfig(config, silentLogger);
    expect(auth).toBeDefined();
    expect(auth?.apiKeys.has("secret-key")).toBe(true);
  });

  it("does NOT throw in production when a JWT secret is configured", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      JWT_SECRET: "a-production-jwt-secret",
    });
    const auth = buildAuthConfig(config, silentLogger);
    expect(auth).toBeDefined();
    expect(auth?.jwtSecret).toBe("a-production-jwt-secret");
  });

  it("STILL boots (returns undefined) in development with no credentials", () => {
    const config = loadConfig({ NODE_ENV: "development" });
    expect(() => buildAuthConfig(config, silentLogger)).not.toThrow();
    expect(buildAuthConfig(config, silentLogger)).toBeUndefined();
  });

  it("STILL boots (returns undefined) in test env with no credentials", () => {
    const config = loadConfig({ NODE_ENV: "test" });
    expect(buildAuthConfig(config, silentLogger)).toBeUndefined();
  });

  it("warns when falling through to the unsecured dev path", () => {
    const warnings: string[] = [];
    const logger = { info: () => {}, warn: (msg: unknown) => warnings.push(String(msg)) };
    const config = loadConfig({ NODE_ENV: "development" });
    buildAuthConfig(config, logger);
    expect(warnings.some((w) => /unsecured/i.test(w))).toBe(true);
  });
});

// =============================================================================
// A-NODE-002 — secured /metrics
// =============================================================================

describe("secured /metrics wiring (A-NODE-002)", () => {
  const authConfig = {
    apiKeys: new Map([
      ["k1", { key: "k1", role: "admin" as const, tenantId: "t1" }],
    ]),
  };

  it("requires auth for /metrics when metricsAuth is passed (mirrors main.ts)", async () => {
    const { app } = createApp({
      serviceConfig: { ownerId: "t1", defaultCurrency: "USDC", defaultDecimals: 6 },
      auth: authConfig,
      // main.ts now passes `metricsAuth: authConfig` whenever auth is configured.
      metricsAuth: authConfig,
    });

    const res = await app.request("/metrics");
    expect(res.status).toBe(401);

    const ok = await app.request("/metrics", { headers: { "X-Api-Key": "k1" } });
    expect(ok.status).toBe(200);
  });
});
