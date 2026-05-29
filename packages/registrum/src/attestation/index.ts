/**
 * Attestation Module
 *
 * External attestation payload generation for Registrum.
 *
 * Design constraints:
 * - Attestation is optional (disabled by default)
 * - Attestation is non-blocking (failures logged, not thrown)
 * - Attestation never affects Registrum behavior
 * - No network calls, no private keys
 *
 * @module attestation
 */

// Types
export type {
  AttestationPayload,
  AttestationOptions,
  AttestationMode,
  ParityStatus,
  TransitionRange,
  XrplMemo,
  XrplAttestationMemos,
} from "./types.js";

// Generator (pure functions)
export {
  ATTESTATION_VERSION,
  REGISTRUM_VERSION,
  generateAttestationPayload,
  generateAttestationFromRegistrar,
  computeSnapshotHashForAttestation,
  canonicalizeForHash,
  serializeAttestationPayload,
  computeAttestationHash,
  toAttestationMode,
  encodeAsXrplMemos,
  decodeXrplMemos,
  validateAttestationPayload,
} from "./generator.js";

export type { RegistrarAttestationOptions } from "./generator.js";

// Configuration
export type {
  AttestationConfig,
  XrplAttestationConfig,
} from "./config.js";

export {
  DEFAULT_ATTESTATION_CONFIG,
  createAttestationConfig,
  validateAttestationConfig,
} from "./config.js";

// Emitter (non-blocking output)
export type { EmissionResult } from "./emitter.js";

export { emitAttestation, createAttestationHook } from "./emitter.js";
