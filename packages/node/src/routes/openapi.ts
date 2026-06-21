/**
 * OpenAPI 3.1 schema for the AUTHENTICATED API surface (/api/v1/*).
 *
 * Hand-authored (mirroring public-openapi.ts) as a single frozen object so the
 * spec is reviewable and a drift-guard test can assert it stays complete. It
 * documents every authenticated path: intents, events, verify, reconcile/attest,
 * export, proofs, compliance, audit-logs, AND the treasury/vault/governance
 * surfaces added in the feature pass — plus this very endpoint.
 *
 * Mounted at GET /api/v1/openapi.json (so it inherits auth + tenant from app.ts,
 * unlike the unauthenticated /public/v1/openapi.json).
 *
 * Security: every operation is guarded by the global /api/* auth middleware,
 * which accepts an X-Api-Key header OR an Authorization: Bearer JWT (see
 * middleware/auth.ts). Both are declared as security schemes and applied
 * globally; an empty `security: []` is set on this discovery endpoint only is
 * NOT done — discovery still requires auth, matching the mount point.
 */

import { Hono } from "hono";
import type { AppEnv } from "../types/api-contract.js";

// =============================================================================
// Reusable response refs
// =============================================================================

const ERR = (description: string, ref: string) => ({
  description,
  content: { "application/json": { schema: { $ref: ref } } },
});

const VALIDATION_400 = { $ref: "#/components/responses/ValidationError" };
const NOT_FOUND_404 = { $ref: "#/components/responses/NotFound" };
const UNAUTHORIZED_401 = { $ref: "#/components/responses/Unauthorized" };
const FORBIDDEN_403 = { $ref: "#/components/responses/Forbidden" };

/** A standard data-wrapped JSON response: { data: <schema> }. */
const dataResponse = (description: string, dataSchema: object) => ({
  description,
  content: {
    "application/json": {
      schema: { type: "object", properties: { data: dataSchema } },
    },
  },
});

/** A paginated list response: { data: [items], pagination }. */
const listResponse = (description: string, itemSchema: object) => ({
  description,
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: {
          data: { type: "array", items: itemSchema },
          pagination: { $ref: "#/components/schemas/Pagination" },
        },
        required: ["data", "pagination"],
      },
    },
  },
});

const PAGINATION_PARAMS = [
  {
    name: "cursor",
    in: "query",
    description: "Opaque cursor to start after (from a previous page).",
    schema: { type: "string" },
  },
  {
    name: "limit",
    in: "query",
    description: "Maximum results per page (default 20, max 100).",
    schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
  },
];

const ID_PARAM = (name: string, description: string) => ({
  name,
  in: "path",
  required: true,
  description,
  schema: { type: "string" },
});

const jsonBody = (ref: string) => ({
  required: true,
  content: { "application/json": { schema: { $ref: ref } } },
});

// =============================================================================
// OpenAPI Schema
// =============================================================================

const OPENAPI_SCHEMA = {
  openapi: "3.1.0",
  info: {
    title: "Attestia API",
    version: "1.0.0",
    description:
      "Authenticated, tenant-scoped API for the Attestia financial-attestation service. " +
      "Covers intent lifecycle, event queries, verification, reconciliation + attestation, " +
      "exports, proofs, compliance, audit logs, treasury (payroll / distributions / funding), " +
      "vault budgets + portfolio, and governance.",
    contact: { name: "Attestia Team" },
  },
  servers: [{ url: "/api/v1", description: "Authenticated API v1" }],
  // Applied globally — every path requires API key OR bearer JWT.
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  tags: [
    { name: "Intents", description: "Intent lifecycle" },
    { name: "Events", description: "Event-store queries" },
    { name: "Verification", description: "Replay + hash verification" },
    { name: "Attestation", description: "Reconciliation + attestation" },
    { name: "Export", description: "Auditor exports" },
    { name: "Proofs", description: "Merkle proof generation + verification" },
    { name: "Compliance", description: "Compliance frameworks + reports" },
    { name: "Audit", description: "Audit-log queries" },
    { name: "Treasury", description: "Payroll, distributions, funding gates" },
    { name: "Vault", description: "Budget envelopes + portfolio" },
    { name: "Governance", description: "Multi-sig policy administration" },
    { name: "Discovery", description: "API discovery" },
  ],
  paths: {
    // ─── Intents ──────────────────────────────────────────────────────────
    "/intents": {
      post: {
        operationId: "declareIntent",
        summary: "Declare a new intent",
        tags: ["Intents"],
        requestBody: jsonBody("#/components/schemas/DeclareIntent"),
        responses: {
          "201": dataResponse("Intent declared", { type: "object" }),
          "400": VALIDATION_400,
          "401": UNAUTHORIZED_401,
          "403": FORBIDDEN_403,
        },
      },
      get: {
        operationId: "listIntents",
        summary: "List intents",
        tags: ["Intents"],
        parameters: [
          ...PAGINATION_PARAMS,
          {
            name: "status",
            in: "query",
            description: "Filter by intent status.",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": listResponse("Paginated intents", { type: "object" }),
          "401": UNAUTHORIZED_401,
        },
      },
    },
    "/intents/{id}": {
      get: {
        operationId: "getIntent",
        summary: "Get a single intent",
        tags: ["Intents"],
        parameters: [ID_PARAM("id", "Intent id")],
        responses: {
          "200": dataResponse("Intent", { type: "object" }),
          "401": UNAUTHORIZED_401,
          "404": NOT_FOUND_404,
        },
      },
    },
    "/intents/{id}/approve": {
      post: {
        operationId: "approveIntent",
        summary: "Approve an intent",
        tags: ["Intents"],
        parameters: [ID_PARAM("id", "Intent id")],
        requestBody: jsonBody("#/components/schemas/ApproveIntent"),
        responses: {
          "200": dataResponse("Intent approved", { type: "object" }),
          "400": VALIDATION_400,
          "403": FORBIDDEN_403,
          "404": NOT_FOUND_404,
        },
      },
    },
    "/intents/{id}/reject": {
      post: {
        operationId: "rejectIntent",
        summary: "Reject an intent",
        tags: ["Intents"],
        parameters: [ID_PARAM("id", "Intent id")],
        requestBody: jsonBody("#/components/schemas/RejectIntent"),
        responses: {
          "200": dataResponse("Intent rejected", { type: "object" }),
          "400": VALIDATION_400,
          "403": FORBIDDEN_403,
          "404": NOT_FOUND_404,
        },
      },
    },
    "/intents/{id}/execute": {
      post: {
        operationId: "executeIntent",
        summary: "Execute an intent",
        tags: ["Intents"],
        parameters: [ID_PARAM("id", "Intent id")],
        requestBody: jsonBody("#/components/schemas/ExecuteIntent"),
        responses: {
          "200": dataResponse("Intent executed", { type: "object" }),
          "400": VALIDATION_400,
          "403": FORBIDDEN_403,
          "404": NOT_FOUND_404,
        },
      },
    },
    "/intents/{id}/verify": {
      post: {
        operationId: "verifyIntent",
        summary: "Verify an intent",
        tags: ["Intents"],
        parameters: [ID_PARAM("id", "Intent id")],
        requestBody: jsonBody("#/components/schemas/VerifyIntent"),
        responses: {
          "200": dataResponse("Intent verified", { type: "object" }),
          "400": VALIDATION_400,
          "403": FORBIDDEN_403,
          "404": NOT_FOUND_404,
        },
      },
    },

    // ─── Events ───────────────────────────────────────────────────────────
    "/events": {
      get: {
        operationId: "listEvents",
        summary: "List all events",
        tags: ["Events"],
        parameters: [
          ...PAGINATION_PARAMS,
          {
            name: "afterPosition",
            in: "query",
            description: "Return events after this global position.",
            schema: { type: "integer", minimum: 0 },
          },
        ],
        responses: {
          "200": listResponse("Paginated events", { type: "object" }),
          "401": UNAUTHORIZED_401,
        },
      },
    },
    "/events/{streamId}": {
      get: {
        operationId: "listStreamEvents",
        summary: "List events for a stream",
        tags: ["Events"],
        parameters: [
          ID_PARAM("streamId", "Event stream id"),
          ...PAGINATION_PARAMS,
          {
            name: "afterVersion",
            in: "query",
            description: "Return events after this stream version.",
            schema: { type: "integer", minimum: 0 },
          },
        ],
        responses: {
          "200": listResponse("Paginated stream events", { type: "object" }),
          "401": UNAUTHORIZED_401,
        },
      },
    },

    // ─── Verification ─────────────────────────────────────────────────────
    "/verify/replay": {
      post: {
        operationId: "verifyReplay",
        summary: "Full replay-based verification",
        tags: ["Verification"],
        requestBody: jsonBody("#/components/schemas/ReplayVerify"),
        responses: {
          "200": dataResponse("Replay verification result", { type: "object" }),
          "400": VALIDATION_400,
          "403": FORBIDDEN_403,
        },
      },
    },
    "/verify/hash": {
      post: {
        operationId: "verifyHash",
        summary: "Quick hash comparison",
        tags: ["Verification"],
        requestBody: jsonBody("#/components/schemas/HashVerify"),
        responses: {
          "200": dataResponse("Hash verification result", { type: "object" }),
          "400": VALIDATION_400,
          "403": FORBIDDEN_403,
        },
      },
    },

    // ─── Reconciliation + Attestation ─────────────────────────────────────
    "/reconcile": {
      post: {
        operationId: "reconcile",
        summary: "Run a reconciliation",
        tags: ["Attestation"],
        requestBody: jsonBody("#/components/schemas/Reconcile"),
        responses: {
          "200": dataResponse("Reconciliation report", { type: "object" }),
          "400": VALIDATION_400,
          "403": FORBIDDEN_403,
        },
      },
    },
    "/attest": {
      post: {
        operationId: "attest",
        summary: "Attest a reconciliation report",
        tags: ["Attestation"],
        requestBody: jsonBody("#/components/schemas/Reconcile"),
        responses: {
          "201": dataResponse("Attestation record", { type: "object" }),
          "400": VALIDATION_400,
          "403": FORBIDDEN_403,
        },
      },
    },
    "/attestations": {
      get: {
        operationId: "listAttestations",
        summary: "List attestation records",
        tags: ["Attestation"],
        parameters: PAGINATION_PARAMS,
        responses: {
          "200": listResponse("Paginated attestations", { type: "object" }),
          "401": UNAUTHORIZED_401,
        },
      },
    },

    // ─── Export ───────────────────────────────────────────────────────────
    "/export/events": {
      get: {
        operationId: "exportEvents",
        summary: "Stream all events as NDJSON",
        tags: ["Export"],
        responses: {
          "200": {
            description: "NDJSON stream of events (one JSON object per line).",
            content: { "application/x-ndjson": { schema: { type: "string" } } },
          },
          "403": FORBIDDEN_403,
        },
      },
    },
    "/export/state": {
      get: {
        operationId: "exportState",
        summary: "State snapshot + GlobalStateHash",
        tags: ["Export"],
        responses: {
          "200": dataResponse("State snapshot", { type: "object" }),
          "403": FORBIDDEN_403,
        },
      },
    },

    // ─── Proofs ───────────────────────────────────────────────────────────
    "/proofs/merkle-root": {
      get: {
        operationId: "getMerkleRoot",
        summary: "Current Merkle root of attestation hashes",
        tags: ["Proofs"],
        responses: {
          "200": dataResponse("Merkle root", { type: "object" }),
          "401": UNAUTHORIZED_401,
        },
      },
    },
    "/proofs/attestation/{id}": {
      get: {
        operationId: "getAttestationProof",
        summary: "Generate a proof package for an attestation",
        tags: ["Proofs"],
        parameters: [ID_PARAM("id", "Attestation id")],
        responses: {
          "200": dataResponse("Proof package", { type: "object" }),
          "401": UNAUTHORIZED_401,
          "404": NOT_FOUND_404,
        },
      },
    },
    "/proofs/verify": {
      post: {
        operationId: "verifyProof",
        summary: "Verify a submitted proof package",
        tags: ["Proofs"],
        requestBody: jsonBody("#/components/schemas/ProofPackage"),
        responses: {
          "200": dataResponse("Verification result", { type: "object" }),
          "400": VALIDATION_400,
          "403": FORBIDDEN_403,
        },
      },
    },

    // ─── Compliance ───────────────────────────────────────────────────────
    "/compliance/frameworks": {
      get: {
        operationId: "listFrameworks",
        summary: "List available compliance frameworks",
        tags: ["Compliance"],
        responses: {
          "200": dataResponse("Frameworks", { type: "array", items: { type: "object" } }),
          "401": UNAUTHORIZED_401,
        },
      },
    },
    "/compliance/report/{frameworkId}": {
      get: {
        operationId: "getComplianceReport",
        summary: "Generate a compliance report",
        tags: ["Compliance"],
        parameters: [ID_PARAM("frameworkId", "Framework id, e.g. soc2-type2")],
        responses: {
          "200": dataResponse("Compliance report", { type: "object" }),
          "401": UNAUTHORIZED_401,
          "404": NOT_FOUND_404,
        },
      },
    },

    // ─── Audit logs ───────────────────────────────────────────────────────
    "/audit-logs": {
      get: {
        operationId: "listAuditLogs",
        summary: "List audit-log entries (tenant-scoped)",
        tags: ["Audit"],
        parameters: [
          {
            name: "limit",
            in: "query",
            description: "Maximum entries (1–1000, default 100).",
            schema: { type: "integer", minimum: 1, maximum: 1000, default: 100 },
          },
        ],
        responses: {
          "200": dataResponse("Audit entries", { type: "array", items: { type: "object" } }),
          "403": FORBIDDEN_403,
        },
      },
    },

    // ─── Treasury: payroll runs ───────────────────────────────────────────
    "/treasury/payroll-runs": {
      post: {
        operationId: "createPayrollRun",
        summary: "Create a payroll run",
        tags: ["Treasury"],
        requestBody: jsonBody("#/components/schemas/CreatePayrollRun"),
        responses: {
          "201": dataResponse("Payroll run", { type: "object" }),
          "400": VALIDATION_400,
          "403": FORBIDDEN_403,
        },
      },
      get: {
        operationId: "listPayrollRuns",
        summary: "List payroll runs",
        tags: ["Treasury"],
        parameters: PAGINATION_PARAMS,
        responses: {
          "200": listResponse("Paginated payroll runs", { type: "object" }),
          "401": UNAUTHORIZED_401,
        },
      },
    },
    "/treasury/payroll-runs/{id}": {
      get: {
        operationId: "getPayrollRun",
        summary: "Get a payroll run",
        tags: ["Treasury"],
        parameters: [ID_PARAM("id", "Payroll run id")],
        responses: {
          "200": dataResponse("Payroll run", { type: "object" }),
          "401": UNAUTHORIZED_401,
          "404": NOT_FOUND_404,
        },
      },
    },
    "/treasury/payroll-runs/{id}/approve": {
      post: {
        operationId: "approvePayrollRun",
        summary: "Approve a payroll run",
        tags: ["Treasury"],
        parameters: [ID_PARAM("id", "Payroll run id")],
        responses: {
          "200": dataResponse("Payroll run approved", { type: "object" }),
          "403": FORBIDDEN_403,
          "404": NOT_FOUND_404,
        },
      },
    },
    "/treasury/payroll-runs/{id}/execute": {
      post: {
        operationId: "executePayrollRun",
        summary: "Execute a payroll run",
        tags: ["Treasury"],
        parameters: [ID_PARAM("id", "Payroll run id")],
        responses: {
          "200": dataResponse("Payroll run executed", { type: "object" }),
          "403": FORBIDDEN_403,
          "404": NOT_FOUND_404,
        },
      },
    },

    // ─── Treasury: distributions ──────────────────────────────────────────
    "/treasury/distributions": {
      post: {
        operationId: "createDistribution",
        summary: "Create a distribution plan",
        tags: ["Treasury"],
        requestBody: jsonBody("#/components/schemas/CreateDistribution"),
        responses: {
          "201": dataResponse("Distribution plan", { type: "object" }),
          "400": VALIDATION_400,
          "403": FORBIDDEN_403,
        },
      },
      get: {
        operationId: "listDistributions",
        summary: "List distribution plans",
        tags: ["Treasury"],
        parameters: PAGINATION_PARAMS,
        responses: {
          "200": listResponse("Paginated distribution plans", { type: "object" }),
          "401": UNAUTHORIZED_401,
        },
      },
    },
    "/treasury/distributions/{id}": {
      get: {
        operationId: "getDistribution",
        summary: "Get a distribution plan",
        tags: ["Treasury"],
        parameters: [ID_PARAM("id", "Distribution plan id")],
        responses: {
          "200": dataResponse("Distribution plan", { type: "object" }),
          "401": UNAUTHORIZED_401,
          "404": NOT_FOUND_404,
        },
      },
    },
    "/treasury/distributions/{id}/approve": {
      post: {
        operationId: "approveDistribution",
        summary: "Approve a distribution plan",
        tags: ["Treasury"],
        parameters: [ID_PARAM("id", "Distribution plan id")],
        responses: {
          "200": dataResponse("Distribution plan approved", { type: "object" }),
          "403": FORBIDDEN_403,
          "404": NOT_FOUND_404,
        },
      },
    },
    "/treasury/distributions/{id}/compute": {
      post: {
        operationId: "computeDistribution",
        summary: "Compute (dry-run) a distribution plan",
        tags: ["Treasury"],
        parameters: [ID_PARAM("id", "Distribution plan id")],
        responses: {
          "200": dataResponse("Distribution result", { type: "object" }),
          "403": FORBIDDEN_403,
          "404": NOT_FOUND_404,
        },
      },
    },
    "/treasury/distributions/{id}/execute": {
      post: {
        operationId: "executeDistribution",
        summary: "Execute a distribution plan",
        tags: ["Treasury"],
        parameters: [ID_PARAM("id", "Distribution plan id")],
        responses: {
          "200": dataResponse("Distribution result", { type: "object" }),
          "403": FORBIDDEN_403,
          "404": NOT_FOUND_404,
        },
      },
    },

    // ─── Treasury: funding gates ──────────────────────────────────────────
    "/treasury/funding-gates": {
      post: {
        operationId: "submitFunding",
        summary: "Submit a funding request",
        tags: ["Treasury"],
        requestBody: jsonBody("#/components/schemas/SubmitFunding"),
        responses: {
          "201": dataResponse("Funding request", { type: "object" }),
          "400": VALIDATION_400,
          "403": FORBIDDEN_403,
        },
      },
      get: {
        operationId: "listFundingRequests",
        summary: "List funding requests",
        tags: ["Treasury"],
        parameters: PAGINATION_PARAMS,
        responses: {
          "200": listResponse("Paginated funding requests", { type: "object" }),
          "401": UNAUTHORIZED_401,
        },
      },
    },
    "/treasury/funding-gates/{id}": {
      get: {
        operationId: "getFundingRequest",
        summary: "Get a funding request",
        tags: ["Treasury"],
        parameters: [ID_PARAM("id", "Funding request id")],
        responses: {
          "200": dataResponse("Funding request", { type: "object" }),
          "401": UNAUTHORIZED_401,
          "404": NOT_FOUND_404,
        },
      },
    },
    "/treasury/funding-gates/{id}/approve": {
      post: {
        operationId: "approveFundingGate",
        summary: "Approve a funding gate",
        tags: ["Treasury"],
        parameters: [ID_PARAM("id", "Funding request id")],
        requestBody: jsonBody("#/components/schemas/ApproveFundingGate"),
        responses: {
          "200": dataResponse("Funding request", { type: "object" }),
          "400": VALIDATION_400,
          "403": FORBIDDEN_403,
          "404": NOT_FOUND_404,
        },
      },
    },
    "/treasury/funding-gates/{id}/reject": {
      post: {
        operationId: "rejectFunding",
        summary: "Reject a funding request",
        tags: ["Treasury"],
        parameters: [ID_PARAM("id", "Funding request id")],
        requestBody: jsonBody("#/components/schemas/RejectFunding"),
        responses: {
          "200": dataResponse("Funding request", { type: "object" }),
          "400": VALIDATION_400,
          "403": FORBIDDEN_403,
          "404": NOT_FOUND_404,
        },
      },
    },
    "/treasury/funding-gates/{id}/execute": {
      post: {
        operationId: "executeFunding",
        summary: "Execute a funding request",
        tags: ["Treasury"],
        parameters: [ID_PARAM("id", "Funding request id")],
        responses: {
          "200": dataResponse("Funding request", { type: "object" }),
          "403": FORBIDDEN_403,
          "404": NOT_FOUND_404,
        },
      },
    },

    // ─── Vault: budgets / portfolio ───────────────────────────────────────
    "/vault/envelopes": {
      post: {
        operationId: "createEnvelope",
        summary: "Create a budget envelope",
        tags: ["Vault"],
        requestBody: jsonBody("#/components/schemas/CreateEnvelope"),
        responses: {
          "201": dataResponse("Envelope", { type: "object" }),
          "400": VALIDATION_400,
          "403": FORBIDDEN_403,
        },
      },
      get: {
        operationId: "listEnvelopes",
        summary: "List budget envelopes",
        tags: ["Vault"],
        parameters: PAGINATION_PARAMS,
        responses: {
          "200": listResponse("Paginated envelopes", { type: "object" }),
          "401": UNAUTHORIZED_401,
        },
      },
    },
    "/vault/envelopes/{id}/allocate": {
      post: {
        operationId: "allocateToEnvelope",
        summary: "Allocate funds into an envelope",
        tags: ["Vault"],
        parameters: [ID_PARAM("id", "Envelope id")],
        requestBody: jsonBody("#/components/schemas/AllocateEnvelope"),
        responses: {
          "200": dataResponse("Envelope", { type: "object" }),
          "400": VALIDATION_400,
          "403": FORBIDDEN_403,
          "404": NOT_FOUND_404,
        },
      },
    },
    "/vault/budget": {
      get: {
        operationId: "getBudget",
        summary: "Get the budget snapshot",
        tags: ["Vault"],
        responses: {
          "200": dataResponse("Budget snapshot", { type: "object" }),
          "401": UNAUTHORIZED_401,
        },
      },
    },
    "/vault/portfolio": {
      get: {
        operationId: "observePortfolio",
        summary: "Observe the multi-chain portfolio",
        tags: ["Vault"],
        responses: {
          "200": dataResponse("Portfolio", { type: "object" }),
          "401": UNAUTHORIZED_401,
        },
      },
    },

    // ─── Governance ───────────────────────────────────────────────────────
    "/governance/signers": {
      post: {
        operationId: "addSigner",
        summary: "Add a governance signer (admin only)",
        tags: ["Governance"],
        requestBody: jsonBody("#/components/schemas/AddSigner"),
        responses: {
          "201": dataResponse("Governance policy", { type: "object" }),
          "400": VALIDATION_400,
          "403": FORBIDDEN_403,
        },
      },
    },
    "/governance/signers/remove": {
      post: {
        operationId: "removeSigner",
        summary: "Remove a governance signer (admin only)",
        tags: ["Governance"],
        requestBody: jsonBody("#/components/schemas/RemoveSigner"),
        responses: {
          "200": dataResponse("Governance policy", { type: "object" }),
          "400": VALIDATION_400,
          "403": FORBIDDEN_403,
        },
      },
    },
    "/governance/quorum": {
      post: {
        operationId: "changeQuorum",
        summary: "Change the quorum threshold (admin only)",
        tags: ["Governance"],
        requestBody: jsonBody("#/components/schemas/ChangeQuorum"),
        responses: {
          "200": dataResponse("Governance policy", { type: "object" }),
          "400": VALIDATION_400,
          "403": FORBIDDEN_403,
        },
      },
    },
    "/governance/policy": {
      get: {
        operationId: "getGovernancePolicy",
        summary: "Get the current governance policy",
        tags: ["Governance"],
        responses: {
          "200": dataResponse("Governance policy", { type: "object" }),
          "401": UNAUTHORIZED_401,
        },
      },
    },

    // ─── Discovery ────────────────────────────────────────────────────────
    "/openapi.json": {
      get: {
        operationId: "getOpenApi",
        summary: "This OpenAPI document",
        tags: ["Discovery"],
        responses: {
          "200": {
            description: "OpenAPI 3.1 document for the authenticated API.",
            content: { "application/json": { schema: { type: "object" } } },
          },
          "401": UNAUTHORIZED_401,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "X-Api-Key",
        description: "Tenant-scoped API key (see middleware/auth.ts).",
      },
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description:
          "HMAC-SHA256 (HS256) JWT with sub/role/tenantId claims (see middleware/auth.ts).",
      },
    },
    schemas: {
      // ── Shared ──────────────────────────────────────────────────────────
      Money: {
        type: "object",
        properties: {
          amount: { type: "string", description: "Decimal string amount." },
          currency: { type: "string" },
          decimals: { type: "integer", minimum: 0, maximum: 18 },
        },
        required: ["amount", "currency", "decimals"],
      },
      Pagination: {
        type: "object",
        properties: {
          cursor: { type: ["string", "null"] },
          hasMore: { type: "boolean" },
        },
        required: ["cursor", "hasMore"],
      },
      ErrorEnvelope: {
        type: "object",
        properties: {
          error: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              hint: { type: "string" },
              details: { type: "object" },
            },
            required: ["code", "message"],
          },
        },
        required: ["error"],
      },

      // ── Intent bodies ───────────────────────────────────────────────────
      DeclareIntent: {
        type: "object",
        properties: {
          id: { type: "string" },
          kind: {
            type: "string",
            enum: [
              "transfer",
              "swap",
              "allocate",
              "deallocate",
              "bridge",
              "stake",
              "unstake",
            ],
          },
          description: { type: "string" },
          params: { type: "object" },
          envelopeId: { type: "string" },
        },
        required: ["id", "kind", "description", "params"],
      },
      ApproveIntent: {
        type: "object",
        properties: { reason: { type: "string" } },
      },
      RejectIntent: {
        type: "object",
        properties: { reason: { type: "string" } },
        required: ["reason"],
      },
      ExecuteIntent: {
        type: "object",
        properties: {
          chainId: { type: "string" },
          txHash: { type: "string" },
        },
        required: ["chainId", "txHash"],
      },
      VerifyIntent: {
        type: "object",
        properties: {
          matched: { type: "boolean" },
          discrepancies: { type: "array", items: { type: "string" } },
        },
        required: ["matched"],
      },

      // ── Verification + reconcile bodies ─────────────────────────────────
      ReplayVerify: {
        type: "object",
        properties: {
          ledgerSnapshot: { type: "object" },
          registrumSnapshot: { type: "object" },
          expectedHash: { type: "string" },
        },
        required: ["ledgerSnapshot", "registrumSnapshot"],
      },
      HashVerify: {
        type: "object",
        properties: {
          ledgerSnapshot: { type: "object" },
          registrumSnapshot: { type: "object" },
          expectedHash: { type: "string" },
        },
        required: ["ledgerSnapshot", "registrumSnapshot", "expectedHash"],
      },
      Reconcile: {
        type: "object",
        description:
          "Reconciliation input: intents, ledger entries, and chain events (each array capped at 10000).",
        properties: {
          intents: { type: "array", items: { type: "object" } },
          ledgerEntries: { type: "array", items: { type: "object" } },
          chainEvents: { type: "array", items: { type: "object" } },
          scope: { type: "object" },
        },
        required: ["intents", "ledgerEntries", "chainEvents"],
      },
      ProofPackage: {
        type: "object",
        description: "Attestation proof package (Merkle inclusion proof).",
        properties: {
          version: { type: "integer", enum: [1] },
          attestation: {},
          attestationHash: { type: "string" },
          merkleRoot: { type: "string" },
          inclusionProof: { type: "object" },
          packagedAt: { type: "string" },
          packageHash: { type: "string" },
        },
        required: [
          "version",
          "attestationHash",
          "merkleRoot",
          "inclusionProof",
          "packagedAt",
          "packageHash",
        ],
      },

      // ── Treasury bodies ─────────────────────────────────────────────────
      PayPeriod: {
        type: "object",
        properties: {
          start: { type: "string" },
          end: { type: "string" },
          label: { type: "string" },
        },
        required: ["start", "end", "label"],
      },
      CreatePayrollRun: {
        type: "object",
        properties: {
          id: { type: "string" },
          period: { $ref: "#/components/schemas/PayPeriod" },
        },
        required: ["id", "period"],
      },
      DistributionRecipient: {
        type: "object",
        properties: {
          payeeId: { type: "string" },
          share: { type: "number" },
          amount: { $ref: "#/components/schemas/Money" },
          milestoneMet: { type: "boolean" },
        },
        required: ["payeeId"],
      },
      CreateDistribution: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          strategy: {
            type: "string",
            enum: ["proportional", "fixed", "milestone"],
          },
          pool: { $ref: "#/components/schemas/Money" },
          recipients: {
            type: "array",
            items: { $ref: "#/components/schemas/DistributionRecipient" },
          },
        },
        required: ["id", "name", "strategy", "pool", "recipients"],
      },
      SubmitFunding: {
        type: "object",
        properties: {
          id: { type: "string" },
          description: { type: "string" },
          amount: { $ref: "#/components/schemas/Money" },
          requestedBy: { type: "string" },
        },
        required: ["id", "description", "amount", "requestedBy"],
      },
      ApproveFundingGate: {
        type: "object",
        properties: {
          approvedBy: { type: "string" },
          reason: { type: "string" },
        },
        required: ["approvedBy"],
      },
      RejectFunding: {
        type: "object",
        properties: {
          rejectedBy: { type: "string" },
          reason: { type: "string" },
        },
        required: ["rejectedBy"],
      },

      // ── Vault bodies ────────────────────────────────────────────────────
      CreateEnvelope: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          category: { type: "string" },
        },
        required: ["id", "name"],
      },
      AllocateEnvelope: {
        type: "object",
        properties: { amount: { $ref: "#/components/schemas/Money" } },
        required: ["amount"],
      },

      // ── Governance bodies ───────────────────────────────────────────────
      AddSigner: {
        type: "object",
        properties: {
          address: { type: "string" },
          label: { type: "string" },
          weight: { type: "integer", minimum: 1 },
          publicKey: { type: "string" },
        },
        required: ["address", "label"],
      },
      RemoveSigner: {
        type: "object",
        properties: { address: { type: "string" } },
        required: ["address"],
      },
      ChangeQuorum: {
        type: "object",
        properties: { quorum: { type: "integer", minimum: 1 } },
        required: ["quorum"],
      },
    },
    responses: {
      ValidationError: ERR(
        "Request validation failed",
        "#/components/schemas/ErrorEnvelope",
      ),
      NotFound: ERR("Resource not found", "#/components/schemas/ErrorEnvelope"),
      Unauthorized: ERR(
        "Authentication required or invalid",
        "#/components/schemas/ErrorEnvelope",
      ),
      Forbidden: ERR(
        "Caller lacks the required permission",
        "#/components/schemas/ErrorEnvelope",
      ),
    },
  },
} as const;

// =============================================================================
// Route Factory
// =============================================================================

export function createOpenApiRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get("/openapi.json", (c) => {
    return c.json(OPENAPI_SCHEMA);
  });

  return routes;
}

/**
 * The frozen OpenAPI document. Exported so the drift-guard test can compare its
 * documented paths against the app's actual mounted routes without an HTTP round
 * trip.
 */
export { OPENAPI_SCHEMA };
