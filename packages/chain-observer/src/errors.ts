/**
 * Structured observer errors.
 *
 * Observer failures are surfaced as `ObserverError` with a stable machine-readable
 * `code`, a human-readable `message`, and an actionable `hint`. This follows the
 * structured-error shape used across Attestia (code / message / hint) so callers
 * can branch on `code` without string-matching messages.
 */

/**
 * Stable error codes for observer failures.
 */
export type ObserverErrorCode =
  /** A requested block range exceeds the allowed span (DoS / RPC-rejection guard). */
  | "BLOCK_RANGE_TOO_LARGE"
  /** A query was structurally invalid (e.g. fromBlock > toBlock). */
  | "INVALID_QUERY"
  /** A query was issued before {@link ChainObserver.connect} succeeded. */
  | "NOT_CONNECTED"
  /** The RPC request exceeded its deadline. */
  | "RPC_TIMEOUT"
  /** The RPC endpoint could not be reached (DNS, connection refused, socket closed). */
  | "RPC_UNREACHABLE"
  /** The RPC endpoint returned a rate-limit response (HTTP 429 / -32005). */
  | "RATE_LIMITED"
  /** The configured chain is not supported by this observer. */
  | "UNSUPPORTED_CHAIN"
  /** The RPC response was missing, malformed, or otherwise unparseable. */
  | "MALFORMED_RESPONSE"
  /** An RPC failure that did not match a more specific classification. */
  | "RPC_ERROR";

/**
 * A structured error thrown by chain observers.
 */
export class ObserverError extends Error {
  /** Stable machine-readable error code. */
  readonly code: ObserverErrorCode;

  /** Actionable hint for resolving the error. */
  readonly hint: string;

  /** The chain this error relates to, if known. */
  readonly chainId?: string;

  constructor(args: {
    code: ObserverErrorCode;
    message: string;
    hint: string;
    chainId?: string;
  }) {
    super(args.message);
    this.name = "ObserverError";
    this.code = args.code;
    this.hint = args.hint;
    if (args.chainId !== undefined) {
      this.chainId = args.chainId;
    }
  }
}

/**
 * Best-effort hint text for a classified RPC error code.
 * Used when wrapping a caught provider error in an {@link ObserverError}.
 */
const RPC_ERROR_HINTS: Record<ObserverErrorCode, string> = {
  BLOCK_RANGE_TOO_LARGE: "Narrow the block range or chunk the scan into smaller windows.",
  INVALID_QUERY: "Check the query parameters (e.g. fromBlock must be <= toBlock).",
  NOT_CONNECTED: "Call connect() and await it before issuing queries.",
  RPC_TIMEOUT:
    "The RPC endpoint did not respond in time. Increase timeoutMs, retry, or use a faster endpoint.",
  RPC_UNREACHABLE:
    "The RPC endpoint could not be reached. Verify the rpcUrl, network connectivity, and that the node is up.",
  RATE_LIMITED:
    "The RPC endpoint is rate-limiting requests. Back off and retry, or use a higher-tier/dedicated endpoint.",
  UNSUPPORTED_CHAIN: "Use a supported chain ID, or register a profile for this chain.",
  MALFORMED_RESPONSE:
    "The RPC endpoint returned an unexpected response shape. Verify it is a compatible node for this chain.",
  RPC_ERROR: "Inspect the underlying error message and the RPC endpoint health.",
};

/**
 * Classify a caught provider error (viem / xrpl.js / @solana/web3.js, or a
 * raw network error) into a stable {@link ObserverErrorCode}.
 *
 * Classification is intentionally conservative and string-based: the underlying
 * libraries do not expose a uniform machine-readable error taxonomy, so we match
 * on well-known substrings (HTTP status codes, error names, socket error codes).
 * Anything unrecognized falls back to {@link "RPC_ERROR"} so a code is *always*
 * produced — the goal is to stop surfacing raw, unclassified provider errors.
 *
 * @param err The caught error (any thrown value).
 * @returns A stable error code describing the failure class.
 */
export function classifyRpcError(err: unknown): ObserverErrorCode {
  const name = err instanceof Error ? err.name.toLowerCase() : "";
  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.toLowerCase();

  // Rate limiting — HTTP 429 or JSON-RPC -32005 ("limit exceeded").
  if (
    msg.includes("429") ||
    msg.includes("too many requests") ||
    msg.includes("rate limit") ||
    msg.includes("rate-limit") ||
    msg.includes("-32005") ||
    msg.includes("limit exceeded")
  ) {
    return "RATE_LIMITED";
  }

  // Timeouts — viem TimeoutError, xrpl TimeoutError, generic ETIMEDOUT.
  if (
    name.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    msg.includes("etimedout")
  ) {
    return "RPC_TIMEOUT";
  }

  // Unreachable — DNS, connection refused, socket reset/closed, fetch failed.
  if (
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("econnreset") ||
    msg.includes("eai_again") ||
    msg.includes("ehostunreach") ||
    msg.includes("enetunreach") ||
    msg.includes("socket hang up") ||
    msg.includes("fetch failed") ||
    msg.includes("network error") ||
    msg.includes("connection closed") ||
    msg.includes("not connected") ||
    msg.includes("websocket") ||
    msg.includes("disconnected")
  ) {
    return "RPC_UNREACHABLE";
  }

  // Malformed / unexpected response shape.
  if (
    name.includes("syntax") ||
    msg.includes("unexpected token") ||
    msg.includes("invalid json") ||
    msg.includes("malformed") ||
    msg.includes("cannot read properties") ||
    msg.includes("is not valid json")
  ) {
    return "MALFORMED_RESPONSE";
  }

  return "RPC_ERROR";
}

/**
 * Wrap a caught provider error in a structured {@link ObserverError},
 * classifying it via {@link classifyRpcError} and attaching an actionable hint.
 *
 * The original error message is preserved in the wrapped message (so detail is
 * never lost), and the original error is attached as {@link Error.cause}.
 *
 * @param err The caught error.
 * @param context Where the failure occurred (e.g. "getBalance"), included in the message.
 * @param chainId The chain this error relates to, if known.
 * @returns A structured ObserverError with a stable code.
 */
export function toObserverError(
  err: unknown,
  context: string,
  chainId?: string,
): ObserverError {
  // Already structured — pass through unchanged (don't double-wrap).
  if (err instanceof ObserverError) {
    return err;
  }
  const code = classifyRpcError(err);
  const detail = err instanceof Error ? err.message : String(err);
  const observerError = new ObserverError({
    code,
    message: `${context}: ${detail}`,
    hint: RPC_ERROR_HINTS[code],
    ...(chainId !== undefined ? { chainId } : {}),
  });
  // Preserve the original error for debugging without leaking it to callers
  // that only branch on `.code`.
  if (err !== undefined) {
    (observerError as { cause?: unknown }).cause = err;
  }
  return observerError;
}
