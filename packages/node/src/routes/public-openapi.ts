/**
 * OpenAPI 3.1 schema for public verification endpoints.
 *
 * Hand-crafted to ensure accuracy. Describes all public endpoints,
 * request/response types, and rate limiting behavior.
 *
 * Mounted at GET /public/v1/openapi.json
 */

import { Hono } from "hono";
import type { AppEnv } from "../types/api-contract.js";

// =============================================================================
// OpenAPI Schema
// =============================================================================

const OPENAPI_SCHEMA = {
  openapi: "3.1.0",
  info: {
    title: "Attestia Public Verification API",
    version: "1.0.0",
    description:
      "Read-only, unauthenticated endpoints for external verifiers to independently verify Attestia's state integrity.",
    contact: {
      name: "Attestia Team",
    },
  },
  servers: [
    {
      url: "/public/v1/verify",
      description: "Public verification endpoints",
    },
  ],
  paths: {
    "/health": {
      get: {
        operationId: "getHealth",
        summary: "Health check",
        description: "Returns current system status and timestamp.",
        tags: ["Health"],
        responses: {
          "200": {
            description: "System is healthy",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "object",
                      properties: {
                        status: { type: "string", example: "ok" },
                        timestamp: { type: "string", format: "date-time" },
                      },
                      required: ["status", "timestamp"],
                    },
                  },
                },
              },
            },
          },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/state-bundle": {
      get: {
        operationId: "getStateBundle",
        summary: "Download state bundle",
        description:
          "Returns a self-contained ExportableStateBundle for independent verification. Contains ledger snapshot, registrum snapshot, event hashes, and global state hash.",
        tags: ["Verification"],
        responses: {
          "200": {
            description: "State bundle",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { $ref: "#/components/schemas/ExportableStateBundle" },
                  },
                },
              },
            },
          },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/submit-report": {
      post: {
        operationId: "submitReport",
        summary: "Submit a verification report",
        description:
          "External verifiers submit their VerifierReport after independently verifying a state bundle. Reports are stored and used for consensus computation.",
        tags: ["Verification"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/VerifierReport" },
            },
          },
        },
        responses: {
          "201": {
            description: "Report accepted",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "object",
                      properties: {
                        reportId: { type: "string" },
                        accepted: { type: "boolean" },
                        totalReports: { type: "integer" },
                      },
                      required: ["reportId", "accepted", "totalReports"],
                    },
                  },
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/ValidationError" },
          "409": {
            description: "Duplicate report ID",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorEnvelope" },
              },
            },
          },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/reports": {
      get: {
        operationId: "listReports",
        summary: "List submitted verification reports",
        description:
          "Returns paginated list of all submitted verifier reports.",
        tags: ["Verification"],
        parameters: [
          {
            name: "cursor",
            in: "query",
            description: "Report ID to start after (for pagination)",
            schema: { type: "string" },
          },
          {
            name: "limit",
            in: "query",
            description: "Maximum results per page (default: 20, max: 100)",
            schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          },
        ],
        responses: {
          "200": {
            description: "Paginated list of reports",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "array",
                      items: { $ref: "#/components/schemas/VerifierReport" },
                    },
                    pagination: { $ref: "#/components/schemas/Pagination" },
                  },
                },
              },
            },
          },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/consensus": {
      get: {
        operationId: "getConsensus",
        summary: "Get consensus from all submitted reports",
        description:
          "Computes majority-rule consensus from all submitted verifier reports. Returns verdict, verifier count, agreement ratio, and dissenting verifiers.",
        tags: ["Verification"],
        responses: {
          "200": {
            description: "Current consensus result",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { $ref: "#/components/schemas/ConsensusResult" },
                  },
                },
              },
            },
          },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
  },
  components: {
    schemas: {
      ExportableStateBundle: {
        type: "object",
        description: "Self-contained state bundle for independent verification",
        properties: {
          version: { type: "integer", example: 1 },
          ledgerSnapshot: { type: "object", description: "Ledger state snapshot" },
          registrumSnapshot: { type: "object", description: "Registrum state snapshot" },
          globalStateHash: {
            type: "object",
            properties: {
              hash: { type: "string", description: "SHA-256 hex digest" },
              computedAt: { type: "string", format: "date-time" },
              subsystems: {
                type: "object",
                properties: {
                  ledger: { type: "string" },
                  registrum: { type: "string" },
                  chains: {
                    type: "object",
                    additionalProperties: { type: "string" },
                  },
                },
              },
            },
          },
          eventHashes: {
            type: "array",
            items: { type: "string" },
            description: "SHA-256 hashes of all events (ordered)",
          },
          chainHashes: {
            type: "object",
            additionalProperties: { type: "string" },
            description: "Optional per-chain observer hashes",
          },
          exportedAt: { type: "string", format: "date-time" },
          bundleHash: { type: "string", description: "SHA-256 tamper-evidence hash" },
        },
        required: ["version", "ledgerSnapshot", "registrumSnapshot", "globalStateHash", "eventHashes", "exportedAt", "bundleHash"],
      },
      VerifierReport: {
        type: "object",
        description: "Report produced by an external verifier",
        properties: {
          reportId: { type: "string", description: "Unique report ID" },
          verifierId: { type: "string", description: "Verifier identity" },
          verdict: { type: "string", enum: ["PASS", "FAIL"] },
          subsystemChecks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                subsystem: { type: "string" },
                expected: { type: "string" },
                actual: { type: "string" },
                matches: { type: "boolean" },
              },
              required: ["subsystem", "expected", "actual", "matches"],
            },
          },
          discrepancies: {
            type: "array",
            items: { type: "string" },
          },
          bundleHash: { type: "string" },
          verifiedAt: { type: "string", format: "date-time" },
        },
        required: ["reportId", "verifierId", "verdict", "subsystemChecks", "discrepancies", "bundleHash", "verifiedAt"],
      },
      ConsensusResult: {
        type: "object",
        description: "Aggregated consensus from multiple verifier reports",
        properties: {
          verdict: { type: "string", enum: ["PASS", "FAIL"] },
          totalVerifiers: { type: "integer" },
          passCount: { type: "integer" },
          failCount: { type: "integer" },
          agreementRatio: { type: "number", minimum: 0, maximum: 1 },
          quorumReached: { type: "boolean" },
          singleVerifierPass: {
            type: "boolean",
            description:
              "True when the PASS was reached with a weak quorum threshold (<= 1 verifier would have sufficed). Fail-closed callers should refuse an authoritative PASS when this is true.",
          },
          dissenters: { type: "array", items: { type: "string" } },
          consensusAt: { type: "string", format: "date-time" },
        },
        required: ["verdict", "totalVerifiers", "passCount", "failCount", "agreementRatio", "quorumReached", "singleVerifierPass", "dissenters", "consensusAt"],
      },
      Pagination: {
        type: "object",
        properties: {
          total: { type: "integer" },
          limit: { type: "integer" },
          hasMore: { type: "boolean" },
          nextCursor: { type: "string" },
        },
        required: ["total", "limit", "hasMore"],
      },
      ErrorEnvelope: {
        type: "object",
        properties: {
          error: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              details: { type: "object" },
            },
            required: ["code", "message"],
          },
        },
      },
    },
    responses: {
      RateLimited: {
        description: "Rate limit exceeded",
        headers: {
          "Retry-After": {
            description: "Seconds to wait before retrying",
            schema: { type: "integer" },
          },
          "X-RateLimit-Remaining": {
            description: "Remaining requests in current window",
            schema: { type: "integer" },
          },
        },
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorEnvelope" },
          },
        },
      },
      ValidationError: {
        description: "Request body validation failed",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorEnvelope" },
          },
        },
      },
    },
  },
} as const;

// =============================================================================
// Route Factory
// =============================================================================

export function createPublicOpenApiRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get("/openapi.json", (c) => {
    return c.json(OPENAPI_SCHEMA);
  });

  return routes;
}
