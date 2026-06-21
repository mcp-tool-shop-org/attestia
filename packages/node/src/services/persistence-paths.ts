/**
 * persistence-paths — Per-tenant durable storage layout.
 *
 * When an {@link AttestiaService} is configured with persistence, every tenant
 * gets its OWN directory under the configured `dataDir`, keyed by the SHA-256 of
 * its `ownerId`. The full hex digest is used (not a slice) so two distinct
 * tenants can never collide on a shorter prefix — a collision would leak one
 * tenant's audit log and snapshots into another's, which is the worst failure a
 * multi-tenant attestation system can have. Hashing also keeps an arbitrary
 * `ownerId` (which may contain path separators, `..`, or other filesystem
 * metacharacters) from escaping `dataDir` — the digest is always a flat 64-char
 * hex string, so a malicious tenant id cannot traverse outside its own slot.
 *
 * Layout:
 *
 *   <dataDir>/
 *     <sha256(ownerId)>/          ← tenantDir, one per tenant
 *       events.jsonl              ← durable append-only event log (audit truth)
 *       snapshots/                ← FileSnapshotStore base dir (restore path)
 *         ledger/<version>.json
 *         registrar/<version>.json
 *         vault/<version>.json
 *         treasury/<version>.json
 *         governance/<version>.json
 *         _manifest/<version>.json
 */

import { createHash } from "node:crypto";
import { join } from "node:path";

/**
 * The resolved on-disk paths for a single tenant's durable state.
 */
export interface TenantPaths {
  /** Tenant-private directory: `<dataDir>/<sha256(ownerId)>`. */
  readonly tenantDir: string;
  /** Append-only event log file: `<tenantDir>/events.jsonl`. */
  readonly eventLogPath: string;
  /** Snapshot store base dir: `<tenantDir>/snapshots`. */
  readonly snapshotBaseDir: string;
}

/**
 * Compute the full SHA-256 hex digest of a tenant's `ownerId`.
 *
 * Exposed separately so callers (and tests) can assert that the directory name
 * is the FULL digest, never a truncated prefix.
 */
export function tenantHash(ownerId: string): string {
  return createHash("sha256").update(ownerId, "utf8").digest("hex");
}

/**
 * Derive the per-tenant durable storage paths under a base `dataDir`.
 *
 * A service only ever opens the paths returned here for its OWN `ownerId`, so
 * there is no cross-tenant leakage: each tenant's events and snapshots live in a
 * directory whose name is the full hash of its own id.
 *
 * @param dataDir - The persistence root shared by all tenants of one service
 *   tree (from `AttestiaServiceConfig.persistence.dataDir`).
 * @param ownerId - The tenant identity (the service's `ownerId`).
 */
export function tenantPaths(dataDir: string, ownerId: string): TenantPaths {
  const tenantDir = join(dataDir, tenantHash(ownerId));
  return {
    tenantDir,
    eventLogPath: join(tenantDir, "events.jsonl"),
    snapshotBaseDir: join(tenantDir, "snapshots"),
  };
}
