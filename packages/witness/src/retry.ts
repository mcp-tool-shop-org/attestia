/**
 * @attestia/witness — Retry with exponential backoff.
 *
 * Generic retry utility for transient failures. Used by XrplSubmitter
 * to retry XRPL transaction submissions.
 *
 * Backoff formula: min(baseDelayMs * 2^attempt + jitter, maxDelayMs)
 * where jitter = random(0, jitterMs)
 */

/**
 * Configuration for retry behavior.
 */
export interface RetryConfig {
  /** Maximum number of attempts (including the first try). Default: 3 */
  readonly maxAttempts: number;
  /** Base delay in ms before first retry. Default: 1000 */
  readonly baseDelayMs: number;
  /** Maximum delay in ms between retries. Default: 30000 */
  readonly maxDelayMs: number;
  /** Maximum random jitter in ms added to each delay. Default: 200 */
  readonly jitterMs: number;
}

/**
 * Default retry configuration.
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterMs: 200,
};

/**
 * Default per-attempt `submitAndWait` deadline in ms (PB-WCO-002).
 *
 * Chosen to comfortably exceed legitimate ledger validation (XRPL ledgers close
 * ~3-5s; a tx with the default LastLedgerSequence window validates well under a
 * minute) while still bounding a hung half-open-WebSocket poll that would
 * otherwise wait forever. Operators can tune via WitnessConfig.submitTimeoutMs.
 */
export const DEFAULT_SUBMIT_TIMEOUT_MS = 60_000;

/**
 * Error thrown when all retry attempts are exhausted.
 */
export class RetryExhaustedError extends Error {
  constructor(
    /** Number of attempts made */
    public readonly attempts: number,
    /** The last error encountered */
    public readonly lastError: unknown,
  ) {
    const msg = lastError instanceof Error ? lastError.message : String(lastError);
    super(`All ${attempts} retry attempts exhausted. Last error: ${msg}`);
    this.name = "RetryExhaustedError";
  }
}

/**
 * Sleep for the specified duration.
 * Extracted for testability — can be mocked in tests.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Error thrown when a per-attempt deadline elapses before the wrapped promise
 * settles (PB-WCO-002). The message is intentionally classified as RETRYABLE by
 * {@link isRetryableXrplError} ("timed out") so the submit retry loop fires —
 * and the next attempt's fixed-hash idempotency check (`_checkExistingTx`)
 * recovers a possibly-applied transaction instead of blindly resubmitting.
 */
export class AttemptTimeoutError extends Error {
  constructor(
    /** The deadline that elapsed, in ms. */
    public readonly timeoutMs: number,
    /** What operation timed out (e.g. "submitAndWait"). */
    public readonly operation: string,
  ) {
    super(
      `${operation} did not complete within the per-attempt deadline of ${timeoutMs}ms; ` +
      `treating as a (possibly-applied) transient — the next attempt's idempotency ` +
      `check will recover it if it landed (timed out).`,
    );
    this.name = "AttemptTimeoutError";
  }
}

/**
 * Race a promise-producing operation against a per-attempt deadline
 * (PB-WCO-002). If `fn` does not settle within `timeoutMs`, reject with an
 * {@link AttemptTimeoutError} so a hung call (e.g. a half-open XRPL WebSocket
 * where `submitAndWait` polls forever) cannot stall the retry loop indefinitely.
 *
 * IMPORTANT: this does NOT cancel the underlying operation (JS promises are not
 * cancellable) — it bounds how long the CALLER waits. For the idempotent,
 * fixed-hash submit path that is exactly what we want: a timed-out attempt is
 * retried, and the retry recognizes a lost-but-applied tx via its on-chain hash
 * check rather than resubmitting.
 *
 * A `timeoutMs <= 0` disables the deadline (awaits `fn` directly), preserving
 * the prior unbounded behavior when an operator opts out.
 *
 * @param fn The operation to run with a deadline.
 * @param timeoutMs The per-attempt deadline in ms (<= 0 disables).
 * @param operation Label for the error message.
 * @param scheduleTimer Injectable timer (for deterministic tests).
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  operation: string,
  scheduleTimer: (cb: () => void, ms: number) => { clear: () => void } = defaultTimer,
): Promise<T> {
  if (timeoutMs <= 0) {
    return fn();
  }

  let handle: { clear: () => void } | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    handle = scheduleTimer(() => reject(new AttemptTimeoutError(timeoutMs, operation)), timeoutMs);
  });

  try {
    return await Promise.race([fn(), timeout]);
  } finally {
    handle?.clear();
  }
}

/** Default timer for {@link withTimeout}, backed by setTimeout. */
function defaultTimer(cb: () => void, ms: number): { clear: () => void } {
  const id = setTimeout(cb, ms);
  // Don't keep the process alive solely for this deadline timer.
  (id as { unref?: () => void }).unref?.();
  return { clear: () => clearTimeout(id) };
}

/**
 * Compute the delay before the next retry attempt.
 *
 * @param attempt - Zero-based attempt index (0 = first retry)
 * @param config - Retry configuration
 * @returns Delay in milliseconds
 */
export function computeDelay(attempt: number, config: RetryConfig): number {
  const exponential = config.baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * config.jitterMs;
  return Math.min(exponential + jitter, config.maxDelayMs);
}

/**
 * Execute a function with retry on failure.
 *
 * @param fn - The async function to execute
 * @param config - Retry configuration
 * @param shouldRetry - Predicate to determine if an error is retryable (default: all errors)
 * @param sleepFn - Sleep function (injectable for testing)
 * @returns The result of the function
 * @throws RetryExhaustedError if all attempts fail
 * @throws The original error if shouldRetry returns false
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  shouldRetry: (err: unknown) => boolean = () => true,
  sleepFn: (ms: number) => Promise<void> = sleep,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;

      // Check if this error is retryable
      if (!shouldRetry(err)) {
        throw err;
      }

      // If this was the last attempt, don't sleep — just fall through to throw
      if (attempt < config.maxAttempts - 1) {
        const delay = computeDelay(attempt, config);
        await sleepFn(delay);
      }
    }
  }

  throw new RetryExhaustedError(config.maxAttempts, lastError);
}

/**
 * Default XRPL retry predicate.
 *
 * Returns true for transient/network errors that may succeed on retry.
 * Returns false for permanent errors that will never succeed.
 */
export function isRetryableXrplError(err: unknown): boolean {
  if (!(err instanceof Error)) return true;

  const msg = err.message.toLowerCase();

  // Permanent XRPL errors — do not retry
  const permanentPatterns = [
    "tembad",         // temBAD_AMOUNT, temBAD_FEE, etc.
    "tefinvalid",     // tefINVALID, etc.
    "tefdst_tag",     // tefDST_TAG_NEEDED
    "temmalformed",
    "temredundant",
    "not connected",  // Not connected — caller should reconnect, not retry blindly
  ];

  for (const pattern of permanentPatterns) {
    if (msg.includes(pattern)) return false;
  }

  // Everything else is potentially retryable (network errors, timeouts, tec codes)
  return true;
}
