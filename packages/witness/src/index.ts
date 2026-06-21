/**
 * @attestia/witness — XRPL attestation pipeline.
 *
 * Writes reconciliation proofs on-chain as XRPL payment memos.
 * Each attestation is a 1-drop self-send transaction with a content-addressed
 * memo payload, creating an immutable, timestamped proof on the XRP Ledger.
 *
 * Pipeline:
 * 1. Build payload — SHA-256 content-addressed attestation data
 * 2. Encode memo — XRPL transaction memo format (hex-encoded JSON)
 * 3. Submit — 1-drop self-send Payment with memo
 * 4. Verify — Read back from XRPL and verify integrity
 *
 * No smart contracts. No Turing-complete execution. Just timestamped proof.
 */

// Witness (top-level coordinator)
export { XrplWitness } from "./witness.js";

// Submitter & Verifier
export { XrplSubmitter } from "./submitter.js";
export { XrplVerifier } from "./verifier.js";

// Payload builder
export {
  buildReconciliationPayload,
  buildRegistrumPayload,
  verifyPayloadHash,
} from "./payload.js";

// Memo encoder
export {
  encodeMemo,
  decodeMemo,
  isAttestiaMemo,
  toHex,
  fromHex,
  MEMO_TYPE,
  MEMO_FORMAT,
} from "./memo-encoder.js";

// Retry
export {
  withRetry,
  withTimeout,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_SUBMIT_TIMEOUT_MS,
  isRetryableXrplError,
  RetryExhaustedError,
  AttemptTimeoutError,
} from "./retry.js";
export type { RetryConfig } from "./retry.js";

// Types
export type {
  AttestationPayload,
  AttestationSource,
  PayloadSummary,
  XrplMemo,
  WitnessRecord,
  VerificationResult,
  WitnessConfig,
  SecretProvider,
} from "./types.js";
export { WitnessSubmitError, InlineSecretProvider, resolveSecret } from "./types.js";

// Multi-sig governance
export {
  GovernanceStore,
  buildCanonicalSigningPayload,
  orderSignatures,
  aggregateSignatures,
  xrplSignatureVerifier,
  signPayloadHash,
  encodePayloadHashForSigning,
  isSignerAddedEvent,
  isSignerRemovedEvent,
  isQuorumChangedEvent,
  isPolicyRotatedEvent,
  MultiSigSubmitter,
  MultiSigWitness,
  DEFAULT_MAX_RECORDS,
  normalizeTimestamp,
  validateAuthority,
  replayGovernanceHistory,
  replayToVersion,
  validateHistoricalQuorum,
} from "./governance/index.js";
export type {
  SignerEntry,
  GovernancePolicy,
  GovernanceChangeEvent,
  SignerAddedEvent,
  SignerRemovedEvent,
  QuorumChangedEvent,
  PolicyRotatedEvent,
  QuorumResult,
  SignerSignature,
  AggregatedSignature,
  SignatureVerifier,
  AggregateOptions,
  SignerConfig,
  MultiSigConfig,
  MultiSignResult,
  MultiSigWitnessConfig,
  RegistrumStateRef,
  AuthorityValidation,
  HistoricalQuorumValidation,
  HistoricalQuorumOptions,
} from "./governance/index.js";
