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
} from "../observer.js";
import { ObserverError, classifyRpcError, toObserverError } from "../errors.js";

// =============================================================================
// XRPL Observer
// =============================================================================

export class XrplObserver implements ChainObserver {
  readonly chainId: string;
  private client: XrplClient | null = null;
  private readonly config: ObserverConfig;
  private readonly telemetry: Telemetry;

  constructor(config: ObserverConfig) {
    if (!config.chain.chainId.startsWith("xrpl:")) {
      throw new Error(
        `XrplObserver: expected XRPL chain ID (xrpl:*), got '${config.chain.chainId}'`
      );
    }
    this.chainId = config.chain.chainId;
    this.config = config;
    this.telemetry = config.telemetry ?? NOOP_TELEMETRY;
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

      const deliveredAmount = tx.DeliverMax ?? (tx as Record<string, unknown>).Amount;
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
   * Run an XRPL request, classifying and re-throwing any failure as a structured
   * {@link ObserverError} and emitting a `rpc` failure event (D3-B-003).
   *
   * @param context Operation name for the error message (e.g. "getBalance").
   * @param fn The request to execute.
   */
  private async runRpc<T>(context: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const observerError = toObserverError(err, `XrplObserver.${context}`, this.chainId);
      this.emitRpcFailure(observerError.code);
      throw observerError;
    }
  }
}
