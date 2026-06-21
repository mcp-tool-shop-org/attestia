/**
 * Treasury routes — payroll runs, distributions, and dual-gate funding.
 *
 * Mounted under /api/v1/treasury (so every path inherits auth + tenant +
 * rate-limit + idempotency + body-limit from app.ts).
 *
 * Payroll runs:
 *   POST /payroll-runs                — Create a run
 *   POST /payroll-runs/:id/approve    — Approve a run
 *   POST /payroll-runs/:id/execute    — Execute a run
 *   GET  /payroll-runs                — List runs (cursor pagination)
 *   GET  /payroll-runs/:id            — Get a single run
 *
 * Distributions:
 *   POST /distributions               — Create a plan
 *   POST /distributions/:id/approve   — Approve a plan
 *   POST /distributions/:id/compute   — Compute (dry-run) a plan
 *   POST /distributions/:id/execute   — Execute a plan
 *   GET  /distributions               — List plans (cursor pagination)
 *   GET  /distributions/:id           — Get a single plan
 *
 * Funding gates (dual approval):
 *   POST /funding-gates               — Submit a request
 *   POST /funding-gates/:id/approve   — Approve a gate
 *   POST /funding-gates/:id/reject    — Reject a request
 *   POST /funding-gates/:id/execute   — Execute a request
 *   GET  /funding-gates               — List requests (cursor pagination)
 *   GET  /funding-gates/:id           — Get a single request
 *
 * Handlers delegate exclusively to AttestiaService (the composition root); they
 * never import a domain package directly. Domain errors (RUN_NOT_FOUND,
 * PLAN_EXISTS, REQUESTER_CANNOT_APPROVE, …) propagate to the global error
 * handler, which maps them to a status + a safe human message.
 */

import { Hono } from "hono";
import type { AppEnv } from "../types/api-contract.js";
import {
  CreatePayrollRunSchema,
  ListPayrollRunsQuerySchema,
  CreateDistributionSchema,
  ListDistributionsQuerySchema,
  SubmitFundingSchema,
  ApproveFundingGateSchema,
  RejectFundingSchema,
  ListFundingRequestsQuerySchema,
} from "../types/dto-treasury.js";
import type {
  CreatePayrollRunDto,
  CreateDistributionDto,
  SubmitFundingDto,
  ApproveFundingGateDto,
  RejectFundingDto,
} from "../types/dto-treasury.js";
import { validateBody } from "../middleware/validate.js";
import { requirePermission } from "../middleware/auth.js";
import { setETag } from "../middleware/etag.js";
import { createErrorEnvelope } from "../types/error.js";
import { paginate } from "../types/pagination.js";
import type { MetricsCollector } from "../middleware/metrics.js";
import type { AuditLog } from "../services/audit-log.js";

export interface TreasuryRouteDeps {
  readonly metrics?: MetricsCollector | undefined;
  readonly auditLog?: AuditLog | undefined;
}

export function createTreasuryRoutes(deps?: TreasuryRouteDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const metrics = deps?.metrics;
  const auditLog = deps?.auditLog;

  // ───────────────────────────────────────────────────────────────────
  // Payroll runs
  // ───────────────────────────────────────────────────────────────────

  // POST /payroll-runs — Create
  routes.post(
    "/payroll-runs",
    requirePermission("write"),
    validateBody(CreatePayrollRunSchema),
    (c) => {
      const service = c.get("service");
      const auth = c.get("auth");
      const body = c.get("validatedBody") as CreatePayrollRunDto;

      const run = service.createPayrollRun(body.id, body.period);

      metrics?.incrementCounter("attestia_payroll_runs_total", {
        action: "create",
      });
      auditLog?.append({
        tenantId: auth.tenantId,
        action: "create",
        resourceType: "payroll-run",
        resourceId: body.id,
        actor: "api",
      });

      setETag(c, run);
      return c.json({ data: run }, 201);
    },
  );

  // POST /payroll-runs/:id/approve
  //
  // Pure action: the id is in the URL and there are no body fields, so this
  // route does NOT run validateBody (which would 400 a bodyless POST on
  // "Invalid JSON"). The mutation is still guarded by requirePermission.
  routes.post(
    "/payroll-runs/:id/approve",
    requirePermission("write"),
    (c) => {
      const service = c.get("service");
      const auth = c.get("auth");
      const id = c.req.param("id");

      const run = service.approvePayrollRun(id);

      metrics?.incrementCounter("attestia_payroll_runs_total", {
        action: "approve",
      });
      auditLog?.append({
        tenantId: auth.tenantId,
        action: "approve",
        resourceType: "payroll-run",
        resourceId: id,
        actor: "api",
      });

      setETag(c, run);
      return c.json({ data: run });
    },
  );

  // POST /payroll-runs/:id/execute (pure action — no body; see /approve above)
  routes.post(
    "/payroll-runs/:id/execute",
    requirePermission("write"),
    (c) => {
      const service = c.get("service");
      const auth = c.get("auth");
      const id = c.req.param("id");

      const run = service.executePayrollRun(id);

      metrics?.incrementCounter("attestia_payroll_runs_total", {
        action: "execute",
      });
      auditLog?.append({
        tenantId: auth.tenantId,
        action: "execute",
        resourceType: "payroll-run",
        resourceId: id,
        actor: "api",
      });

      setETag(c, run);
      return c.json({ data: run });
    },
  );

  // GET /payroll-runs — List
  routes.get("/payroll-runs", (c) => {
    const service = c.get("service");

    const queryResult = ListPayrollRunsQuerySchema.safeParse(c.req.query());
    if (!queryResult.success) {
      return c.json(
        createErrorEnvelope("VALIDATION_ERROR", "Invalid query parameters"),
        400,
      );
    }
    const query = queryResult.data;

    // Sort by createdAt ascending for stable pagination.
    const sorted = [...service.listPayrollRuns()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );

    const result = paginate(
      sorted,
      { cursor: query.cursor, limit: query.limit },
      (run) => run.createdAt,
      "createdAt",
    );

    return c.json(result);
  });

  // GET /payroll-runs/:id — Get one
  routes.get("/payroll-runs/:id", (c) => {
    const service = c.get("service");
    const id = c.req.param("id");

    const run = service.listPayrollRuns().find((r) => r.id === id);
    if (run === undefined) {
      return c.json(
        createErrorEnvelope("NOT_FOUND", `Payroll run '${id}' not found`),
        404,
      );
    }

    setETag(c, run);
    return c.json({ data: run });
  });

  // ───────────────────────────────────────────────────────────────────
  // Distributions
  // ───────────────────────────────────────────────────────────────────

  // POST /distributions — Create
  routes.post(
    "/distributions",
    requirePermission("write"),
    validateBody(CreateDistributionSchema),
    (c) => {
      const service = c.get("service");
      const auth = c.get("auth");
      const body = c.get("validatedBody") as CreateDistributionDto;

      // Normalize each recipient, omitting absent optionals rather than passing
      // them as `undefined` (the domain type uses exactOptionalPropertyTypes:
      // `share?: number`, not `share?: number | undefined`).
      const recipients = body.recipients.map((r) => ({
        payeeId: r.payeeId,
        ...(r.share !== undefined ? { share: r.share } : {}),
        ...(r.amount !== undefined ? { amount: r.amount } : {}),
        ...(r.milestoneMet !== undefined ? { milestoneMet: r.milestoneMet } : {}),
      }));

      const plan = service.createDistribution(
        body.id,
        body.name,
        body.strategy,
        body.pool,
        recipients,
      );

      metrics?.incrementCounter("attestia_distributions_total", {
        action: "create",
      });
      auditLog?.append({
        tenantId: auth.tenantId,
        action: "create",
        resourceType: "distribution",
        resourceId: body.id,
        actor: "api",
      });

      setETag(c, plan);
      return c.json({ data: plan }, 201);
    },
  );

  // POST /distributions/:id/approve (pure action — no body)
  routes.post(
    "/distributions/:id/approve",
    requirePermission("write"),
    (c) => {
      const service = c.get("service");
      const auth = c.get("auth");
      const id = c.req.param("id");

      const plan = service.approveDistribution(id);

      metrics?.incrementCounter("attestia_distributions_total", {
        action: "approve",
      });
      auditLog?.append({
        tenantId: auth.tenantId,
        action: "approve",
        resourceType: "distribution",
        resourceId: id,
        actor: "api",
      });

      setETag(c, plan);
      return c.json({ data: plan });
    },
  );

  // POST /distributions/:id/compute — dry-run the payout math (no mutation, no body).
  routes.post(
    "/distributions/:id/compute",
    requirePermission("write"),
    (c) => {
      const service = c.get("service");
      const id = c.req.param("id");

      const result = service.computeDistribution(id);

      metrics?.incrementCounter("attestia_distributions_total", {
        action: "compute",
      });

      return c.json({ data: result });
    },
  );

  // POST /distributions/:id/execute (pure action — no body)
  routes.post(
    "/distributions/:id/execute",
    requirePermission("write"),
    (c) => {
      const service = c.get("service");
      const auth = c.get("auth");
      const id = c.req.param("id");

      const result = service.executeDistribution(id);

      metrics?.incrementCounter("attestia_distributions_total", {
        action: "execute",
      });
      auditLog?.append({
        tenantId: auth.tenantId,
        action: "execute",
        resourceType: "distribution",
        resourceId: id,
        actor: "api",
      });

      return c.json({ data: result });
    },
  );

  // GET /distributions — List
  routes.get("/distributions", (c) => {
    const service = c.get("service");

    const queryResult = ListDistributionsQuerySchema.safeParse(c.req.query());
    if (!queryResult.success) {
      return c.json(
        createErrorEnvelope("VALIDATION_ERROR", "Invalid query parameters"),
        400,
      );
    }
    const query = queryResult.data;

    const sorted = [...service.listDistributions()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );

    const result = paginate(
      sorted,
      { cursor: query.cursor, limit: query.limit },
      (plan) => plan.createdAt,
      "createdAt",
    );

    return c.json(result);
  });

  // GET /distributions/:id — Get one
  routes.get("/distributions/:id", (c) => {
    const service = c.get("service");
    const id = c.req.param("id");

    const plan = service.getDistribution(id);
    if (plan === undefined) {
      return c.json(
        createErrorEnvelope("NOT_FOUND", `Distribution '${id}' not found`),
        404,
      );
    }

    setETag(c, plan);
    return c.json({ data: plan });
  });

  // ───────────────────────────────────────────────────────────────────
  // Funding gates (dual approval)
  // ───────────────────────────────────────────────────────────────────

  // POST /funding-gates — Submit
  routes.post(
    "/funding-gates",
    requirePermission("write"),
    validateBody(SubmitFundingSchema),
    (c) => {
      const service = c.get("service");
      const auth = c.get("auth");
      const body = c.get("validatedBody") as SubmitFundingDto;

      // SECURITY (AUTHZ-FUNDING-SOD-BYPASS): bind the requester to the
      // authenticated principal — never a client-supplied label. Trusting a body
      // field let one key forge distinct requester/approver identities and defeat
      // the domain's two-distinct-approver separation of duties, and recorded a
      // forged actor in the audit log. Mirrors intents.ts (server-derived actor).
      const request = service.submitFunding(
        body.id,
        body.description,
        body.amount,
        auth.identity,
      );

      metrics?.incrementCounter("attestia_funding_requests_total", {
        action: "submit",
      });
      auditLog?.append({
        tenantId: auth.tenantId,
        action: "submit",
        resourceType: "funding-request",
        resourceId: body.id,
        actor: auth.identity,
      });

      setETag(c, request);
      return c.json({ data: request }, 201);
    },
  );

  // POST /funding-gates/:id/approve
  routes.post(
    "/funding-gates/:id/approve",
    requirePermission("write"),
    validateBody(ApproveFundingGateSchema),
    (c) => {
      const service = c.get("service");
      const auth = c.get("auth");
      const id = c.req.param("id");
      const body = c.get("validatedBody") as ApproveFundingGateDto;

      // SECURITY (AUTHZ-FUNDING-SOD-BYPASS): the approver is the authenticated
      // principal, never a client-supplied label. This is what makes the domain's
      // gate1 !== gate2 / REQUESTER_CANNOT_APPROVE checks enforce SoD against the
      // REAL caller — one key can no longer self-satisfy both gates.
      const request = service.approveFundingGate(
        id,
        auth.identity,
        body.reason,
      );

      metrics?.incrementCounter("attestia_funding_requests_total", {
        action: "approve",
      });
      auditLog?.append({
        tenantId: auth.tenantId,
        action: "approve",
        resourceType: "funding-request",
        resourceId: id,
        actor: auth.identity,
      });

      setETag(c, request);
      return c.json({ data: request });
    },
  );

  // POST /funding-gates/:id/reject
  routes.post(
    "/funding-gates/:id/reject",
    requirePermission("write"),
    validateBody(RejectFundingSchema),
    (c) => {
      const service = c.get("service");
      const auth = c.get("auth");
      const id = c.req.param("id");
      const body = c.get("validatedBody") as RejectFundingDto;

      // SECURITY (AUTHZ-FUNDING-SOD-BYPASS): the rejector is the authenticated
      // principal, never a client-supplied label.
      const request = service.rejectFunding(id, auth.identity, body.reason);

      metrics?.incrementCounter("attestia_funding_requests_total", {
        action: "reject",
      });
      auditLog?.append({
        tenantId: auth.tenantId,
        action: "reject",
        resourceType: "funding-request",
        resourceId: id,
        actor: auth.identity,
      });

      setETag(c, request);
      return c.json({ data: request });
    },
  );

  // POST /funding-gates/:id/execute (pure action — no body)
  routes.post(
    "/funding-gates/:id/execute",
    requirePermission("write"),
    (c) => {
      const service = c.get("service");
      const auth = c.get("auth");
      const id = c.req.param("id");

      const request = service.executeFunding(id);

      metrics?.incrementCounter("attestia_funding_requests_total", {
        action: "execute",
      });
      auditLog?.append({
        tenantId: auth.tenantId,
        action: "execute",
        resourceType: "funding-request",
        resourceId: id,
        actor: "api",
      });

      setETag(c, request);
      return c.json({ data: request });
    },
  );

  // GET /funding-gates — List
  routes.get("/funding-gates", (c) => {
    const service = c.get("service");

    const queryResult = ListFundingRequestsQuerySchema.safeParse(
      c.req.query(),
    );
    if (!queryResult.success) {
      return c.json(
        createErrorEnvelope("VALIDATION_ERROR", "Invalid query parameters"),
        400,
      );
    }
    const query = queryResult.data;

    const sorted = [...service.listFundingRequests()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );

    const result = paginate(
      sorted,
      { cursor: query.cursor, limit: query.limit },
      (request) => request.createdAt,
      "createdAt",
    );

    return c.json(result);
  });

  // GET /funding-gates/:id — Get one
  routes.get("/funding-gates/:id", (c) => {
    const service = c.get("service");
    const id = c.req.param("id");

    const request = service
      .listFundingRequests()
      .find((r) => r.id === id);
    if (request === undefined) {
      return c.json(
        createErrorEnvelope("NOT_FOUND", `Funding request '${id}' not found`),
        404,
      );
    }

    setETag(c, request);
    return c.json({ data: request });
  });

  return routes;
}
