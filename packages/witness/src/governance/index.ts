/**
 * Multi-Sig Witness Governance — Public API
 */
export { GovernanceStore } from "./governance-store.js";
export {
  buildCanonicalSigningPayload,
  orderSignatures,
  aggregateSignatures,
  xrplSignatureVerifier,
  signPayloadHash,
  encodePayloadHashForSigning,
} from "./signing.js";
export type {
  SignerSignature,
  AggregatedSignature,
  SignatureVerifier,
  AggregateOptions,
} from "./signing.js";
export type {
  SignerEntry,
  GovernancePolicy,
  GovernanceChangeEvent,
  SignerAddedEvent,
  SignerRemovedEvent,
  QuorumChangedEvent,
  PolicyRotatedEvent,
  QuorumResult,
} from "./types.js";
export {
  isSignerAddedEvent,
  isSignerRemovedEvent,
  isQuorumChangedEvent,
  isPolicyRotatedEvent,
} from "./types.js";

// Multi-sig submitter and witness
export { MultiSigSubmitter, normalizeTimestamp } from "./multisig-submitter.js";
export type { SignerConfig, MultiSigConfig, MultiSignResult } from "./multisig-submitter.js";
export { MultiSigWitness } from "./multisig-witness.js";
export type { MultiSigWitnessConfig } from "./multisig-witness.js";

// Registrum–governance bridge
export {
  validateAuthority,
  replayGovernanceHistory,
  replayToVersion,
  validateHistoricalQuorum,
} from "./registrum-bridge.js";
export type {
  RegistrumStateRef,
  AuthorityValidation,
  HistoricalQuorumValidation,
  HistoricalQuorumOptions,
} from "./registrum-bridge.js";
