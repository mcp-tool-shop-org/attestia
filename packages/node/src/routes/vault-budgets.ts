/**
 * Vault budget / portfolio routes.
 *
 * Mounted under /api/v1/vault (so every path inherits auth + tenant +
 * rate-limit + idempotency + body-limit from app.ts).
 *
 *   POST /envelopes                — Create a budget envelope
 *   POST /envelopes/:id/allocate   — Allocate funds into an envelope
 *   GET  /budget                   — Get the budget snapshot
 *   GET  /envelopes                — List envelopes (cursor pagination)
 *   GET  /portfolio                — Observe the multi-chain portfolio
 *
 * Handlers delegate exclusively to AttestiaService; they never import the vault
 * package directly. Domain errors (ENVELOPE_EXISTS, ENVELOPE_NOT_FOUND,
 * INSUFFICIENT_BUDGET, CURRENCY_MISMATCH, …) propagate to the global error
 * handler.
 */

import { Hono } from "hono";
import type { AppEnv } from "../types/api-contract.js";
import {
  CreateEnvelopeSchema,
  AllocateEnvelopeSchema,
  ListEnvelopesQuerySchema,
} from "../types/dto-vault.js";
import type {
  CreateEnvelopeDto,
  AllocateEnvelopeDto,
} from "../types/dto-vault.js";
import { validateBody } from "../middleware/validate.js";
import { requirePermission } from "../middleware/auth.js";
import { setETag } from "../middleware/etag.js";
import { createErrorEnvelope } from "../types/error.js";
import { paginate } from "../types/pagination.js";
import type { MetricsCollector } from "../middleware/metrics.js";
import type { AuditLog } from "../services/audit-log.js";

export interface VaultBudgetRouteDeps {
  readonly metrics?: MetricsCollector | undefined;
  readonly auditLog?: AuditLog | undefined;
}

export function createVaultBudgetRoutes(
  deps?: VaultBudgetRouteDeps,
): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const metrics = deps?.metrics;
  const auditLog = deps?.auditLog;

  // POST /envelopes — Create
  routes.post(
    "/envelopes",
    requirePermission("write"),
    validateBody(CreateEnvelopeSchema),
    (c) => {
      const service = c.get("service");
      const auth = c.get("auth");
      const body = c.get("validatedBody") as CreateEnvelopeDto;

      const envelope = service.createEnvelope(body.id, body.name, body.category);

      metrics?.incrementCounter("attestia_envelopes_total", {
        action: "create",
      });
      auditLog?.append({
        tenantId: auth.tenantId,
        action: "create",
        resourceType: "envelope",
        resourceId: body.id,
        actor: "api",
      });

      setETag(c, envelope);
      return c.json({ data: envelope }, 201);
    },
  );

  // POST /envelopes/:id/allocate
  routes.post(
    "/envelopes/:id/allocate",
    requirePermission("write"),
    validateBody(AllocateEnvelopeSchema),
    (c) => {
      const service = c.get("service");
      const auth = c.get("auth");
      const id = c.req.param("id");
      const body = c.get("validatedBody") as AllocateEnvelopeDto;

      const envelope = service.allocateToEnvelope(id, body.amount);

      metrics?.incrementCounter("attestia_envelopes_total", {
        action: "allocate",
      });
      auditLog?.append({
        tenantId: auth.tenantId,
        action: "allocate",
        resourceType: "envelope",
        resourceId: id,
        actor: "api",
      });

      setETag(c, envelope);
      return c.json({ data: envelope });
    },
  );

  // GET /budget — Snapshot
  routes.get("/budget", (c) => {
    const service = c.get("service");
    const budget = service.getBudget();

    setETag(c, budget);
    return c.json({ data: budget });
  });

  // GET /envelopes — List
  routes.get("/envelopes", (c) => {
    const service = c.get("service");

    const queryResult = ListEnvelopesQuerySchema.safeParse(c.req.query());
    if (!queryResult.success) {
      return c.json(
        createErrorEnvelope("VALIDATION_ERROR", "Invalid query parameters"),
        400,
      );
    }
    const query = queryResult.data;

    // Envelopes carry no timestamp; paginate by id for a stable order.
    const sorted = [...service.listEnvelopes()].sort((a, b) =>
      a.id.localeCompare(b.id),
    );

    const result = paginate(
      sorted,
      { cursor: query.cursor, limit: query.limit },
      (envelope) => envelope.id,
      "id",
    );

    return c.json(result);
  });

  // GET /portfolio — Observe multi-chain balances
  routes.get("/portfolio", async (c) => {
    const service = c.get("service");
    const portfolio = await service.observePortfolio();

    return c.json({ data: portfolio });
  });

  return routes;
}
