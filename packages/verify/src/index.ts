/**
 * @attestia/verify — Deterministic replay verification for Attestia.
 *
 * Ties the ledger and registrum together into a single verifiable
 * content-addressed GlobalStateHash. Provides replay-based verification
 * to prove persistence is lossless and deterministic.
 *
 * Core exports:
 * - computeGlobalStateHash — combine subsystem snapshots into one hash
 * - verifyByReplay — full replay-based verification
 * - verifyHash — quick hash comparison (no replay)
 */

// GlobalStateHash computation
export {
  computeGlobalStateHash,
  hashLedgerSnapshot,
  hashRegistrumSnapshot,
} from "./global-state-hash.js";

// Replay verification
export { verifyByReplay, verifyHash } from "./replay.js";

// Multi-chain replay audit
export {
  computeChainHashChain,
  computeCombinedHash,
  auditMultiChainReplay,
} from "./multi-chain-replay.js";

// State bundle (external verification)
export {
  createStateBundle,
  verifyBundleIntegrity,
} from "./state-bundle.js";

// Verifier node (external verification)
export { runVerification, VerifierNode } from "./verifier-node.js";

// Verification consensus (multi-verifier)
export {
  aggregateVerifierReports,
  isConsensusReached,
} from "./verification-consensus.js";

// Human-readable report formatters
export {
  formatVerifierReport,
  formatComplianceReport,
} from "./report-formatter.js";

// Cross-chain invariants
export {
  checkAssetConservation,
  checkNoDuplicateSettlement,
  checkEventOrdering,
  checkGovernanceConsistency,
  auditCrossChainInvariants,
} from "./cross-chain-invariants.js";

// Types
export type {
  GlobalStateHash,
  VerificationVerdict,
  VerificationDiscrepancy,
  VerificationResult,
  ReplayInput,
  ReplayResult,
  ExportableStateBundle,
  BundleVerificationResult,
  VerifierConfig,
  SubsystemCheck,
  VerifierReport,
  ConsensusResult,
} from "./types.js";

export type {
  ChainEvent,
  ChainReplayResult,
  MultiChainAuditResult,
} from "./multi-chain-replay.js";

export type {
  InvariantEvent,
  InvariantCheckResult,
  InvariantAuditResult,
} from "./cross-chain-invariants.js";

// Compliance
export {
  SOC2_FRAMEWORK,
  SOC2_MAPPINGS,
  ISO27001_FRAMEWORK,
  ISO27001_MAPPINGS,
  generateComplianceEvidence,
} from "./compliance/index.js";

export type {
  ComplianceFramework,
  EvidenceType,
  ControlStatus,
  ControlMapping,
  EvaluatedControl,
  ComplianceReport,
} from "./compliance/index.js";

// SLA
export { evaluateSla, evaluateMultipleSla } from "./sla/index.js";

export type {
  SlaMetric,
  ThresholdOperator,
  SlaWindow,
  SlaTarget,
  SlaPolicy,
  SlaTargetResult,
  SlaVerdict,
  SlaEvaluation,
  SlaMetrics,
} from "./sla/index.js";

// Tenant Governance
export {
  createTenantGovernancePolicy,
  suspendTenant,
  reactivateTenant,
  validateTenantGovernance,
  assignSlaPolicy,
} from "./sla/index.js";

export type {
  TenantStatus,
  TenantGovernancePolicy,
  TenantAction,
  TenantGovernanceResult,
} from "./sla/index.js";
