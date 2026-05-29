/**
 * Public verification routes — no authentication required.
 *
 * These endpoints allow external verifiers to:
 * 1. Download a state bundle for independent verification
 * 2. Check the system's current health/hash
 * 3. Submit verification reports
 * 4. View consensus from all submitted reports
 * 5. List submitted reports (paginated)
 *
 * Mounted at /public/v1/verify/* BEFORE auth middleware.
 * Rate limited by IP address (stricter than authenticated limits).
 * CORS enabled for browser-based verifiers.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import type { AppEnv } from "../types/api-contract.js";
import { createErrorEnvelope } from "../types/error.js";
import { TokenBucketStore } from "../middleware/rate-limit.js";
import {
  publicRateLimitMiddleware,
  PUBLIC_RATE_LIMIT_DEFAULT,
} from "../middleware/public-rate-limit.js";
import { validateBody } from "../middleware/validate.js";
import { aggregateVerifierReports } from "@attestia/verify";
import type { VerifierReport } from "@attestia/verify";

// =============================================================================
// Validation Schemas
// =============================================================================

const SubmitReportSchema = z.object({
  reportId: z.string().min(1),
  verifierId: z.string().min(1),
  verdict: z.enum(["PASS", "FAIL"]),
  subsystemChecks: z.array(
    z.object({
      subsystem: z.string().max(256),
      expected: z.string().max(1024),
      actual: z.string().max(1024),
      matches: z.boolean(),
    }),
  ).max(1000),
  discrepancies: z.array(z.string().max(1024)).max(1000),
  bundleHash: z.string().min(1),
  verifiedAt: z.string().min(1),
});

// =============================================================================
// Types
// =============================================================================

export interface PublicVerifyDeps {
  /** Override public rate limit config */
  readonly rateLimitConfig?: { rpm: number; burst: number };

  /** Callback to generate a state bundle on demand */
  readonly getBundleFn?: () => unknown;

  /**
   * Minimum verifiers required for an authoritative public consensus.
   *
   * Default: 2 (fail-closed). This is the PUBLIC, trust-free endpoint, so a
   * lone — possibly operator-controlled — verifier must not be able to produce
   * an authoritative PASS (V1-003). Callers may pass a higher quorum, but not
   * lower the public floor below 1 verifier's worth of trust.
   */
  readonly minimumVerifiers?: number;

  /**
   * Allowed CORS origins. Default: [] (no cross-origin access).
   * Pass ["*"] to allow all origins (NOT recommended for production).
   */
  readonly corsOrigins?: readonly string[];
}

// =============================================================================
// Route Factory
// =============================================================================

export function createPublicVerifyRoutes(
  deps?: PublicVerifyDeps,
): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  // ─── CORS ──────────────────────────────────────────────────────
  const allowedOrigins = deps?.corsOrigins ?? [];
  routes.use(
    "*",
    cors({
      origin: allowedOrigins.length === 0
        ? () => ""  // Deny all cross-origin by default
        : allowedOrigins.includes("*")
          ? "*"
          : (origin) => allowedOrigins.includes(origin) ? origin : "",
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
      maxAge: 3600,
    }),
  );

  // ─── Public Rate Limit ────────────────────────────────────────
  const rateLimitStore = new TokenBucketStore(
    deps?.rateLimitConfig ?? PUBLIC_RATE_LIMIT_DEFAULT,
  );
  routes.use("*", publicRateLimitMiddleware(rateLimitStore));

  // ─── GET /health ──────────────────────────────────────────────
  routes.get("/health", (c) => {
    return c.json({
      data: {
        status: "ok",
        timestamp: new Date().toISOString(),
      },
    });
  });

  // ─── GET /state-bundle ────────────────────────────────────────
  routes.get("/state-bundle", (c) => {
    if (deps?.getBundleFn) {
      const bundle = deps.getBundleFn();
      return c.json({ data: bundle });
    }

    // When no bundle generator is configured, return a minimal placeholder.
    // In production, this would be wired to the actual subsystem snapshots.
    return c.json({
      data: {
        version: 1,
        message: "State bundle endpoint active. Configure getBundleFn for production data.",
        timestamp: new Date().toISOString(),
      },
    });
  });

  // ─── In-Memory Report Store ──────────────────────────────────
  const reports: VerifierReport[] = [];

  // ─── POST /submit-report ───────────────────────────────────────
  routes.post("/submit-report", validateBody(SubmitReportSchema), (c) => {
    const body = c.get("validatedBody") as VerifierReport;

    // Check for duplicate report ID
    if (reports.some((r) => r.reportId === body.reportId)) {
      return c.json(
        createErrorEnvelope(
          "CONFLICT",
          `Report ${body.reportId} already submitted`,
        ),
        409,
      );
    }

    reports.push(body);

    return c.json(
      {
        data: {
          reportId: body.reportId,
          accepted: true,
          totalReports: reports.length,
        },
      },
      201,
    );
  });

  // ─── GET /reports ─────────────────────────────────────────────
  routes.get("/reports", (c) => {
    const cursor = c.req.query("cursor");
    const limitStr = c.req.query("limit");
    const limit = limitStr ? Math.min(Number(limitStr), 100) : 20;

    let startIndex = 0;
    if (cursor) {
      const idx = reports.findIndex((r) => r.reportId === cursor);
      if (idx >= 0) startIndex = idx + 1;
    }

    const page = reports.slice(startIndex, startIndex + limit);
    const nextCursor =
      startIndex + limit < reports.length
        ? reports[startIndex + limit - 1]?.reportId
        : undefined;

    return c.json({
      data: page,
      pagination: {
        total: reports.length,
        limit,
        hasMore: startIndex + limit < reports.length,
        ...(nextCursor ? { nextCursor } : {}),
      },
    });
  });

  // ─── GET /consensus ───────────────────────────────────────────
  // Fail-closed on the public endpoint: a single (possibly operator-controlled)
  // verifier must NOT yield an authoritative PASS. Default the quorum to 2 so a
  // lone verifier reports quorumReached=false / verdict=FAIL (V1-003). Callers
  // may raise the threshold but the public floor stays at 2. The
  // `singleVerifierPass` weak-quorum flag is still surfaced in the response.
  const PUBLIC_MIN_VERIFIERS = 2;
  routes.get("/consensus", (c) => {
    const minVerifiers = Math.max(
      deps?.minimumVerifiers ?? PUBLIC_MIN_VERIFIERS,
      PUBLIC_MIN_VERIFIERS,
    );
    const result = aggregateVerifierReports(reports, minVerifiers);

    return c.json({ data: result });
  });

  return routes;
}
