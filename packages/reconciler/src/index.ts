/**
 * @attestia/reconciler — Cross-system reconciliation engine.
 *
 * Matches and verifies financial records across three systems:
 * - Vault intents (what was planned/executed)
 * - Ledger entries (the accounting truth)
 * - On-chain events (the blockchain truth)
 *
 * Three matching dimensions:
 * 1. Intent ↔ Ledger — did the accounting reflect the intent?
 * 2. Ledger ↔ Chain — does the accounting match the blockchain?
 * 3. Intent ↔ Chain — does execution match what was planned?
 *
 * Reconciliation results are attested through Registrum for immutable audit trail.
 */

// Reconciler (top-level coordinator)
export { Reconciler } from "./reconciler.js";
export type { ReconcilerConfig, ReconciliationInput } from "./reconciler.js";

// Matchers
export { IntentLedgerMatcher } from "./intent-ledger-matcher.js";
export { LedgerChainMatcher } from "./ledger-chain-matcher.js";
export { IntentChainMatcher } from "./intent-chain-matcher.js";

// Attestor
export { Attestor } from "./attestor.js";

// Cross-chain rules
export {
  isSettlementPair,
  getSettlementChain,
  preventDoubleCounting,
  linkCrossChainEvents,
} from "./cross-chain-rules.js";
export type {
  CrossChainEvent,
  CrossChainLink,
} from "./cross-chain-rules.js";

// Structured discrepancies (D4-B-002)
export { makeDiscrepancy, countByCode } from "./discrepancy.js";
export type {
  Discrepancy,
  DiscrepancyCode,
  DiscrepancyDimension,
} from "./discrepancy.js";

// Types
export type {
  // Match results
  IntentLedgerMatch,
  LedgerChainMatch,
  IntentChainMatch,
  MatchStatus,

  // Reports
  ReconciliationReport,
  ReconciliationScope,
  ReconciliationSummary,

  // Attestation
  AttestationRecord,

  // Input records
  ReconcilableIntent,
  ReconcilableLedgerEntry,
  ReconcilableChainEvent,
} from "./types.js";
