/**
 * Tests for witness timeout → retry → degraded behavior.
 *
 * Verifies that when the XRPL client times out, the submitter
 * retries and eventually throws WitnessSubmitError.
 */

import { describe, it, expect, vi } from "vitest";
import {
  withRetry,
  withTimeout,
  AttemptTimeoutError,
  RetryExhaustedError,
  isRetryableXrplError,
} from "../src/retry.js";
import type { RetryConfig } from "../src/retry.js";

const fastConfig: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 10,
  maxDelayMs: 100,
  jitterMs: 0,
};

const noopSleep = async (_ms: number) => {};

describe("witness timeout scenarios", () => {
  it("timeout error is retryable", () => {
    expect(isRetryableXrplError(new Error("Connection timeout"))).toBe(true);
    expect(isRetryableXrplError(new Error("ETIMEDOUT"))).toBe(true);
    expect(isRetryableXrplError(new Error("request timed out"))).toBe(true);
  });

  it("retries on timeout, succeeds on second attempt", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("Connection timeout"))
      .mockResolvedValueOnce("submitted");

    const result = await withRetry(fn, fastConfig, isRetryableXrplError, noopSleep);
    expect(result).toBe("submitted");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on timeout, exhausts all attempts", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("Connection timeout"));

    await expect(
      withRetry(fn, fastConfig, isRetryableXrplError, noopSleep),
    ).rejects.toThrow(RetryExhaustedError);

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("socket hang up is retryable", () => {
    expect(isRetryableXrplError(new Error("socket hang up"))).toBe(true);
  });

  it("ECONNREFUSED is retryable", () => {
    expect(isRetryableXrplError(new Error("ECONNREFUSED"))).toBe(true);
  });

  it("WebSocket closed before connected is retryable", () => {
    expect(
      isRetryableXrplError(
        new Error("WebSocket was closed before the connection was established"),
      ),
    ).toBe(true);
  });
});

describe("withTimeout (PB-WCO-002)", () => {
  // Deterministic timer: trigger the deadline synchronously when armed.
  function immediateTimer(cb: () => void, _ms: number) {
    cb();
    return { clear: () => {} };
  }
  // A timer that never fires (the operation should win).
  function neverTimer(_cb: () => void, _ms: number) {
    return { clear: () => {} };
  }

  it("resolves with the operation's value when it settles in time", async () => {
    const result = await withTimeout(
      () => Promise.resolve("done"),
      1000,
      "submitAndWait",
      neverTimer,
    );
    expect(result).toBe("done");
  });

  it("rejects with AttemptTimeoutError when the deadline elapses", async () => {
    const hung = new Promise<string>(() => {}); // never settles
    await expect(
      withTimeout(() => hung, 5000, "submitAndWait", immediateTimer),
    ).rejects.toBeInstanceOf(AttemptTimeoutError);
  });

  it("AttemptTimeoutError carries the deadline + operation and is RETRYABLE", async () => {
    const hung = new Promise<string>(() => {});
    let caught: unknown;
    try {
      await withTimeout(() => hung, 1234, "submitAndWait", immediateTimer);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AttemptTimeoutError);
    expect((caught as AttemptTimeoutError).timeoutMs).toBe(1234);
    expect((caught as AttemptTimeoutError).operation).toBe("submitAndWait");
    // Crucial: a timed-out attempt must be retried (the idempotency check then
    // recovers a possibly-applied tx), so it classifies as retryable.
    expect(isRetryableXrplError(caught)).toBe(true);
  });

  it("timeoutMs <= 0 disables the deadline (awaits the operation directly)", async () => {
    const result = await withTimeout(
      () => Promise.resolve("unbounded"),
      0,
      "submitAndWait",
      immediateTimer, // would fire if armed; it must NOT be armed when disabled
    );
    expect(result).toBe("unbounded");
  });
});
