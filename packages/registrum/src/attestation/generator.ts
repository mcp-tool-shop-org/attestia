/**
 * Attestation Payload Generator
 *
 * Pure functions for generating attestation payloads from snapshots.
 * No network calls, no side effects, no private keys.
 *
 * Think: `git hash-object`, not `git push`.
 *
 * @module attestation/generator
 */

import { createHash } from "crypto";
import { canonicalize } from "json-canonicalize";
import type { RegistrarSnapshotV1 } from "../persistence/snapshot.js";
import type {
  AttestationPayload,
  AttestationOptions,
  AttestationMode,
  XrplAttestationMemos,
} from "./types.js";
import { REGISTRUM_VERSION } from "../version.js";
import { StructuralRegistrar } from "../structural-registrar.js";

/** Current attestation specification version */
export const ATTESTATION_VERSION = "1.0";

// Re-export version for backwards compatibility
export { REGISTRUM_VERSION };

/**
 * Generate an attestation payload from a snapshot.
 *
 * This is a pure function with deterministic output.
 *
 * @param snapshot - The registrar snapshot to attest
 * @param registryHash - Content-addressed hash of the registry
 * @param options - Attestation options
 * @returns Attestation payload
 */
export function generateAttestationPayload(
  snapshot: RegistrarSnapshotV1,
  registryHash: string,
  options: AttestationOptions
): AttestationPayload {
  // Constitution-binding (fail-closed): the attestation's top-level
  // registry_hash advertises the constitution the attested snapshot was
  // produced under. The snapshot ALREADY carries that real content hash in
  // `snapshot.registry_hash`. If the caller-supplied registryHash disagrees,
  // the attestation would advertise a registry the snapshot was NOT produced
  // under — a spec-compliant verifier checking registry_hash against a local
  // registry could then pass an attestation of a snapshot produced under a
  // different/weaker constitution. Refuse to stamp a mismatched binding.
  if (registryHash !== snapshot.registry_hash) {
    throw new Error(
      `Attestation registry_hash mismatch: caller-supplied registryHash ` +
        `'${registryHash}' does not match snapshot.registry_hash ` +
        `'${snapshot.registry_hash}'. The attestation must witness the ` +
        `constitution the snapshot was actually produced under (fail-closed).`
    );
  }

  const snapshotHash = computeSnapshotHashForAttestation(snapshot);

  return {
    registrum_version: options.registrumVersion,
    snapshot_version: String(snapshot.version),
    snapshot_hash: snapshotHash,
    registry_hash: registryHash,
    mode: options.mode,
    parity_status: options.parityStatus,
    transition_range: {
      from: options.transitionFrom,
      to: options.transitionTo,
    },
    state_count: snapshot.state_ids.length,
    ordering_max: snapshot.ordering.max_index,
  };
}

/**
 * Options for deriving an attestation directly from a dual-witness registrar.
 */
export interface RegistrarAttestationOptions {
  /** Content-addressed registry hash (64 hex chars). */
  readonly registryHash: string;
  /** First transition index covered (inclusive). */
  readonly transitionFrom: number;
  /** Last transition index covered (inclusive). */
  readonly transitionTo: number;
  /** Override the Registrum version string (defaults to REGISTRUM_VERSION). */
  readonly registrumVersion?: string;
}

/**
 * Generate an attestation payload from a registrar, deriving `parity_status`
 * and `mode` from the registrar's ACTUAL dual-witness comparison rather than
 * accepting them as caller input.
 *
 * Fail-closed: if no dual-witness comparison has run yet (parity status is
 * null), this throws — an attestation must witness a real comparison, not a
 * fabricated one. This is the runtime counterpart to dual-witness governance:
 * the attestation cannot claim AGREED unless the comparator actually agreed.
 *
 * @param registrar - A dual-witness StructuralRegistrar that has executed at
 *   least one register()/validate().
 * @param options - Registry hash + transition range.
 * @returns Attestation payload with parity_status taken from the comparator.
 */
export function generateAttestationFromRegistrar(
  registrar: StructuralRegistrar,
  options: RegistrarAttestationOptions
): AttestationPayload {
  const parityStatus = registrar.getLastParityStatus();
  if (parityStatus === null) {
    throw new Error(
      "Cannot attest: no dual-witness parity comparison has been performed. " +
        "Run register()/validate() on a dual-witness registrar first."
    );
  }

  const mode = toAttestationMode(
    // In dual mode the underlying engine is registry-authoritative; map to the
    // attestation mode via the real parity outcome.
    registrar.getMode() === "legacy" ? "legacy" : "registry",
    parityStatus
  );

  const snapshot = registrar.snapshot();

  // Fail-closed constitution binding: the snapshot carries the REAL registry
  // content hash it was produced under. We bind the attestation to THAT hash,
  // never to unverified caller input. If a caller still supplies
  // options.registryHash (preserved for API stability), it must equal the
  // snapshot's hash — a disagreement means the caller believes the snapshot was
  // produced under a different constitution than it actually was, which would
  // forge the constitution binding. Refuse rather than silently trust input.
  if (options.registryHash !== snapshot.registry_hash) {
    throw new Error(
      `Attestation registry_hash mismatch: supplied registryHash ` +
        `'${options.registryHash}' does not match the registrar snapshot's ` +
        `registry_hash '${snapshot.registry_hash}'. An attestation must ` +
        `witness the constitution the snapshot was actually produced under ` +
        `(fail-closed).`
    );
  }

  return generateAttestationPayload(snapshot, snapshot.registry_hash, {
    registrumVersion: options.registrumVersion ?? REGISTRUM_VERSION,
    mode,
    parityStatus,
    transitionFrom: options.transitionFrom,
    transitionTo: options.transitionTo,
  });
}

/**
 * Compute content-addressed hash of a snapshot for attestation.
 *
 * Uses canonical JSON encoding with deterministic key ordering.
 *
 * @param snapshot - Snapshot to hash
 * @returns Hex-encoded SHA-256 hash (64 characters, lowercase)
 */
export function computeSnapshotHashForAttestation(
  snapshot: RegistrarSnapshotV1
): string {
  const canonical = canonicalizeForHash(snapshot);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Canonicalize an object for hashing.
 *
 * Uses RFC 8785 (JSON Canonicalization Scheme) for deterministic output.
 *
 * @param obj - Object to canonicalize
 * @returns Canonical JSON string (RFC 8785)
 */
export function canonicalizeForHash(obj: unknown): string {
  return canonicalize(obj);
}

/**
 * JSON replacer that sorts object keys alphabetically.
 * Used for human-readable serialization (pretty-print), not for hashing.
 */
function sortedReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}

/**
 * Serialize attestation payload to canonical JSON.
 *
 * Output is deterministic and suitable for verification.
 *
 * @param payload - Attestation payload
 * @returns Canonical JSON string
 */
export function serializeAttestationPayload(
  payload: AttestationPayload
): string {
  return JSON.stringify(payload, sortedReplacer, 2);
}

/**
 * Compute hash of attestation payload.
 *
 * Can be used to verify payload integrity.
 *
 * @param payload - Attestation payload
 * @returns Hex-encoded SHA-256 hash
 */
export function computeAttestationHash(payload: AttestationPayload): string {
  const canonical = canonicalizeForHash(payload);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Convert attestation mode from registrar mode.
 *
 * @param registrarMode - Registrar operating mode
 * @param parityStatus - Whether witnesses agree
 * @returns Attestation mode
 */
export function toAttestationMode(
  registrarMode: "legacy" | "registry",
  parityStatus: "AGREED" | "HALTED"
): AttestationMode {
  // If parity is agreed, we're effectively in dual mode
  if (parityStatus === "AGREED") {
    return "dual";
  }
  // If halted, report the active mode
  return registrarMode === "legacy" ? "legacy-only" : "registry-only";
}

/**
 * Encode attestation payload as XRPL memos.
 *
 * Produces memo entries suitable for XRPL Payment transaction.
 * Memo ordering is alphabetical by type (deterministic).
 *
 * @param payload - Attestation payload
 * @returns XRPL memo structure
 */
export function encodeAsXrplMemos(
  payload: AttestationPayload
): XrplAttestationMemos {
  const memos: { type: string; data: string }[] = [
    { type: "registrum:mode", data: payload.mode },
    { type: "registrum:ordering_max", data: String(payload.ordering_max) },
    { type: "registrum:parity", data: payload.parity_status },
    {
      type: "registrum:range",
      data: `${payload.transition_range.from}-${payload.transition_range.to}`,
    },
    { type: "registrum:registry_hash", data: payload.registry_hash },
    { type: "registrum:snapshot_hash", data: payload.snapshot_hash },
    {
      type: "registrum:snapshot_version",
      data: payload.snapshot_version,
    },
    { type: "registrum:state_count", data: String(payload.state_count) },
    { type: "registrum:version", data: payload.registrum_version },
  ];

  // Sort alphabetically by type for determinism
  memos.sort((a, b) => a.type.localeCompare(b.type));

  return {
    Memos: memos.map(({ type, data }) => ({
      Memo: {
        MemoType: Buffer.from(type, "utf8").toString("hex").toUpperCase(),
        MemoData: Buffer.from(data, "utf8").toString("hex").toUpperCase(),
      },
    })),
  };
}

/**
 * Decode XRPL memos back to attestation payload.
 *
 * Used for verification of on-ledger attestations.
 *
 * @param memos - XRPL memo structure
 * @returns Partial attestation payload (may be incomplete if memos missing)
 */
export function decodeXrplMemos(
  memos: XrplAttestationMemos
): Partial<AttestationPayload> {
  const result: Record<string, string> = {};

  for (const { Memo } of memos.Memos) {
    const type = Buffer.from(Memo.MemoType, "hex").toString("utf8");
    const data = Buffer.from(Memo.MemoData, "hex").toString("utf8");
    result[type] = data;
  }

  const rangeParts = result["registrum:range"]?.split("-");

  const payload: Record<string, unknown> = {};

  if (result["registrum:version"] !== undefined) {
    payload["registrum_version"] = result["registrum:version"];
  }
  if (result["registrum:snapshot_version"] !== undefined) {
    payload["snapshot_version"] = result["registrum:snapshot_version"];
  }
  if (result["registrum:snapshot_hash"] !== undefined) {
    payload["snapshot_hash"] = result["registrum:snapshot_hash"];
  }
  if (result["registrum:registry_hash"] !== undefined) {
    payload["registry_hash"] = result["registrum:registry_hash"];
  }
  if (result["registrum:mode"] !== undefined) {
    payload["mode"] = result["registrum:mode"] as AttestationMode;
  }
  if (result["registrum:parity"] !== undefined) {
    payload["parity_status"] = result["registrum:parity"] as "AGREED" | "HALTED";
  }
  if (rangeParts && rangeParts[0] !== undefined && rangeParts[1] !== undefined) {
    payload["transition_range"] = {
      from: parseInt(rangeParts[0], 10),
      to: parseInt(rangeParts[1], 10),
    };
  }
  if (result["registrum:state_count"] !== undefined) {
    payload["state_count"] = parseInt(result["registrum:state_count"], 10);
  }
  if (result["registrum:ordering_max"] !== undefined) {
    payload["ordering_max"] = parseInt(result["registrum:ordering_max"], 10);
  }

  return payload as Partial<AttestationPayload>;
}

/**
 * Validate attestation payload structure.
 *
 * @param payload - Payload to validate
 * @throws Error if payload is invalid
 */
export function validateAttestationPayload(payload: unknown): void {
  if (payload === null || typeof payload !== "object") {
    throw new Error("Attestation payload must be an object");
  }

  const p = payload as Record<string, unknown>;

  // Required string fields
  const stringFields = [
    "registrum_version",
    "snapshot_version",
    "snapshot_hash",
    "registry_hash",
    "mode",
    "parity_status",
  ];

  for (const field of stringFields) {
    if (typeof p[field] !== "string") {
      throw new Error(`Attestation payload missing or invalid: ${field}`);
    }
  }

  // Required number fields
  const numberFields = ["state_count", "ordering_max"];
  for (const field of numberFields) {
    if (typeof p[field] !== "number" || !Number.isInteger(p[field])) {
      throw new Error(`Attestation payload missing or invalid: ${field}`);
    }
  }

  // Validate transition_range
  if (
    typeof p.transition_range !== "object" ||
    p.transition_range === null ||
    typeof (p.transition_range as Record<string, unknown>).from !== "number" ||
    typeof (p.transition_range as Record<string, unknown>).to !== "number"
  ) {
    throw new Error("Attestation payload missing or invalid: transition_range");
  }

  // Validate mode enum
  if (!["dual", "legacy-only", "registry-only"].includes(p.mode as string)) {
    throw new Error(`Invalid attestation mode: ${p.mode}`);
  }

  // Validate parity_status enum
  if (!["AGREED", "HALTED"].includes(p.parity_status as string)) {
    throw new Error(`Invalid parity status: ${p.parity_status}`);
  }

  // Validate hash format (64 hex chars)
  const hashRegex = /^[0-9a-f]{64}$/;
  if (!hashRegex.test(p.snapshot_hash as string)) {
    throw new Error("Invalid snapshot_hash format (expected 64 hex chars)");
  }
  if (!hashRegex.test(p.registry_hash as string)) {
    throw new Error("Invalid registry_hash format (expected 64 hex chars)");
  }
}

/**
 * Verify that an attestation is correctly bound to the snapshot it claims to
 * witness — the single function an external verifier can call to close the
 * constitution-binding gap.
 *
 * Two fail-closed bindings are checked:
 *
 * 1. **Snapshot binding** — the payload's `snapshot_hash` MUST equal the hash
 *    recomputed from the supplied snapshot. This proves the attestation
 *    actually witnesses THIS snapshot and not some other state set.
 *
 * 2. **Constitution binding** — the payload's top-level `registry_hash` MUST
 *    equal the snapshot's own `registry_hash`. This is the gap a verifier that
 *    only checks `registry_hash` against a local registry cannot see on its
 *    own: an attestation could advertise a "good" constitution hash while
 *    witnessing a snapshot produced under a different/weaker constitution.
 *    Asserting equality here makes that forgery fail closed.
 *
 * Determinism: `snapshot_hash` is recomputed via {@link
 * computeSnapshotHashForAttestation} (RFC 8785 canonicalization, no wall-clock
 * input), so the same (payload, snapshot) pair always verifies identically.
 *
 * @param payload - The attestation payload to verify.
 * @param snapshot - The snapshot the attestation claims to witness.
 * @throws Error if either binding fails. Returns normally on success.
 */
export function verifyAttestationBinding(
  payload: AttestationPayload,
  snapshot: RegistrarSnapshotV1
): void {
  // Structural validation first, so downstream comparisons act on a
  // well-formed payload (and so a malformed payload fails with a clear shape
  // error rather than a confusing binding error).
  validateAttestationPayload(payload);

  // Constitution binding: top-level registry_hash MUST match the snapshot's.
  if (payload.registry_hash !== snapshot.registry_hash) {
    throw new Error(
      `Attestation constitution binding failed: payload.registry_hash ` +
        `'${payload.registry_hash}' does not match snapshot.registry_hash ` +
        `'${snapshot.registry_hash}'. The attestation advertises a different ` +
        `constitution than the snapshot was produced under (rejected ` +
        `fail-closed).`
    );
  }

  // Snapshot binding: recompute the snapshot hash and require it to match.
  const recomputed = computeSnapshotHashForAttestation(snapshot);
  if (payload.snapshot_hash !== recomputed) {
    throw new Error(
      `Attestation snapshot binding failed: payload.snapshot_hash ` +
        `'${payload.snapshot_hash}' does not match the hash recomputed from ` +
        `the supplied snapshot '${recomputed}'. The attestation does not ` +
        `witness this snapshot (rejected fail-closed).`
    );
  }
}
