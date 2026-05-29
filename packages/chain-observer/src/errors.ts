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
  | "INVALID_QUERY";

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
