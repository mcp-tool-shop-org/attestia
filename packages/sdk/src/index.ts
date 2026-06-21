/**
 * @attestia/sdk — Typed HTTP client SDK for Attestia.
 *
 * Provides a typed, ergonomic client for interacting with the
 * Attestia API. Zero heavy dependencies — uses native fetch.
 *
 * @packageDocumentation
 */

// Types
export type {
  AttestiaClientConfig,
  AttestiaResponse,
  PaginatedList,
} from "./types.js";

export { AttestiaError } from "./types.js";

// HTTP Client
export { HttpClient } from "./http-client.js";

// Client
export { AttestiaClient } from "./client.js";

// Client namespace classes (for type usage)
export {
  IntentsNamespace,
  VerifyNamespace,
  ProofsNamespace,
  TreasuryNamespace,
  PayrollRunsNamespace,
  DistributionsNamespace,
  FundingGatesNamespace,
  VaultNamespace,
  GovernanceNamespace,
} from "./client.js";

// Auto-pagination helper
export { paginateAll } from "./client.js";

// Domain types from client
export type {
  IntentStatus,
  IntentKind,
  Intent,
  Money,
  IntentParams,
  DeclareIntentParams,
  ListIntentsParams,
  GlobalStateHash,
  ReplayInput,
  ReplayResult,
  MerkleProofStep,
  AttestationProofPackage,
  ProofVerificationResult,
  MerkleRootInfo,
  // Treasury
  PayrollRunStatus,
  PayPeriod,
  PayrollEntry,
  PayrollRun,
  CreatePayrollRunParams,
  DistributionStrategy,
  DistributionStatus,
  DistributionRecipient,
  DistributionPlan,
  CreateDistributionParams,
  DistributionPayout,
  DistributionResult,
  FundingStatus,
  FundingGate,
  FundingRequest,
  SubmitFundingParams,
  // Vault
  Envelope,
  CreateEnvelopeParams,
  BudgetSnapshot,
  TokenPosition,
  Portfolio,
  // Governance
  SignerEntry,
  GovernancePolicy,
  AddSignerParams,
  // Pagination
  ListPageParams,
} from "./client.js";
