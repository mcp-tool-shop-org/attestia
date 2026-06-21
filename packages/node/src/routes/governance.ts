/**
 * Governance routes — per-tenant multi-sig policy administration.
 *
 * Mounted under /api/v1/governance (so every path inherits auth + tenant +
 * rate-limit + idempotency + body-limit from app.ts).
 *
 *   POST /signers          — Add a signer
 *   POST /signers/remove   — Remove a signer
 *   POST /quorum           — Change the quorum threshold
 *   GET  /policy           — Get the current governance policy
 *
 * Permission model: governance mutations are PRIVILEGED. They guard on
 * `requirePermission("admin")` (NOT "write") — changing the signer set or
 * quorum alters who can authorize value-moving actions, so it is an
 * admin-only operation. The read (`GET /policy`) requires only the ambient
 * authenticated context.
 *
 * DURABILITY + ERROR SURFACE (SEAM-2, fixed): these handlers call the
 * AttestiaService governance delegators (addSigner / removeSigner /
 * changeQuorum / getCurrentPolicy), NOT service.governanceStore directly. The
 * delegators route every mutation through the same durability gate (_mutate)
 * used by treasury + vault — appending the matching GOVERNANCE_* domain event to
 * the durable audit log (fail-closed) and triggering the snapshot cadence — so a
 * governance change is in the audit trail and survives a restart. The delegators
 * also translate the GovernanceStore's plain `Error`s (duplicate signer, unknown
 * signer, invalid quorum) into coded conflicts, which the global error handler
 * maps to a 4xx `{code,message,hint}` envelope instead of a generic 500.
 */

import { Hono } from "hono";
import type { AppEnv } from "../types/api-contract.js";
import {
  AddSignerSchema,
  RemoveSignerSchema,
  ChangeQuorumSchema,
} from "../types/dto-governance.js";
import type {
  AddSignerDto,
  RemoveSignerDto,
  ChangeQuorumDto,
} from "../types/dto-governance.js";
import { validateBody } from "../middleware/validate.js";
import { requirePermission } from "../middleware/auth.js";
import { setETag } from "../middleware/etag.js";
import type { MetricsCollector } from "../middleware/metrics.js";
import type { AuditLog } from "../services/audit-log.js";

export interface GovernanceRouteDeps {
  readonly metrics?: MetricsCollector | undefined;
  readonly auditLog?: AuditLog | undefined;
}

export function createGovernanceRoutes(
  deps?: GovernanceRouteDeps,
): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const metrics = deps?.metrics;
  const auditLog = deps?.auditLog;

  // POST /signers — Add a signer (admin only)
  routes.post(
    "/signers",
    requirePermission("admin"),
    validateBody(AddSignerSchema),
    (c) => {
      const service = c.get("service");
      const auth = c.get("auth");
      const body = c.get("validatedBody") as AddSignerDto;

      // Delegator routes through the durability gate (audit append + snapshot)
      // and maps store conflicts to coded 4xx; the route never imports witness.
      const policy = service.addSigner(
        body.address,
        body.label,
        body.weight,
        body.publicKey,
      );

      metrics?.incrementCounter("attestia_governance_total", {
        action: "add-signer",
      });
      auditLog?.append({
        tenantId: auth.tenantId,
        action: "add-signer",
        resourceType: "governance-signer",
        resourceId: body.address,
        actor: "api",
      });

      setETag(c, policy);
      return c.json({ data: policy }, 201);
    },
  );

  // POST /signers/remove — Remove a signer (admin only)
  //
  // Modeled as POST /signers/remove rather than DELETE /signers/:address so the
  // XRPL r-address (which is opaque and may need a body for future fields) is
  // carried in a validated body, consistent with the other mutations here.
  routes.post(
    "/signers/remove",
    requirePermission("admin"),
    validateBody(RemoveSignerSchema),
    (c) => {
      const service = c.get("service");
      const auth = c.get("auth");
      const body = c.get("validatedBody") as RemoveSignerDto;

      const policy = service.removeSigner(body.address);

      metrics?.incrementCounter("attestia_governance_total", {
        action: "remove-signer",
      });
      auditLog?.append({
        tenantId: auth.tenantId,
        action: "remove-signer",
        resourceType: "governance-signer",
        resourceId: body.address,
        actor: "api",
      });

      setETag(c, policy);
      return c.json({ data: policy });
    },
  );

  // POST /quorum — Change the quorum threshold (admin only)
  routes.post(
    "/quorum",
    requirePermission("admin"),
    validateBody(ChangeQuorumSchema),
    (c) => {
      const service = c.get("service");
      const auth = c.get("auth");
      const body = c.get("validatedBody") as ChangeQuorumDto;

      const policy = service.changeQuorum(body.quorum);

      metrics?.incrementCounter("attestia_governance_total", {
        action: "change-quorum",
      });
      auditLog?.append({
        tenantId: auth.tenantId,
        action: "change-quorum",
        resourceType: "governance-quorum",
        resourceId: String(body.quorum),
        actor: "api",
      });

      setETag(c, policy);
      return c.json({ data: policy });
    },
  );

  // GET /policy — Current governance policy
  routes.get("/policy", (c) => {
    const service = c.get("service");
    const policy = service.getCurrentPolicy();

    setETag(c, policy);
    return c.json({ data: policy });
  });

  return routes;
}
