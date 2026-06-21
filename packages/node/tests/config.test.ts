/**
 * Tests for config.ts — parseApiKeys + loadConfig.
 */

import { describe, it, expect } from "vitest";
import { parseApiKeys, loadConfig, ConfigError } from "../src/config.js";

// =============================================================================
// parseApiKeys
// =============================================================================

describe("parseApiKeys", () => {
  it("returns empty array for empty string", () => {
    expect(parseApiKeys("")).toEqual([]);
    expect(parseApiKeys("   ")).toEqual([]);
  });

  it("parses a single key entry", () => {
    const keys = parseApiKeys("abc123:admin:tenant-1");
    expect(keys).toEqual([
      { key: "abc123", role: "admin", tenantId: "tenant-1" },
    ]);
  });

  it("parses multiple comma-separated entries", () => {
    const keys = parseApiKeys("k1:admin:t1,k2:operator:t2,k3:viewer:t3");
    expect(keys).toHaveLength(3);
    expect(keys[0]).toEqual({ key: "k1", role: "admin", tenantId: "t1" });
    expect(keys[1]).toEqual({ key: "k2", role: "operator", tenantId: "t2" });
    expect(keys[2]).toEqual({ key: "k3", role: "viewer", tenantId: "t3" });
  });

  it("trims whitespace around entries", () => {
    const keys = parseApiKeys("  k1:admin:t1 , k2:viewer:t2  ");
    expect(keys).toHaveLength(2);
    expect(keys[0]!.key).toBe("k1");
    expect(keys[1]!.key).toBe("k2");
  });

  it("throws on wrong number of parts", () => {
    expect(() => parseApiKeys("badentry")).toThrow("Invalid API_KEYS entry");
    expect(() => parseApiKeys("a:b")).toThrow("Invalid API_KEYS entry");
    expect(() => parseApiKeys("a:b:c:d")).toThrow("Invalid API_KEYS entry");
  });

  it("throws on empty key", () => {
    expect(() => parseApiKeys(":admin:t1")).toThrow("API key cannot be empty");
  });

  it("throws on invalid role", () => {
    expect(() => parseApiKeys("k1:superuser:t1")).toThrow("Invalid role");
  });

  it("throws on empty tenant ID", () => {
    expect(() => parseApiKeys("k1:admin:")).toThrow(
      "Tenant ID cannot be empty",
    );
  });
});

// =============================================================================
// loadConfig
// =============================================================================

describe("loadConfig", () => {
  it("returns defaults when env is empty", () => {
    const config = loadConfig({});
    expect(config.PORT).toBe(3000);
    expect(config.HOST).toBe("0.0.0.0");
    expect(config.LOG_LEVEL).toBe("info");
    expect(config.NODE_ENV).toBe("development");
    expect(config.DEFAULT_CURRENCY).toBe("USDC");
    expect(config.DEFAULT_DECIMALS).toBe(6);
    expect(config.RATE_LIMIT_RPM).toBe(100);
  });

  it("parses overridden values", () => {
    const config = loadConfig({
      PORT: "8080",
      HOST: "127.0.0.1",
      LOG_LEVEL: "debug",
      NODE_ENV: "production",
    });
    expect(config.PORT).toBe(8080);
    expect(config.HOST).toBe("127.0.0.1");
    expect(config.LOG_LEVEL).toBe("debug");
    expect(config.NODE_ENV).toBe("production");
  });

  it("throws on invalid PORT", () => {
    expect(() => loadConfig({ PORT: "0" })).toThrow();
    expect(() => loadConfig({ PORT: "99999" })).toThrow();
  });
});

// =============================================================================
// B-NODE-009 [HUMANIZATION]: actionable ConfigError, not a raw ZodError dump.
// =============================================================================

describe("loadConfig error humanization (B-NODE-009)", () => {
  it("throws a branded ConfigError naming the bad variable", () => {
    try {
      loadConfig({ PORT: "not-a-number" });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const e = err as ConfigError;
      // The message lists the offending env var by name, not a raw issues array.
      expect(e.message).toContain("PORT");
      expect(e.issues.some((i) => i.startsWith("PORT:"))).toBe(true);
    }
  });

  it("collects multiple invalid variables into one actionable message", () => {
    try {
      loadConfig({ PORT: "0", DEFAULT_DECIMALS: "99" });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const e = err as ConfigError;
      const names = e.issues.map((i) => i.split(":")[0]);
      expect(names).toContain("PORT");
      expect(names).toContain("DEFAULT_DECIMALS");
    }
  });
});

// =============================================================================
// B-NODE-004 [HUMANIZATION]: WITNESS_ENABLED=true must carry URL+secret+address.
// =============================================================================

describe("WITNESS config validation (B-NODE-004)", () => {
  it("fails closed when WITNESS_ENABLED=true but URL/secret/address are missing", () => {
    try {
      loadConfig({ WITNESS_ENABLED: "true" });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const e = err as ConfigError;
      const names = e.issues.map((i) => i.split(":")[0]);
      expect(names).toContain("WITNESS_URL");
      expect(names).toContain("WITNESS_SECRET");
      expect(names).toContain("WITNESS_ADDRESS");
    }
  });

  it("accepts WITNESS_ENABLED=true when URL, secret, and address are all set", () => {
    const config = loadConfig({
      WITNESS_ENABLED: "true",
      WITNESS_URL: "wss://xrpl.example",
      WITNESS_SECRET: "s-secret",
      WITNESS_ADDRESS: "rEXAMPLE",
    });
    expect(config.WITNESS_ENABLED).toBe(true);
    expect(config.WITNESS_URL).toBe("wss://xrpl.example");
  });

  it("does not require witness vars when WITNESS_ENABLED is false (default)", () => {
    const config = loadConfig({});
    expect(config.WITNESS_ENABLED).toBe(false);
  });
});
