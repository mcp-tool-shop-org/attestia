/**
 * XRPL Submitter
 *
 * Submits attestation transactions to XRPL.
 * Each attestation is a 1-drop self-send Payment with memo data.
 *
 * Transaction flow:
 * 1. Build Payment transaction (self-send, 1 drop)
 * 2. Attach attestation memo
 * 3. Auto-fill sequence/fee
 * 4. Sign with witness account secret
 * 5. Submit and wait for validation (with retry on transient failures)
 *
 * The resulting transaction hash and ledger index are returned
 * as proof that the attestation was written on-chain.
 */

import { Client as XrplClient, Wallet } from "xrpl";
import type { Payment } from "xrpl";
import { encodeMemo } from "./memo-encoder.js";
import type { AttestationPayload, WitnessConfig, WitnessRecord, XrplMemo } from "./types.js";
import { WitnessSubmitError, resolveSecret } from "./types.js";
import {
  withRetry,
  DEFAULT_RETRY_CONFIG,
  isRetryableXrplError,
  type RetryConfig,
} from "./retry.js";

export class XrplSubmitter {
  private client: XrplClient | null = null;
  private wallet: Wallet | null = null;
  private readonly config: WitnessConfig;
  private readonly retryConfig: RetryConfig;

  constructor(config: WitnessConfig) {
    this.config = config;
    this.retryConfig = config.retry ?? DEFAULT_RETRY_CONFIG;
  }

  /**
   * Connect to the XRPL node and prepare the wallet.
   * Resolves the secret via SecretProvider if configured.
   */
  async connect(): Promise<void> {
    this.client = new XrplClient(this.config.rpcUrl, {
      timeout: this.config.timeoutMs ?? 30_000,
    });
    await this.client.connect();
    const secret = await resolveSecret(this.config.secret, this.config.account);
    this.wallet = Wallet.fromSeed(secret);
  }

  /**
   * Disconnect from the XRPL node.
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }
    this.wallet = null;
  }

  /**
   * Check whether the submitter is connected.
   */
  isConnected(): boolean {
    return this.client?.isConnected() === true && this.wallet !== null;
  }

  /**
   * Submit an attestation payload to XRPL with retry.
   *
   * Creates a 1-drop self-send Payment with the attestation encoded as a memo.
   * Waits for the transaction to be validated on-ledger.
   * Retries on transient failures with exponential backoff.
   *
   * @returns A WitnessRecord with the on-chain proof reference
   * @throws WitnessSubmitError if all retry attempts are exhausted
   * @throws Error if not connected (permanent, no retry)
   */
  async submit(payload: AttestationPayload): Promise<WitnessRecord> {
    if (!this.client || !this.wallet) {
      throw new Error("XrplSubmitter: not connected. Call connect() first.");
    }

    const client = this.client;
    const wallet = this.wallet;

    // Idempotency-critical: autofill + sign EXACTLY ONCE, before the retry loop.
    // This fixes Sequence + LastLedgerSequence (and therefore the transaction
    // hash). Retries then resubmit the SAME signed blob and check the SAME fixed
    // hash on-chain — so a lost-but-applied submission is recognized instead of
    // re-submitted as a duplicate fund-affecting transaction (D3-A-001).
    const memo: XrplMemo = encodeMemo(payload);
    const tx: Payment = {
      TransactionType: "Payment",
      Account: this.config.account,
      Destination: this.config.account, // Self-send
      Amount: "1", // 1 drop
      Memos: [
        {
          Memo: {
            MemoType: memo.MemoType,
            MemoData: memo.MemoData,
            ...(memo.MemoFormat ? { MemoFormat: memo.MemoFormat } : {}),
          },
        },
      ],
      ...(this.config.feeDrops ? { Fee: this.config.feeDrops } : {}),
    };

    const prepared = await client.autofill(tx);
    const signed = wallet.sign(prepared);

    try {
      return await withRetry(
        async () => this._submitSigned(payload, client, signed.tx_blob, signed.hash),
        this.retryConfig,
        isRetryableXrplError,
      );
    } catch (err: unknown) {
      // Wrap RetryExhaustedError in WitnessSubmitError for domain-specific error type
      if (err instanceof WitnessSubmitError) {
        throw err;
      }
      // RetryExhaustedError or non-retryable error
      const attempts = (err as { attempts?: number }).attempts ?? 1;
      throw new WitnessSubmitError(
        attempts,
        err,
        payload,
      );
    }
  }

  /**
   * Build a transaction without submitting (for dry-run / inspection).
   */
  buildTransaction(payload: AttestationPayload): {
    memo: XrplMemo;
    account: string;
    destination: string;
    amount: string;
  } {
    const memo = encodeMemo(payload);
    return {
      memo,
      account: this.config.account,
      destination: this.config.account,
      amount: "1",
    };
  }

  /**
   * Check if a transaction is already confirmed on-chain.
   * Returns ledger index if confirmed, null otherwise.
   */
  private async _checkExistingTx(
    client: XrplClient,
    txHash: string,
  ): Promise<{ ledgerIndex: number } | null> {
    try {
      const response = await client.request({
        command: "tx",
        transaction: txHash,
      });
      const result = response.result as unknown as Record<string, unknown>;
      if (result.validated === true) {
        const ledgerIndex = typeof result.ledger_index === "number"
          ? result.ledger_index
          : 0;
        return { ledgerIndex };
      }
      return null;
    } catch {
      // tx not found — proceed with submission
      return null;
    }
  }

  /**
   * Submit a single, already-signed transaction blob (one retry attempt).
   *
   * The blob and its hash are FIXED across retries (autofill + sign happen once
   * in {@link submit}). Each attempt first checks whether the fixed-hash tx is
   * already confirmed on-chain — if a previous attempt's response was lost but
   * the tx applied, we recognize it here instead of submitting a duplicate.
   *
   * @param payload The attestation payload (for the returned record)
   * @param client Connected XRPL client
   * @param txBlob The signed transaction blob (constant across retries)
   * @param txHash The signed transaction hash (constant across retries)
   */
  private async _submitSigned(
    payload: AttestationPayload,
    client: XrplClient,
    txBlob: string,
    txHash: string,
  ): Promise<WitnessRecord> {
    // Idempotency check: if the tx is already confirmed on-chain, return
    // the existing result instead of resubmitting (prevents duplicate
    // attestations when a retry fires after a successful-but-lost response).
    const existing = await this._checkExistingTx(client, txHash);
    if (existing) {
      return {
        id: `witness:${payload.hash.slice(0, 16)}`,
        payload,
        chainId: this.config.chainId,
        txHash,
        ledgerIndex: existing.ledgerIndex,
        witnessedAt: new Date().toISOString(),
        witnessAccount: this.config.account,
      };
    }

    // Submit and wait for validation
    const result = await client.submitAndWait(txBlob);

    const meta = result.result.meta;
    const ledgerIndex = typeof meta === "object" && meta !== null && "ledger_index" in meta
      ? (meta as Record<string, unknown>).ledger_index as number
      : result.result.ledger_index ?? 0;

    return {
      id: `witness:${payload.hash.slice(0, 16)}`,
      payload,
      chainId: this.config.chainId,
      txHash,
      ledgerIndex,
      witnessedAt: new Date().toISOString(),
      witnessAccount: this.config.account,
    };
  }
}
