/**
 * TenantRegistry — Maps tenant IDs to isolated AttestiaService instances.
 *
 * Each tenant gets its own domain layer (vault, ledger, treasury, etc.)
 * for complete data isolation.
 */

import { AttestiaService } from "./attestia-service.js";
import type { AttestiaServiceConfig, PersistenceConfig } from "./attestia-service.js";

/**
 * The explicit log path belongs to the configured owner. Another tenant keeps
 * the hashed directory under dataDir, so two tenants do not share one file.
 */
function persistenceForTenant(
  persistence: PersistenceConfig | undefined,
  tenantId: string,
  ownerId: string,
): PersistenceConfig | undefined {
  if (persistence === undefined) return undefined;
  if (tenantId === ownerId || persistence.eventLogPath === undefined) return persistence;
  const { eventLogPath: _eventLogPath, ...rest } = persistence;
  return rest;
}

export class TenantRegistry {
  private readonly _tenants = new Map<string, AttestiaService>();
  /**
   * Per-tenant initialize() promise, cached so concurrent getOrCreate calls for
   * the SAME newly-created tenant await the SAME init (no double-init, no race).
   * Held even after resolution so a later getOrCreate is a cheap awaited cache
   * hit; cleared in stopAll().
   */
  private readonly _inits = new Map<string, Promise<AttestiaService>>();
  private readonly _defaultConfig: AttestiaServiceConfig;

  constructor(defaultConfig: AttestiaServiceConfig) {
    this._defaultConfig = defaultConfig;
  }

  /**
   * Get or lazily create the service instance for a tenant.
   *
   * SEAM-1 (DUR-COMPOSED-001): a newly-created service is initialize()d BEFORE
   * it is returned, so its durable state is restored (restoreAll) and the
   * crash-window check runs. This makes restore part of the construction
   * contract — the registry path is the production multi-tenant path, and
   * skipping initialize() here left a restarted tenant EMPTY while the durable
   * audit log still held its data (permanent divergence).
   *
   * Initialization is awaited through a per-tenant cached promise so concurrent
   * callers for the same new tenant share ONE init. For an in-memory (no
   * persistence) tenant, initialize() is a cheap no-op restore + writability
   * check, so this is essentially free.
   */
  async getOrCreate(tenantId: string): Promise<AttestiaService> {
    const existing = this._inits.get(tenantId);
    if (existing !== undefined) {
      return existing;
    }
    const { persistence: configured, ...shared } = this._defaultConfig;
    // The compose path is the configured owner's log. Other tenants keep
    // `<dataDir>/<sha256(ownerId)>/events.jsonl`.
    const persistence = persistenceForTenant(configured, tenantId, this._defaultConfig.ownerId);
    const service = new AttestiaService({
      ...shared,
      ownerId: tenantId,
      ...(persistence !== undefined ? { persistence } : {}),
    });
    this._tenants.set(tenantId, service);
    const init = service.initialize().then(() => service);
    this._inits.set(tenantId, init);
    return init;
  }

  /**
   * Check if a tenant has been initialized.
   */
  has(tenantId: string): boolean {
    return this._tenants.has(tenantId);
  }

  /**
   * Get all initialized tenant IDs.
   */
  tenantIds(): readonly string[] {
    return [...this._tenants.keys()];
  }

  /**
   * Gracefully stop all tenant services.
   */
  async stopAll(): Promise<void> {
    const stops = [...this._tenants.values()].map((s) => s.stop());
    await Promise.all(stops);
    this._tenants.clear();
    this._inits.clear();
  }
}
