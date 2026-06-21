/**
 * Tests for the shared chain-observer RPC retry helper (PB-WCO-001, PB-WCO-004).
 *
 * Verifies:
 * - Success returns immediately (no retries).
 * - Transient classified failures (RATE_LIMITED / RPC_TIMEOUT / RPC_UNREACHABLE)
 *   are retried up to maxRetries, then the last error propagates.
 * - Non-retryable classes (RPC_ERROR / MALFORMED_RESPONSE / NOT_CONNECTED /
 *   caller errors) fail closed on the first try.
 * - Exponential backoff (delayMs * 2^attempt) via an injected sleep.
 * - onRetry hook fires per retry with { attempt, code, delayMs }.
 * - A throwing onRetry hook never breaks the retry loop.
 */

import { describe, it, expect, vi } from "vitest";
import { withRetry, isRetryableRpcError } from "../src/retry.js";

const noopSleep = async (_ms: number) => {};

describe("isRetryableRpcError", () => {
  it("returns true for transient classes", () => {
    expect(isRetryableRpcError(new Error("Request failed with status 429"))).toBe(true);
    expect(isRetryableRpcError(new Error("connect ETIMEDOUT 1.2.3.4:443"))).toBe(true);
    expect(isRetryableRpcError(new Error("fetch failed"))).toBe(true);
    expect(isRetryableRpcError(new Error("socket hang up"))).toBe(true);
    expect(isRetryableRpcError(new Error("WebSocket is not connected"))).toBe(true);
  });

  it("returns false for non-transient / caller-error classes", () => {
    // MALFORMED_RESPONSE — a deterministic decode failure won't self-heal.
    expect(isRetryableRpcError(new Error("Unexpected token < in JSON at position 0"))).toBe(false);
    // RPC_ERROR catch-all — unknown class, fail closed rather than hammer.
    expect(isRetryableRpcError(new Error("something weird happened"))).toBe(false);
    expect(isRetryableRpcError("a plain string")).toBe(false);
  });
});

describe("withRetry (shared)", () => {
  it("returns immediately on success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { maxRetries: 3, delayMs: 1, sleepFn: noopSleep });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure then succeeds", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("429 Too Many Requests"))
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValue("recovered");
    const result = await withRetry(fn, { maxRetries: 3, delayMs: 1, sleepFn: noopSleep });
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("propagates the last error after exhausting retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("connect ETIMEDOUT"));
    await expect(
      withRetry(fn, { maxRetries: 2, delayMs: 1, sleepFn: noopSleep }),
    ).rejects.toThrow("ETIMEDOUT");
    // 1 initial + 2 retries
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("fails closed on a non-retryable error (first try only)", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("Unexpected token < in JSON"));
    await expect(
      withRetry(fn, { maxRetries: 3, delayMs: 1, sleepFn: noopSleep }),
    ).rejects.toThrow("Unexpected token");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("honors a custom shouldRetry predicate", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("anything"));
    await expect(
      withRetry(fn, { maxRetries: 3, delayMs: 1, sleepFn: noopSleep, shouldRetry: () => false }),
    ).rejects.toThrow("anything");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("applies exponential backoff (delayMs * 2^attempt)", async () => {
    const delays: number[] = [];
    const fn = vi.fn().mockRejectedValue(new Error("fetch failed"));
    await expect(
      withRetry(fn, {
        maxRetries: 3,
        delayMs: 100,
        sleepFn: async (ms) => { delays.push(ms); },
      }),
    ).rejects.toThrow();
    // 3 retries → 3 sleeps: 100, 200, 400
    expect(delays).toEqual([100, 200, 400]);
  });

  it("fires onRetry per retry with attempt + classified code", async () => {
    const hits: Array<{ attempt: number; code: string }> = [];
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("429 Too Many Requests"))
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED"))
      .mockResolvedValue("ok");
    await withRetry(fn, {
      maxRetries: 3,
      delayMs: 1,
      sleepFn: noopSleep,
      onRetry: ({ attempt, code }) => hits.push({ attempt, code }),
    });
    expect(hits).toEqual([
      { attempt: 1, code: "RATE_LIMITED" },
      { attempt: 2, code: "RPC_UNREACHABLE" },
    ]);
  });

  it("a throwing onRetry hook never breaks the retry loop", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValue("ok");
    const result = await withRetry(fn, {
      maxRetries: 3,
      delayMs: 1,
      sleepFn: noopSleep,
      onRetry: () => { throw new Error("telemetry exploded"); },
    });
    expect(result).toBe("ok");
  });

  it("maxRetries=0 disables retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fetch failed"));
    await expect(
      withRetry(fn, { maxRetries: 0, delayMs: 1, sleepFn: noopSleep }),
    ).rejects.toThrow("fetch failed");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
