/**
 * @attestia/reconciler domain types.
 *
 * Cross-system reconciliation types for matching:
 * - Vault intents ↔ Treasury ledger entries
 * - Ledger entries ↔ On-chain transfer events
 * - Intent executions ↔ On-chain transactions
 *
 * Plus attestation records registered through Registrum.
 */

import type { Money, ChainId, TxHash } from "@attestia/types";
import type { Discrepancy } from "./discrepancy.js";

// =============================================================================
// Match Results
// =============================================================================

/**
 * A single match between an intent and its ledger trace.
 *
 * `discrepancies` is the legacy human-readable prose (kept for backward
 * compatibility); `structuredDiscrepancies` is the machine-readable companion
 * (D4-B-002). The two are in lockstep — every prose string has a structured
 * counterpart with the same `message`.
 */
export interface IntentLedgerMatch {
  readonly intentId: string;
  readonly correlationId: string;
  readonly status: MatchStatus;
  readonly intentAmount?: Money;
  readonly ledgerAmount?: Money;
  /** Human-readable prose (legacy; preserved for existing consumers). */
  readonly discrepancies: readonly string[];
  /** Machine-readable discrepancies (D4-B-002). */
  readonly structuredDiscrepancies: readonly Discrepancy[];
}

/** A single match between a ledger entry and an on-chain event. */
export interface LedgerChainMatch {
  readonly correlationId: string;
  readonly txHash?: TxHash;
  readonly chainId?: ChainId;
  readonly status: MatchStatus;
  readonly ledgerAmount?: Money;
  readonly chainAmount?: string;
  readonly chainDecimals?: number;
  /** Human-readable prose (legacy; preserved for existing consumers). */
  readonly discrepancies: readonly string[];
  /** Machine-readable discrepancies (D4-B-002). */
  readonly structuredDiscrepancies: readonly Discrepancy[];
}

/** A single match between an intent and its on-chain execution. */
export interface IntentChainMatch {
  readonly intentId: string;
  readonly txHash?: TxHash;
  readonly chainId?: ChainId;
  readonly status: MatchStatus;
  readonly intentAmount?: Money;
  readonly chainAmount?: string;
  readonly chainDecimals?: number;
  /** Human-readable prose (legacy; preserved for existing consumers). */
  readonly discrepancies: readonly string[];
  /** Machine-readable discrepancies (D4-B-002). */
  readonly structuredDiscrepancies: readonly Discrepancy[];
}

export type MatchStatus =
  | "matched"           // Both sides present and values agree
  | "amount-mismatch"   // Both present but amounts differ
  | "missing-ledger"    // Intent exists but no ledger entry
  | "missing-intent"    // Ledger entry exists but no intent
  | "missing-chain"     // Ledger/intent exists but no on-chain event
  | "unmatched";        // Could not correlate

// =============================================================================
// Reconciliation Report
// =============================================================================

/** Full reconciliation report. */
export interface ReconciliationReport {
  readonly id: string;
  readonly scope: ReconciliationScope;
  readonly timestamp: string;

  /** Intent ↔ Ledger matches */
  readonly intentLedgerMatches: readonly IntentLedgerMatch[];

  /** Ledger ↔ Chain matches */
  readonly ledgerChainMatches: readonly LedgerChainMatch[];

  /** Intent ↔ Chain matches */
  readonly intentChainMatches: readonly IntentChainMatch[];

  /** Summary statistics */
  readonly summary: ReconciliationSummary;
}

export interface ReconciliationScope {
  /** Time range start (ISO 8601) */
  readonly from?: string;
  /** Time range end (ISO 8601) */
  readonly to?: string;
  /** Restrict to a specific intent */
  readonly intentId?: string;
  /** Restrict to a specific chain */
  readonly chainId?: ChainId;
  /** Restrict to a specific correlation */
  readonly correlationId?: string;
}

export interface ReconciliationSummary {
  readonly totalIntents: number;
  readonly totalLedgerEntries: number;
  readonly totalChainEvents: number;

  readonly matchedCount: number;
  readonly mismatchCount: number;
  readonly missingCount: number;

  readonly allReconciled: boolean;
  /** Human-readable prose, flattened across all matches (legacy). */
  readonly discrepancies: readonly string[];
  /** Machine-readable discrepancies, flattened across all matches (D4-B-002). */
  readonly structuredDiscrepancies: readonly Discrepancy[];
  /**
   * Discrepancy counts aggregated by {@link Discrepancy.code}. Absent codes are
   * omitted (no zero entries). Suitable for charting or metric emission.
   */
  readonly discrepancyCountsByCode: Readonly<Record<string, number>>;
}

// =============================================================================
// Attestation
// =============================================================================

/** An attestation record suitable for registration with Registrum. */
export interface AttestationRecord {
  readonly id: string;
  readonly reconciliationId: string;
  readonly allReconciled: boolean;
  readonly summary: ReconciliationSummary;
  readonly attestedBy: string;
  readonly attestedAt: string;
  /** Hash of the full report (for integrity verification) */
  readonly reportHash: string;
}

// =============================================================================
// Input Records (normalized from subsystems)
// =============================================================================

/** A normalized intent record for reconciliation. */
export interface ReconcilableIntent {
  readonly id: string;
  readonly status: string;
  readonly kind: string;
  readonly amount?: Money;
  readonly envelopeId?: string;
  readonly chainId?: ChainId;
  readonly txHash?: TxHash;
  readonly declaredAt: string;
  readonly correlationId?: string;
}

/** A normalized ledger entry for reconciliation. */
export interface ReconcilableLedgerEntry {
  readonly id: string;
  readonly accountId: string;
  readonly type: "debit" | "credit";
  readonly money: Money;
  readonly timestamp: string;
  readonly intentId?: string;
  readonly txHash?: string;
  readonly correlationId: string;
}

/** A normalized on-chain event for reconciliation. */
export interface ReconcilableChainEvent {
  readonly chainId: ChainId;
  readonly txHash: TxHash;
  readonly from: string;
  readonly to: string;
  readonly amount: string;
  readonly decimals: number;
  readonly symbol: string;
  readonly timestamp: string;
}
