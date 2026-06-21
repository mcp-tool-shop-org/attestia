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
  withTimeout,
  AttemptTimeoutError,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_SUBMIT_TIMEOUT_MS,
  isRetryableXrplError,
  type RetryConfig,
} from "./retry.js";
import { SubmitTelemetry } from "./telemetry.js";

export class XrplSubmitter {
  private client: XrplClient | null = null;
  private wallet: Wallet | null = null;
  private readonly config: WitnessConfig;
  private readonly retryConfig: RetryConfig;
  private readonly submitTimeoutMs: number;
  private readonly telemetry: SubmitTelemetry;

  constructor(config: WitnessConfig) {
    this.config = config;
    this.retryConfig = config.retry ?? DEFAULT_RETRY_CONFIG;
    this.submitTimeoutMs = config.submitTimeoutMs ?? DEFAULT_SUBMIT_TIMEOUT_MS;
    this.telemetry = new SubmitTelemetry(config.telemetry);
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

    // D3-B-001: emit submission telemetry. attempt (info) once up-front; a
    // submit.retry (warn) on each re-invocation of the retried callback; the
    // final submit outcome (ok|failed) with durationMs. txHash/ledgerIndex go in
    // the event message, never in low-cardinality attributes.
    const startedAt = Date.now();
    this.telemetry.attempt();

    // The callback is invoked once per attempt by withRetry. The first invocation
    // is the initial attempt; invocations 2..N are retries (emit submit.retry).
    let invocation = 0;

    try {
      const record = await withRetry(
        async () => {
          invocation += 1;
          if (invocation > 1) {
            this.telemetry.retry(invocation - 1);
          }
          return this._submitSigned(payload, client, signed.tx_blob, signed.hash, invocation);
        },
        this.retryConfig,
        isRetryableXrplError,
      );
      this.telemetry.final(
        "ok",
        Date.now() - startedAt,
        `witnessed txHash=${record.txHash} ledgerIndex=${record.ledgerIndex}`,
      );
      return record;
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      this.telemetry.final("failed", Date.now() - startedAt, `submission failed: ${detail}`);
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
   * Ensure the XRPL client is connected before a submit attempt (PB-WCO-003).
   *
   * If the WebSocket has dropped mid-run (`isConnected() === false`), attempt a
   * single best-effort reconnect and emit a distinct telemetry signal for the
   * drop and the reconnect outcome. The signed blob/hash are untouched, so
   * determinism and the fixed-hash idempotency guarantee are preserved. On a
   * failed reconnect we surface a clear, actionable error (instead of the bare
   * "not connected" the in-flight call would otherwise throw) so the host knows
   * to call connect().
   *
   * @param attempt 1-based attempt number (for telemetry).
   */
  private async _ensureConnected(attempt: number): Promise<void> {
    if (this.client?.isConnected() === true) {
      return;
    }
    if (!this.client) {
      // No client at all — surface the same actionable guidance.
      throw new Error(
        "XrplSubmitter: connection lost mid-submit and no client is present. Call connect() to recover.",
      );
    }
    try {
      await this.client.connect();
      this.telemetry.connectionLost("reconnected", attempt);
    } catch (err) {
      this.telemetry.connectionLost("failed", attempt);
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `XrplSubmitter: connection lost mid-submit and reconnect failed (${detail}). ` +
        `Call connect() to recover before submitting again.`,
      );
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
   * @param attempt 1-based attempt number (for per-attempt-timeout telemetry)
   */
  private async _submitSigned(
    payload: AttestationPayload,
    client: XrplClient,
    txBlob: string,
    txHash: string,
    attempt: number,
  ): Promise<WitnessRecord> {
    // PB-WCO-003: detect a connection dropped mid-run and attempt a single
    // best-effort reconnect BEFORE proceeding, rather than letting the attempt
    // throw a non-retryable "not connected" that silently bricks the submitter.
    // The signed blob + hash are unchanged (determinism preserved), and the
    // idempotency check below still runs after reconnect so a tx that applied
    // before the drop is recovered, never double-submitted.
    await this._ensureConnected(attempt);

    // Idempotency check: if the tx is already confirmed on-chain, return
    // the existing result instead of resubmitting (prevents duplicate
    // attestations when a retry fires after a successful-but-lost response).
    // This is ALSO the recovery path for a prior attempt that timed out
    // (PB-WCO-002): if the timed-out submit actually applied, we recognize the
    // fixed-hash tx here on the next attempt instead of double-submitting.
    const existing = await this._checkExistingTx(client, txHash);
    if (existing) {
      // D3-B-001: a lost-but-applied tx recovered via the fixed-hash check — a
      // critical operational signal (the submission "succeeded" on a path that
      // didn't return a response). Emit before returning the recovered record.
      this.telemetry.idempotentHit(`txHash=${txHash} ledgerIndex=${existing.ledgerIndex}`);
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

    // Submit and wait for validation, bounded by a per-attempt deadline
    // (PB-WCO-002). A hung submitAndWait (e.g. half-open WebSocket polling
    // forever) becomes an AttemptTimeoutError — classified retryable — so the
    // retry loop fires and the idempotency check above recovers a possibly-
    // applied tx on the next attempt. We do NOT resubmit within this attempt.
    let result;
    try {
      result = await withTimeout(
        () => client.submitAndWait(txBlob),
        this.submitTimeoutMs,
        "submitAndWait",
      );
    } catch (err) {
      if (err instanceof AttemptTimeoutError) {
        this.telemetry.submitTimeout(err.timeoutMs, attempt);
      }
      throw err;
    }

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
