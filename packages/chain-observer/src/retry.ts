/**
 * @attestia/chain-observer — Shared RPC retry with exponential backoff.
 *
 * A single retry discipline for ALL chain families (EVM, XRPL, Solana), so a
 * transient RPC blip is absorbed identically everywhere instead of failing the
 * first call on some chains and silently recovering on others (PB-WCO-001).
 *
 * Retryability is keyed on the stable {@link ObserverErrorCode} produced by
 * {@link classifyRpcError} — the SAME classifier observers already use to wrap
 * errors — rather than ad-hoc per-chain substring ladders. Only genuinely
 * transient classes are retried; everything else propagates immediately so a
 * permanent failure (bad params, unsupported chain) fails fast (fail-closed).
 *
 * Backoff: delayMs * 2^attempt (matching the prior Solana with-retry behavior),
 * so wiring the three families through this helper does not change their timing.
 */

import { classifyRpcError, type ObserverErrorCode } from "./errors.js";

/**
 * The RPC error classes that are transient and worth retrying.
 *
 * - RATE_LIMITED — HTTP 429 / JSON-RPC -32005; backing off is exactly the cure.
 * - RPC_TIMEOUT — the request didn't return in time; a retry may land.
 * - RPC_UNREACHABLE — DNS/connection/socket/websocket blips and LB failovers.
 *
 * NOT retried: MALFORMED_RESPONSE (a deterministic decode failure won't fix
 * itself), UNSUPPORTED_CHAIN / INVALID_QUERY / BLOCK_RANGE_TOO_LARGE (caller
 * errors), NOT_CONNECTED (lifecycle, not a wire blip), and the RPC_ERROR
 * catch-all (unknown class — fail closed rather than hammer an endpoint blindly).
 */
const RETRYABLE_CODES: ReadonlySet<ObserverErrorCode> = new Set<ObserverErrorCode>([
  "RATE_LIMITED",
  "RPC_TIMEOUT",
  "RPC_UNREACHABLE",
]);

/**
 * Whether a caught provider error is a transient RPC failure worth retrying.
 * Classifies via {@link classifyRpcError} and checks membership in
 * {@link RETRYABLE_CODES}.
 */
export function isRetryableRpcError(err: unknown): boolean {
  return RETRYABLE_CODES.has(classifyRpcError(err));
}

/**
 * Per-retry hook, invoked just before sleeping ahead of the next attempt.
 *
 * @param info.attempt 1-based retry number (1 = first retry after the initial try).
 * @param info.code The classified {@link ObserverErrorCode} of the failure being retried.
 * @param info.delayMs The backoff about to be slept.
 */
export type RetryHook = (info: {
  attempt: number;
  code: ObserverErrorCode;
  delayMs: number;
}) => void;

/**
 * Options for {@link withRetry}.
 */
export interface RetryOptions {
  /** Maximum number of retry attempts after the first try (0 = no retries). */
  readonly maxRetries: number;
  /** Base delay in ms; backoff is delayMs * 2^attempt. */
  readonly delayMs: number;
  /**
   * Predicate deciding whether an error is retryable. Defaults to
   * {@link isRetryableRpcError} (classified-transient codes only).
   */
  readonly shouldRetry?: (err: unknown) => boolean;
  /** Invoked before each backoff sleep (for retry telemetry). */
  readonly onRetry?: RetryHook;
  /** Sleep function — injectable for deterministic tests. */
  readonly sleepFn?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an async RPC operation with exponential-backoff retry on transient
 * failures. Non-retryable errors (per {@link RetryOptions.shouldRetry}) and the
 * final failure after exhausting retries both propagate unchanged, so the
 * caller's existing error-wrapping (`toObserverError`) still classifies them.
 *
 * @param fn The RPC call to execute.
 * @param opts Retry configuration.
 * @returns The result of `fn`.
 * @throws The last error if all retries are exhausted, or immediately if the
 *   error is not retryable.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const shouldRetry = opts.shouldRetry ?? isRetryableRpcError;
  const sleepFn = opts.sleepFn ?? defaultSleep;
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;

      // Don't retry non-retryable errors — fail closed immediately.
      if (!shouldRetry(err)) {
        throw err;
      }

      // Don't wait after the final attempt.
      if (attempt < opts.maxRetries) {
        const delayMs = opts.delayMs * Math.pow(2, attempt);
        if (opts.onRetry) {
          try {
            opts.onRetry({ attempt: attempt + 1, code: classifyRpcError(err), delayMs });
          } catch {
            /* a retry hook (telemetry) must never break the retry loop */
          }
        }
        await sleepFn(delayMs);
      }
    }
  }

  throw lastError;
}
