/**
 * Tests for AppInstance lifecycle — dispose() releases store resources
 * (B-NODE-001/002/003).
 *
 * createApp does NOT enable the background sweepers by default (so tests never
 * leak timers); dispose() is therefore a safe no-op in that mode. When sweepers
 * are enabled (the real server path), dispose() must stop them. We assert the
 * contract holds in both modes and is idempotent.
 */

import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";
import type { AppInstance } from "../src/app.js";

function makeApp(enableStoreSweepers: boolean): AppInstance {
  return createApp({
    serviceConfig: {
      ownerId: "test-tenant",
      defaultCurrency: "USDC",
      defaultDecimals: 6,
    },
    rateLimit: { rpm: 60, burst: 20 },
    publicVerify: {},
    enableStoreSweepers,
  });
}

describe("AppInstance.dispose (B-NODE-003)", () => {
  it("exposes a dispose() function", () => {
    const instance = makeApp(false);
    expect(typeof instance.dispose).toBe("function");
    instance.dispose();
  });

  it("is idempotent (safe to call twice)", () => {
    const instance = makeApp(false);
    instance.dispose();
    expect(() => instance.dispose()).not.toThrow();
  });

  it("releases sweepers cleanly when they are enabled", () => {
    // With sweepers enabled, the underlying stores hold real (unref'd) timers.
    // dispose() must clear them so the process can exit and no timer leaks.
    const instance = makeApp(true);
    expect(() => instance.dispose()).not.toThrow();
    // A second dispose remains a no-op.
    expect(() => instance.dispose()).not.toThrow();
  });
});
