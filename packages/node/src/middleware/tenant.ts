/**
 * Multi-tenancy middleware.
 *
 * Resolves the current tenant from the authenticated context
 * (set by auth middleware) and provides the appropriate
 * AttestiaService instance via c.set("service").
 */

import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types/api-contract.js";
import type { TenantRegistry } from "../services/tenant-registry.js";

/**
 * Create tenant resolution middleware.
 *
 * Must run AFTER auth middleware. Uses auth.tenantId to look up
 * or create the tenant's AttestiaService.
 */
export function tenantMiddleware(
  tenantRegistry: TenantRegistry,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = c.get("auth");
    const service = await tenantRegistry.getOrCreate(auth.tenantId);
    c.set("service", service);
    return next();
  };
}
