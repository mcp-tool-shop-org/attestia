/**
 * Multi-Sig Witness — Top-level coordinator for multi-signature witnessing
 *
 * Wraps MultiSigSubmitter + GovernanceStore for full N-of-M governance.
 * Falls back to single-signer XrplSubmitter when no governance config
 * is present, maintaining backward compatibility.
 *
 * Design:
 * - Backward compatible: no governance config → single-signer mode
 * - Governance mode: multi-sig with quorum enforcement
 * - Same pipeline: build payload → encode memo → submit → return record
 * - Same memo format: transparent to verifiers
 */

import type { AttestationRecord, ReconciliationReport } from "@attestia/reconciler";
import { buildReconciliationPayload, buildRegistrumPayload, verifyPayloadHash } from "../payload.js";
import { XrplSubmitter } from "../submitter.js";
import { XrplVerifier } from "../verifier.js";
import type {
  AttestationPayload,
  VerificationResult,
  WitnessConfig,
  WitnessRecord,
} from "../types.js";
import { MultiSigSubmitter, type MultiSigConfig } from "./multisig-submitter.js";
import { GovernanceStore } from "./governance-store.js";
import type { GovernancePolicy } from "./types.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for the multi-sig witness.
 *
 * When `governance` is provided, multi-sig mode is used.
 * When absent, falls back to single-signer mode using `singleSignerConfig`.
 */
export interface MultiSigWitnessConfig {
  /** Multi-sig configuration (if present, multi-sig mode) */
  readonly governance?: {
    readonly multiSigConfig: MultiSigConfig;
    readonly store: GovernanceStore;
  };

  /** Single-signer fallback config (used when governance is not set) */
  readonly singleSignerConfig?: WitnessConfig;

  /** Verifier config (uses multi-sig or single-signer rpcUrl/chainId) */
  readonly verifierConfig?: WitnessConfig;

  /**
   * Maximum number of in-memory witness records to retain (PB-WCO-007).
   *
   * A long-lived witness process attests continuously; an unbounded record array
   * is a slow memory leak that survives all tests (which submit a handful) and
   * only manifests as gradual growth over days/weeks. This caps the in-memory
   * history with FIFO eviction (oldest dropped first) — callers that need the
   * full history should persist records themselves. Defaults to
   * {@link DEFAULT_MAX_RECORDS}; set `0` for no in-memory retention.
   */
  readonly maxRecords?: number;
}

/**
 * Default in-memory witness-record retention cap (PB-WCO-007). Bounds memory in
 * a continuously-running witness while keeping a useful recent window for
 * {@link MultiSigWitness.getRecords}.
 */
export const DEFAULT_MAX_RECORDS = 10_000;

// =============================================================================
// MultiSigWitness
// =============================================================================

export class MultiSigWitness {
  private readonly multiSigSubmitter: MultiSigSubmitter | null;
  private readonly singleSubmitter: XrplSubmitter | null;
  private readonly verifier: XrplVerifier | null;
  private readonly governanceStore: GovernanceStore | null;
  private readonly records: WitnessRecord[] = [];
  private readonly maxRecords: number;
  private readonly mode: "multisig" | "single";

  constructor(config: MultiSigWitnessConfig) {
    this.maxRecords = config.maxRecords ?? DEFAULT_MAX_RECORDS;
    if (config.governance) {
      // Multi-sig mode
      this.mode = "multisig";
      this.multiSigSubmitter = new MultiSigSubmitter(config.governance.multiSigConfig);
      this.governanceStore = config.governance.store;
      this.singleSubmitter = null;
    } else if (config.singleSignerConfig) {
      // Single-signer fallback mode
      this.mode = "single";
      this.singleSubmitter = new XrplSubmitter(config.singleSignerConfig);
      this.multiSigSubmitter = null;
      this.governanceStore = null;
    } else {
      throw new Error(
        "MultiSigWitness requires either governance config or singleSignerConfig",
      );
    }

    // Verifier uses explicit config, or falls back to multi-sig/single config
    if (config.verifierConfig) {
      this.verifier = new XrplVerifier(config.verifierConfig);
    } else if (config.governance) {
      const msConfig = config.governance.multiSigConfig;
      this.verifier = new XrplVerifier({
        rpcUrl: msConfig.rpcUrl,
        chainId: msConfig.chainId,
        ...(msConfig.timeoutMs !== undefined ? { timeoutMs: msConfig.timeoutMs } : {}),
      });
    } else if (config.singleSignerConfig) {
      this.verifier = new XrplVerifier(config.singleSignerConfig);
    } else {
      this.verifier = null;
    }
  }

  /**
   * Get the current operating mode.
   */
  getMode(): "multisig" | "single" {
    return this.mode;
  }

  /**
   * Connect to XRPL.
   *
   * PB-WCO-008: connecting the submitter and verifier is a two-step operation
   * with an irreversible side effect per step (a live WebSocket). If the second
   * step fails after the first succeeded, we MUST roll back the already-opened
   * connection — otherwise connect() rejects but leaves an orphaned live socket,
   * isConnected() reports an inconsistent view, and every connect() retry leaks
   * another socket. So on ANY sub-connect failure, best-effort disconnect every
   * component before re-throwing, leaving the witness cleanly disconnected and
   * retry-safe (a named compensator for the connect saga).
   */
  async connect(): Promise<void> {
    try {
      if (this.multiSigSubmitter) {
        await this.multiSigSubmitter.connect();
      }
      if (this.singleSubmitter) {
        await this.singleSubmitter.connect();
      }
      if (this.verifier) {
        await this.verifier.connect();
      }
    } catch (err) {
      // Compensate: tear down any already-opened connections so we don't leak a
      // dangling socket or present a half-connected state. Best-effort — a
      // disconnect failure must not mask the original connect error.
      await this._rollbackConnect();
      throw err;
    }
  }

  /**
   * Best-effort teardown of all components, used to compensate a partially-
   * successful {@link connect} (PB-WCO-008). Each disconnect is isolated so one
   * failure cannot prevent tearing down the others.
   */
  private async _rollbackConnect(): Promise<void> {
    await Promise.allSettled([
      this.multiSigSubmitter?.disconnect(),
      this.singleSubmitter?.disconnect(),
      this.verifier?.disconnect(),
    ]);
  }

  /**
   * Disconnect from XRPL.
   */
  async disconnect(): Promise<void> {
    if (this.multiSigSubmitter) {
      await this.multiSigSubmitter.disconnect();
    }
    if (this.singleSubmitter) {
      await this.singleSubmitter.disconnect();
    }
    if (this.verifier) {
      await this.verifier.disconnect();
    }
  }

  /**
   * Check whether the witness is connected.
   */
  isConnected(): boolean {
    if (this.mode === "multisig") {
      return this.multiSigSubmitter?.isConnected() === true;
    }
    return this.singleSubmitter?.isConnected() === true;
  }

  /**
   * Witness a reconciliation report.
   */
  async witnessReconciliation(
    report: ReconciliationReport,
    attestation: AttestationRecord,
  ): Promise<WitnessRecord> {
    const payload = buildReconciliationPayload(report, attestation);
    return this._submitPayload(payload);
  }

  /**
   * Witness a Registrum state registration.
   */
  async witnessRegistrumState(
    stateId: string,
    orderIndex: number,
    attestedBy: string,
  ): Promise<WitnessRecord> {
    const payload = buildRegistrumPayload(stateId, orderIndex, attestedBy);
    return this._submitPayload(payload);
  }

  /**
   * Witness an arbitrary attestation payload.
   */
  async witnessPayload(payload: AttestationPayload): Promise<WitnessRecord> {
    return this._submitPayload(payload);
  }

  /**
   * Verify a witness record against on-chain data.
   */
  async verify(record: WitnessRecord): Promise<VerificationResult> {
    if (!this.verifier) {
      throw new Error("MultiSigWitness: no verifier configured");
    }
    return this.verifier.verify(record);
  }

  /**
   * Get the current governance policy (multi-sig mode only).
   */
  getCurrentPolicy(): GovernancePolicy | null {
    return this.governanceStore?.getCurrentPolicy() ?? null;
  }

  /**
   * Get all witness records from this session.
   */
  getRecords(): readonly WitnessRecord[] {
    return [...this.records];
  }

  /**
   * Verify a payload's content hash offline.
   */
  verifyPayloadIntegrity(payload: AttestationPayload): boolean {
    return verifyPayloadHash(payload);
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  private async _submitPayload(payload: AttestationPayload): Promise<WitnessRecord> {
    let record: WitnessRecord;

    if (this.mode === "multisig" && this.multiSigSubmitter && this.governanceStore) {
      const policy = this.governanceStore.getCurrentPolicy();
      record = await this.multiSigSubmitter.submit(payload, policy);
    } else if (this.singleSubmitter) {
      record = await this.singleSubmitter.submit(payload);
    } else {
      throw new Error("MultiSigWitness: no submitter available");
    }

    this._retainRecord(record);
    return record;
  }

  /**
   * Append a record to the bounded in-memory history (PB-WCO-007). When at the
   * configured cap, evict oldest-first (FIFO) so memory stays bounded in a
   * continuously-running witness. A cap of 0 disables in-memory retention.
   */
  private _retainRecord(record: WitnessRecord): void {
    if (this.maxRecords <= 0) {
      return;
    }
    this.records.push(record);
    // Evict from the front until within the cap (handles a lowered cap too).
    while (this.records.length > this.maxRecords) {
      this.records.shift();
    }
  }
}
