/**
 * @attestia/witness domain types.
 *
 * XRPL attestation pipeline types for:
 * - Content-addressed attestation payloads
 * - XRPL transaction memo encoding
 * - Witness records (on-chain proof references)
 */

import type { TxHash, ChainId, Telemetry } from "@attestia/types";

// =============================================================================
// Attestation Payload
// =============================================================================

/**
 * A content-addressed attestation payload.
 *
 * This is the canonical data structure that gets encoded as an XRPL memo.
 * The hash is SHA-256 of the canonical JSON representation.
 */
export interface AttestationPayload {
  /** SHA-256 hash of the payload content */
  readonly hash: string;

  /** ISO 8601 timestamp when the payload was created */
  readonly timestamp: string;

  /** Source attestation (reconciliation report or registrum state) */
  readonly source: AttestationSource;

  /** Summary data included in the memo for quick verification */
  readonly summary: PayloadSummary;
}

export type AttestationSource =
  | { readonly kind: "reconciliation"; readonly reportId: string; readonly reportHash: string }
  | { readonly kind: "registrum"; readonly stateId: string; readonly orderIndex: number };

export interface PayloadSummary {
  /** Whether the attestation represents a clean state */
  readonly clean: boolean;
  /** Number of matched items */
  readonly matchedCount: number;
  /** Number of mismatched items */
  readonly mismatchCount: number;
  /** Number of missing items */
  readonly missingCount: number;
  /** Attestor identity */
  readonly attestedBy: string;
}

// =============================================================================
// XRPL Memo
// =============================================================================

/**
 * An XRPL transaction memo (pre-hex-encoding).
 *
 * Per XRPL convention:
 * - MemoType: MIME type or identifier
 * - MemoData: the payload content
 * - MemoFormat (optional): encoding hint
 */
export interface XrplMemo {
  /** Memo type identifier (e.g. "attestia/witness/v1") */
  readonly MemoType: string;
  /** Hex-encoded payload data */
  readonly MemoData: string;
  /** Optional format hint (e.g. "application/json") */
  readonly MemoFormat?: string;
}

// =============================================================================
// Witness Record
// =============================================================================

/**
 * A witness record — the proof that an attestation was written on-chain.
 */
export interface WitnessRecord {
  /** Unique witness record ID */
  readonly id: string;

  /** The attestation payload that was witnessed */
  readonly payload: AttestationPayload;

  /** XRPL chain ID (e.g. "xrpl:mainnet", "xrpl:testnet") */
  readonly chainId: ChainId;

  /** XRPL transaction hash */
  readonly txHash: TxHash;

  /** XRPL ledger index where the tx was validated */
  readonly ledgerIndex: number;

  /** ISO 8601 timestamp of the witness */
  readonly witnessedAt: string;

  /** Witness account address */
  readonly witnessAccount: string;
}

// =============================================================================
// Verification
// =============================================================================

/** Result of verifying a witness record against on-chain data. */
export interface VerificationResult {
  /** Whether the on-chain data matches the expected payload */
  readonly verified: boolean;

  /** The witness record being verified */
  readonly witnessRecord: WitnessRecord;

  /** On-chain payload hash (from memo data) */
  readonly onChainHash?: string;

  /** Discrepancies found during verification */
  readonly discrepancies: readonly string[];
}

// =============================================================================
// Secret Provider
// =============================================================================

/**
 * Interface for providing secrets without exposing them in config objects.
 *
 * Production deployments should use a vault-backed implementation
 * (e.g., HashiCorp Vault, AWS Secrets Manager) instead of inline secrets.
 */
export interface SecretProvider {
  /** Retrieve the secret for the given account address. */
  getSecret(address: string): Promise<string>;
}

/**
 * Simple inline secret provider for backward compatibility and testing.
 * Wraps a plain string secret — NOT recommended for production use.
 */
export class InlineSecretProvider implements SecretProvider {
  constructor(private readonly _secret: string) {}

  async getSecret(_address: string): Promise<string> {
    return this._secret;
  }
}

/**
 * Resolve a secret value from either a plain string or a SecretProvider.
 */
export async function resolveSecret(
  secretOrProvider: string | SecretProvider,
  address: string,
): Promise<string> {
  if (typeof secretOrProvider === "string") {
    return secretOrProvider;
  }
  return secretOrProvider.getSecret(address);
}

// =============================================================================
// Configuration
// =============================================================================

/**
 * Configuration for the XRPL witness.
 */
export interface WitnessConfig {
  /** XRPL WebSocket endpoint (e.g. "wss://s.altnet.rippletest.net:51233") */
  readonly rpcUrl: string;

  /** XRPL chain identifier (e.g. "xrpl:testnet") */
  readonly chainId: ChainId;

  /** Witness account address (r-address) */
  readonly account: string;

  /**
   * Witness account secret/seed (for signing attestation txs).
   * Accepts a plain string (backward compatible) or a SecretProvider
   * for vault-backed secret management.
   */
  readonly secret: string | SecretProvider;

  /** Optional: fee in drops (defaults to 12) */
  readonly feeDrops?: string;

  /** Optional: connection timeout in ms */
  readonly timeoutMs?: number;

  /** Optional: retry configuration for submit failures */
  readonly retry?: import("./retry.js").RetryConfig | undefined;

  /**
   * Optional telemetry sink for structured observability events.
   *
   * When omitted, the submitter emits nothing (default {@link NOOP_TELEMETRY}),
   * keeping the package dependency-free and silent. When provided, the submitter
   * emits `submit` (attempt + final outcome), `submit.retry`, and
   * `submit.idempotent_hit` events under package `"@attestia/witness"`.
   * Per the contract, txHash/ledgerIndex go in the event `message`, never in the
   * low-cardinality `attributes`. `record` MUST NOT throw.
   */
  readonly telemetry?: Telemetry;
}

// =============================================================================
// Witness Submit Error
// =============================================================================

/**
 * Error thrown when all witness submission retry attempts are exhausted.
 */
export class WitnessSubmitError extends Error {
  constructor(
    /** Number of attempts made */
    public readonly attempts: number,
    /** The last error encountered */
    public readonly lastError: unknown,
    /** The payload that failed to submit */
    public readonly payload: AttestationPayload,
  ) {
    const msg = lastError instanceof Error ? lastError.message : String(lastError);
    super(`Witness submission failed after ${attempts} attempts: ${msg}`);
    this.name = "WitnessSubmitError";
  }
}
