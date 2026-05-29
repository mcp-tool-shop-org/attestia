/**
 * Multi-Sig XRPL Submitter
 *
 * Like XrplSubmitter but accepts multiple signers for N-of-M governance.
 * Builds the same 1-drop self-payment with attestation memo, but collects
 * signatures from N signers and combines them via XRPL multi-sign format.
 *
 * Design:
 * - Fail-closed: quorum must be met before submission
 * - Timestamps normalized to UTC
 * - Uses existing withRetry() for transient failure resilience
 * - Compatible with existing XrplSubmitter memo format
 */

import { Client as XrplClient, Wallet, multisign, decode } from "xrpl";
import type { Payment, Transaction } from "xrpl";
import { encodeMemo } from "../memo-encoder.js";
import type { AttestationPayload, WitnessRecord, XrplMemo, SecretProvider } from "../types.js";
import { WitnessSubmitError, resolveSecret } from "../types.js";
import {
  withRetry,
  DEFAULT_RETRY_CONFIG,
  isRetryableXrplError,
  type RetryConfig,
} from "../retry.js";
import { SubmitTelemetry } from "../telemetry.js";
import type { Telemetry } from "@attestia/types";
import {
  buildCanonicalSigningPayload,
  aggregateSignatures,
  signPayloadHash,
  xrplSignatureVerifier,
  type SignerSignature,
} from "./signing.js";
import type { GovernancePolicy } from "./types.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for a single signer in the multi-sig set.
 */
export interface SignerConfig {
  /** Signer's XRPL address */
  readonly address: string;

  /**
   * Signer's secret/seed for signing.
   * Accepts a plain string (backward compatible) or a SecretProvider
   * for vault-backed secret management.
   */
  readonly secret: string | SecretProvider;
}

/**
 * Configuration for the multi-sig submitter.
 */
export interface MultiSigConfig {
  /** XRPL WebSocket endpoint */
  readonly rpcUrl: string;

  /** XRPL chain identifier (e.g. "xrpl:testnet") */
  readonly chainId: string;

  /** The multi-sig master account (the account that sends the transaction) */
  readonly account: string;

  /** Signer configurations for each participant */
  readonly signers: readonly SignerConfig[];

  /** Optional fee in drops */
  readonly feeDrops?: string;

  /** Optional connection timeout */
  readonly timeoutMs?: number;

  /** Optional retry configuration */
  readonly retry?: RetryConfig;

  /**
   * Optional telemetry sink for structured observability events.
   *
   * When omitted, the submitter emits nothing (default NOOP). When provided, it
   * emits the same `submit` / `submit.retry` / `submit.idempotent_hit` events as
   * the single-sig {@link XrplSubmitter}, under package `"@attestia/witness"`.
   * txHash/ledgerIndex go in the event `message`, never in `attributes`.
   */
  readonly telemetry?: Telemetry;
}

/**
 * Result of collecting signatures from multiple signers.
 */
export interface MultiSignResult {
  /** The signed transaction blobs from each signer */
  readonly signedBlobs: readonly string[];

  /** Signer signatures (for governance aggregation) */
  readonly signerSignatures: readonly SignerSignature[];

  /** The combined multi-signed transaction blob */
  readonly combinedBlob: string;

  /**
   * The expected on-chain transaction hash for the combined multi-signed tx.
   * Fixed once the prepared transaction is autofilled+signed; used for the
   * idempotency / replay existence check across retries (D3-A-002).
   */
  readonly txHash: string;
}

// =============================================================================
// MultiSigSubmitter
// =============================================================================

export class MultiSigSubmitter {
  private client: XrplClient | null = null;
  private wallets: Map<string, Wallet> = new Map();
  private readonly config: MultiSigConfig;
  private readonly retryConfig: RetryConfig;
  private readonly telemetry: SubmitTelemetry;

  constructor(config: MultiSigConfig) {
    this.config = config;
    this.retryConfig = config.retry ?? DEFAULT_RETRY_CONFIG;
    this.telemetry = new SubmitTelemetry(config.telemetry);
  }

  /**
   * Connect to the XRPL node and prepare all signer wallets.
   */
  async connect(): Promise<void> {
    this.client = new XrplClient(this.config.rpcUrl, {
      timeout: this.config.timeoutMs ?? 30_000,
    });
    await this.client.connect();

    this.wallets.clear();
    for (const signer of this.config.signers) {
      const secret = await resolveSecret(signer.secret, signer.address);
      const wallet = Wallet.fromSeed(secret);

      // D3-A-004: bind the secret to the configured signer identity. A secret
      // that derives to a DIFFERENT address must not be silently counted as
      // this policy signer. Fail closed on mismatch.
      if (wallet.classicAddress !== signer.address) {
        throw new Error(
          `MultiSigSubmitter: signer secret/address mismatch — secret for configured ` +
          `address ${signer.address} derives to ${wallet.classicAddress}. ` +
          `Refusing to connect (a key for a different address cannot act as this signer).`,
        );
      }

      // Key wallets by the wallet's own derived address (the verified identity),
      // not the config-supplied string.
      this.wallets.set(wallet.classicAddress, wallet);
    }
  }

  /**
   * Disconnect from the XRPL node.
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }
    this.wallets.clear();
  }

  /**
   * Check whether the submitter is connected.
   */
  isConnected(): boolean {
    return this.client?.isConnected() === true && this.wallets.size > 0;
  }

  /**
   * Submit an attestation with multi-sig signatures.
   *
   * 1. Builds the 1-drop self-send transaction with attestation memo
   * 2. Each signer independently signs the prepared transaction
   * 3. Signatures are aggregated and quorum is verified
   * 4. The combined multi-signed transaction is submitted
   *
   * @param payload The attestation payload
   * @param policy The governance policy (for quorum verification)
   * @returns WitnessRecord with on-chain proof reference
   * @throws WitnessSubmitError if submission fails after retries
   * @throws Error if quorum is not met or not connected
   */
  async submit(
    payload: AttestationPayload,
    policy: GovernancePolicy,
  ): Promise<WitnessRecord> {
    if (!this.client || this.wallets.size === 0) {
      throw new Error("MultiSigSubmitter: not connected. Call connect() first.");
    }

    const client = this.client;

    // Idempotency-critical (D3-A-002): autofill, collect signatures, verify
    // quorum, and combine the multi-signed blob EXACTLY ONCE — before the retry
    // loop. This fixes Sequence + LastLedgerSequence and therefore the on-chain
    // transaction hash. Retries then resubmit the SAME combined blob and check
    // the SAME fixed hash (and payload.hash memo) on-chain, so a lost-but-applied
    // submission is recognized instead of double-submitted.
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
    const multiSignResult = this.buildMultiSign(payload, policy, prepared);

    // D3-B-001: emit submission telemetry (same shape as single-sig submitter).
    const startedAt = Date.now();
    this.telemetry.attempt();

    let invocation = 0;

    try {
      const record = await withRetry(
        async () => {
          invocation += 1;
          if (invocation > 1) {
            this.telemetry.retry(invocation - 1);
          }
          return this._submitSigned(payload, client, multiSignResult);
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
      if (err instanceof WitnessSubmitError) {
        throw err;
      }
      const attempts = (err as { attempts?: number }).attempts ?? 1;
      throw new WitnessSubmitError(attempts, err, payload);
    }
  }

  /**
   * Build the multi-sign result without submitting (for inspection/dry-run).
   */
  buildMultiSign(
    payload: AttestationPayload,
    policy: GovernancePolicy,
    prepared: Transaction,
  ): MultiSignResult {
    const signedBlobs: string[] = [];
    const signerSignatures: SignerSignature[] = [];
    const now = normalizeTimestamp(new Date());

    // The canonical payload hash each signer cryptographically attests to.
    const payloadHash = buildCanonicalSigningPayload(payload, policy);

    let expectedHash: string | null = null;

    for (const [address, wallet] of this.wallets) {
      // Each signer independently signs the prepared transaction (XRPL multisign).
      const signed = wallet.sign(prepared, /* multisign */ true);

      // Verify all signers produce the same transaction hash.
      // A corrupted wallet producing a different hash means it signed
      // different transaction content — reject before submission.
      if (expectedHash === null) {
        expectedHash = signed.hash;
      } else if (signed.hash !== expectedHash) {
        throw new Error(
          `Multi-sig hash mismatch: signer ${address} produced hash ${signed.hash}, expected ${expectedHash}. ` +
          `This indicates the signer modified the transaction content.`,
        );
      }

      // Verify the signed blob decodes to a valid transaction matching the prepared tx
      try {
        const decoded = decode(signed.tx_blob);
        if (decoded.Account !== prepared.Account) {
          throw new Error(
            `Signer ${address} signed a transaction for account ${decoded.Account}, expected ${prepared.Account}`,
          );
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes("Signer")) throw err;
        throw new Error(`Signer ${address} produced an invalid transaction blob: ${err}`);
      }

      signedBlobs.push(signed.tx_blob);

      // D3-A-003: contribute a REAL cryptographic signature over the canonical
      // payload hash (not the XRPL tx hash). This is what aggregateSignatures
      // verifies against the signer's registered public key before counting it
      // toward quorum. D3-A-004: the recorded address is the wallet's own
      // verified identity, never a config-supplied string.
      signerSignatures.push({
        address: wallet.classicAddress,
        signature: signPayloadHash(payloadHash, wallet.privateKey),
        signedAt: now,
      });
    }

    // Verify quorum via governance signing module — verify-then-count: each
    // signature must cryptographically verify over payloadHash against the
    // signer's registered public key before its weight counts (fail-closed).
    aggregateSignatures(signerSignatures, policy, payloadHash, {
      verify: xrplSignatureVerifier,
    });

    // Combine all signed blobs into a single multi-signed transaction
    const combinedBlob = multisign([...signedBlobs]);

    return {
      signedBlobs,
      signerSignatures,
      combinedBlob,
      // expectedHash is the prepared-tx hash, identical across signers (asserted
      // above) and stable for the fixed autofilled transaction.
      txHash: expectedHash ?? "",
    };
  }

  /**
   * Build the unsigned transaction (for inspection).
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

  // ===========================================================================
  // Private
  // ===========================================================================

  /**
   * Check whether a transaction is already validated on-chain by its hash.
   * Returns the ledger index if validated, otherwise null.
   */
  private async _checkExistingTx(
    client: XrplClient,
    txHash: string,
  ): Promise<{ ledgerIndex: number } | null> {
    if (!txHash) return null;
    try {
      const response = await client.request({
        command: "tx",
        transaction: txHash,
      });
      const result = response.result as unknown as Record<string, unknown>;
      if (result.validated === true) {
        const ledgerIndex = typeof result.ledger_index === "number" ? result.ledger_index : 0;
        return { ledgerIndex };
      }
      return null;
    } catch {
      // tx not found — proceed with submission
      return null;
    }
  }

  /**
   * Submit the pre-built, combined multi-signed transaction (one retry attempt).
   *
   * The combined blob and its expected hash are FIXED across retries (autofill +
   * multi-sign happen once in {@link submit}). Each attempt first checks whether
   * the fixed-hash tx is already validated on-chain — if a previous attempt's
   * response was lost but the tx applied, we recognize it here instead of
   * submitting a duplicate fund-affecting transaction (D3-A-002).
   */
  private async _submitSigned(
    payload: AttestationPayload,
    client: XrplClient,
    multiSignResult: MultiSignResult,
  ): Promise<WitnessRecord> {
    // Pre-submit replay/idempotency guard: is this exact tx already on-chain?
    const existing = await this._checkExistingTx(client, multiSignResult.txHash);
    if (existing) {
      // D3-B-001: lost-but-applied multi-sig tx recovered via the fixed-hash
      // check — critical operational signal. Emit before returning.
      this.telemetry.idempotentHit(
        `txHash=${multiSignResult.txHash} ledgerIndex=${existing.ledgerIndex}`,
      );
      return {
        id: `witness:multisig:${payload.hash.slice(0, 16)}`,
        payload,
        chainId: this.config.chainId,
        txHash: multiSignResult.txHash,
        ledgerIndex: existing.ledgerIndex,
        witnessedAt: normalizeTimestamp(new Date()),
        witnessAccount: this.config.account,
      };
    }

    // Submit the combined multi-signed transaction
    const result = await client.submitAndWait(multiSignResult.combinedBlob);

    const meta = result.result.meta;
    const ledgerIndex =
      typeof meta === "object" && meta !== null && "ledger_index" in meta
        ? (meta as Record<string, unknown>).ledger_index as number
        : result.result.ledger_index ?? 0;

    return {
      id: `witness:multisig:${payload.hash.slice(0, 16)}`,
      payload,
      chainId: this.config.chainId,
      txHash: result.result.hash ?? multiSignResult.txHash,
      ledgerIndex,
      witnessedAt: normalizeTimestamp(new Date()),
      witnessAccount: this.config.account,
    };
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Normalize a Date to UTC ISO 8601 string.
 * Ensures all timestamps are consistent regardless of system timezone.
 */
export function normalizeTimestamp(date: Date): string {
  return date.toISOString();
}
