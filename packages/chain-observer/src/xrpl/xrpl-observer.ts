/**
 * XRPL Observer — Read-only XRP Ledger observer.
 *
 * Uses xrpl.js for all ledger interactions.
 * Connects via WebSocket to XRPL nodes.
 *
 * Capabilities:
 * - Native XRP balance
 * - Trust line (issued token) balances
 * - Transaction history scanning for transfers
 *
 * Non-capabilities (by design):
 * - No signing
 * - No transaction submission
 * - No trust line creation
 * - No state modification
 *
 * XRPL-specific notes:
 * - XRP amounts are in "drops" (1 XRP = 1,000,000 drops)
 * - Issued tokens use trust lines, not contracts
 * - XRPL uses WebSocket connections, not HTTP polling
 */

import { Client as XrplClient } from "xrpl";
import { type Telemetry, NOOP_TELEMETRY } from "@attestia/types";
import type {
  ChainObserver,
  ObserverConfig,
  BalanceQuery,
  BalanceResult,
  TokenBalanceQuery,
  TokenBalance,
  TransferQuery,
  TransferEvent,
  ConnectionStatus,
  RpcRetryConfig,
} from "../observer.js";
import { DEFAULT_RPC_RETRY } from "../observer.js";
import { ObserverError, classifyRpcError, toObserverError } from "../errors.js";
import { withRetry } from "../retry.js";

/**
 * tfPartialPayment transaction flag (0x00020000).
 *
 * When set on a Payment, `Amount`/`DeliverMax` is only the *intended maximum* —
 * the actual delivered amount is reported in transaction metadata as
 * `delivered_amount`. See A-CO-001 in {@link XrplObserver.getTransfers}.
 */
const TF_PARTIAL_PAYMENT = 0x00020000;

// =============================================================================
// XRPL Observer
// =============================================================================

export class XrplObserver implements ChainObserver {
  readonly chainId: string;
  private client: XrplClient | null = null;
  private readonly config: ObserverConfig;
  private readonly telemetry: Telemetry;
  private readonly retryConfig: RpcRetryConfig;

  constructor(config: ObserverConfig) {
    if (!config.chain.chainId.startsWith("xrpl:")) {
      throw new Error(
        `XrplObserver: expected XRPL chain ID (xrpl:*), got '${config.chain.chainId}'`
      );
    }
    this.chainId = config.chain.chainId;
    this.config = config;
    this.telemetry = config.telemetry ?? NOOP_TELEMETRY;
    this.retryConfig = config.retry ?? DEFAULT_RPC_RETRY;
  }

  async connect(): Promise<void> {
    this.client = new XrplClient(this.config.rpcUrl, {
      timeout: this.config.timeoutMs ?? 30_000,
    });
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }
  }

  async getStatus(): Promise<ConnectionStatus> {
    const now = new Date().toISOString();
    if (!this.client?.isConnected()) {
      return {
        chainId: this.chainId,
        connected: false,
        checkedAt: now,
        error: "XrplObserver: not connected. Call connect() before querying.",
        errorCode: "NOT_CONNECTED",
      };
    }

    try {
      const response = await this.client.request({
        command: "ledger",
        ledger_index: "validated",
      });

      return {
        chainId: this.chainId,
        connected: true,
        latestBlock: response.result.ledger_index,
        checkedAt: now,
      };
    } catch (err) {
      // Surface WHY the probe failed instead of an unexplained connected:false
      // (D3-B-002). A health probe must not throw, so we return rather than rethrow.
      return {
        chainId: this.chainId,
        connected: false,
        checkedAt: now,
        error: err instanceof Error ? err.message : String(err),
        errorCode: classifyRpcError(err),
      };
    }
  }

  async getBalance(query: BalanceQuery): Promise<BalanceResult> {
    const client = this.requireClient();

    const response = await this.runRpc("getBalance", () =>
      client.request({
        command: "account_info",
        account: query.address,
        ledger_index: query.atBlock !== undefined ? query.atBlock : "validated",
      }),
    );

    const accountData = response.result.account_data;
    const balance = typeof accountData.Balance === "string"
      ? accountData.Balance
      : String(accountData.Balance);

    return {
      chainId: this.chainId,
      address: query.address,
      balance,
      decimals: 6, // XRP uses drops (6 decimal places)
      symbol: "XRP",
      atBlock: response.result.ledger_index ?? 0,
      observedAt: new Date().toISOString(),
    };
  }

  async getTokenBalance(query: TokenBalanceQuery): Promise<TokenBalance> {
    const client = this.requireClient();

    if (!query.issuer) {
      throw new ObserverError({
        code: "INVALID_QUERY",
        chainId: this.chainId,
        message:
          "XrplObserver.getTokenBalance: 'issuer' is required for XRPL token queries",
        hint: "Provide the token issuer's r-address in query.issuer.",
      });
    }

    // Capture the narrowed (non-undefined) issuer so the closure preserves the
    // `peer: string` type (exactOptionalPropertyTypes) and account_lines typing.
    const issuer: string = query.issuer;
    const response = await this.runRpc("getTokenBalance", () =>
      client.request({
        command: "account_lines",
        account: query.address,
        peer: issuer,
      }),
    );

    const lines = response.result.lines;
    const line = lines.find(
      (l: { currency: string }) => l.currency === query.token
    );

    if (!line) {
      return {
        chainId: this.chainId,
        address: query.address,
        token: query.token,
        symbol: query.token,
        balance: "0",
        decimals: 15, // XRPL issued tokens have up to 15 significant digits
        observedAt: new Date().toISOString(),
      };
    }

    return {
      chainId: this.chainId,
      address: query.address,
      token: query.token,
      symbol: query.token,
      balance: line.balance,
      decimals: 15,
      observedAt: new Date().toISOString(),
    };
  }

  async getTransfers(query: TransferQuery): Promise<readonly TransferEvent[]> {
    const client = this.requireClient();

    const response = await this.runRpc("getTransfers", () =>
      client.request({
        command: "account_tx",
        account: query.address,
        ledger_index_min: query.fromBlock ?? -1,
        ledger_index_max: query.toBlock ?? -1,
        limit: query.limit ?? 100,
      }),
    );

    const events: TransferEvent[] = [];
    const now = new Date().toISOString();

    for (const txEntry of response.result.transactions) {
      const tx = txEntry.tx_json;
      if (!tx || tx.TransactionType !== "Payment") continue;

      const from = tx.Account ?? "";
      const to = tx.Destination ?? "";

      // Direction filter
      if (query.direction === "incoming" && to !== query.address) continue;
      if (query.direction === "outgoing" && from !== query.address) continue;

      // Parse amount
      let amount: string;
      let symbol: string;
      let decimals: number;
      let token: string | undefined;

      // A-CO-001: On XRPL both `Amount` and `DeliverMax` are the INTENDED MAXIMUM,
      // not what was actually delivered. For a tfPartialPayment (Flags & 0x00020000)
      // the real delivered amount is far smaller and is reported ONLY in the
      // transaction metadata as `meta.delivered_amount` (or deprecated
      // `meta.DeliveredAmount`). Reading Amount/DeliverMax for a partial payment
      // over-states received funds. So: branch on the partial-payment flag, read
      // the delivered amount from metadata for partials, and only trust
      // Amount/DeliverMax when the tx is NOT a partial payment.
      const flags = typeof tx.Flags === "number" ? tx.Flags : 0;
      const isPartialPayment = (flags & TF_PARTIAL_PAYMENT) !== 0;

      let deliveredAmount: unknown = tx.DeliverMax ?? (tx as Record<string, unknown>).Amount;

      if (isPartialPayment) {
        // `delivered_amount` (and the deprecated `DeliveredAmount`) are reported
        // on the transaction metadata object but are not in xrpl.js's typed
        // metadata shape, so read through `unknown`. `meta` may also be a string
        // when account_tx is requested in binary mode — guard for the object form.
        const rawMeta = (txEntry as { meta?: unknown }).meta;
        const meta =
          rawMeta && typeof rawMeta === "object"
            ? (rawMeta as Record<string, unknown>)
            : undefined;
        const metaDelivered =
          meta?.delivered_amount ?? meta?.DeliveredAmount;

        // The ledger reports `"unavailable"` when the delivered amount cannot be
        // determined (e.g. pre-2014 partial payments). We MUST fail closed here —
        // substituting the requested Amount/DeliverMax would over-state funds,
        // which is exactly the bug this guard prevents.
        if (metaDelivered === "unavailable") {
          throw new ObserverError({
            code: "MALFORMED_RESPONSE",
            chainId: this.chainId,
            message:
              `XrplObserver.getTransfers: partial payment ${txEntry.hash ?? "<unknown>"} ` +
              `reports delivered_amount "unavailable"; the actual delivered amount ` +
              `cannot be determined and must not be inferred from DeliverMax/Amount.`,
            hint:
              "This transaction predates reliable delivered_amount reporting. " +
              "Resolve the delivered amount from a full ledger/metadata source, or exclude it.",
          });
        }

        // For a partial payment, the delivered amount lives in metadata only.
        // If metadata is absent, fail closed rather than fall back to the ceiling.
        if (metaDelivered === undefined || metaDelivered === null) {
          throw new ObserverError({
            code: "MALFORMED_RESPONSE",
            chainId: this.chainId,
            message:
              `XrplObserver.getTransfers: partial payment ${txEntry.hash ?? "<unknown>"} ` +
              `is missing delivered_amount in transaction metadata.`,
            hint:
              "Ensure account_tx returns metadata (non-binary) so delivered_amount is available.",
          });
        }

        deliveredAmount = metaDelivered;
      }

      if (typeof deliveredAmount === "string") {
        // Native XRP (in drops)
        amount = deliveredAmount;
        symbol = "XRP";
        decimals = 6;
      } else if (
        deliveredAmount &&
        typeof deliveredAmount === "object" &&
        "value" in deliveredAmount
      ) {
        // Issued token
        const issued = deliveredAmount as {
          value: string;
          currency: string;
          issuer: string;
        };
        amount = issued.value;
        symbol = issued.currency;
        decimals = 15;
        token = `${issued.currency}:${issued.issuer}`;

        // Currency filter
        if (query.token && issued.currency !== query.token) continue;
      } else {
        continue;
      }

      const baseEvent = {
        chainId: this.chainId,
        txHash: txEntry.hash ?? "",
        blockNumber: txEntry.ledger_index ?? 0,
        from,
        to,
        amount,
        decimals,
        symbol,
        timestamp: tx.date
          ? new Date((tx.date as number + 946684800) * 1000).toISOString() // Ripple epoch offset
          : now,
        observedAt: now,
      };
      events.push(
        token !== undefined ? { ...baseEvent, token } : baseEvent
      );
    }

    return events;
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private requireClient(): XrplClient {
    if (!this.client || !this.client.isConnected()) {
      const err = new ObserverError({
        code: "NOT_CONNECTED",
        chainId: this.chainId,
        message: "XrplObserver: not connected. Call connect() before querying.",
        hint: "Call connect() and await it before issuing queries.",
      });
      this.emitRpcFailure("NOT_CONNECTED");
      throw err;
    }
    return this.client;
  }

  /**
   * Emit a structured `rpc` failure telemetry event with low-cardinality
   * attributes (`chainId`, `code`). Never throws.
   */
  private emitRpcFailure(code: string): void {
    try {
      this.telemetry.record({
        package: "@attestia/chain-observer",
        op: "rpc",
        level: "error",
        outcome: "failed",
        attributes: { chainId: this.chainId, code },
      });
    } catch {
      /* observability must never throw into the caller */
    }
  }

  /**
   * Emit a structured `rpc.retry` event (outcome `"degraded"`, level `warn`)
   * when a transient XRPL request failure is about to be retried (PB-WCO-004).
   * Low-cardinality attributes only (`chainId`, `code`, `attempt`). Never throws.
   */
  private emitRpcRetry(code: string, attempt: number): void {
    try {
      this.telemetry.record({
        package: "@attestia/chain-observer",
        op: "rpc.retry",
        level: "warn",
        outcome: "degraded",
        attributes: { chainId: this.chainId, code, attempt },
        message: `XrplObserver: retrying transient RPC failure (${code}) on ${this.chainId}, attempt ${attempt}`,
      });
    } catch {
      /* observability must never throw into the caller */
    }
  }

  /**
   * Run an XRPL request under the shared retry-with-backoff discipline
   * (PB-WCO-001): transient classified failures (RATE_LIMITED / RPC_TIMEOUT /
   * RPC_UNREACHABLE) are retried, all other classes fail closed immediately.
   * The FINAL failure (after retries) is classified and re-thrown as a
   * structured {@link ObserverError} with a `rpc` failure event (D3-B-003); each
   * retry emits an `rpc.retry` event (PB-WCO-004).
   *
   * NOTE: an XRPL "not connected" / disconnected blip classifies as
   * RPC_UNREACHABLE and IS retried here — xrpl.js can transparently reconnect a
   * dropped client between attempts, so a brief WebSocket drop during a read is
   * absorbed rather than failing the call outright.
   *
   * @param context Operation name for the error message (e.g. "getBalance").
   * @param fn The request to execute.
   */
  private async runRpc<T>(context: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await withRetry(fn, {
        maxRetries: this.retryConfig.maxRetries,
        delayMs: this.retryConfig.delayMs,
        onRetry: ({ attempt, code }) => this.emitRpcRetry(code, attempt),
      });
    } catch (err) {
      const observerError = toObserverError(err, `XrplObserver.${context}`, this.chainId);
      this.emitRpcFailure(observerError.code);
      throw observerError;
    }
  }
}
