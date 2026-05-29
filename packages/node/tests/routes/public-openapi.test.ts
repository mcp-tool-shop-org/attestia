/**
 * Public OpenAPI Schema Tests
 *
 * Verifies:
 * - Schema is returned as valid JSON
 * - Contains OpenAPI 3.1 version
 * - Describes all public endpoints
 * - Response types are defined
 * - No auth required
 */

import { describe, it, expect } from "vitest";
import { createApp } from "../../src/app.js";
import type { AppInstance } from "../../src/app.js";

// =============================================================================
// Helpers
// =============================================================================

function createTestApp(): AppInstance {
  return createApp({
    serviceConfig: {
      ownerId: "test-tenant",
      defaultCurrency: "USDC",
      defaultDecimals: 6,
    },
  });
}

function makeRequest(path: string): Request {
  return new Request(`http://localhost${path}`, { method: "GET" });
}

// =============================================================================
// Tests
// =============================================================================

describe("GET /public/v1/openapi.json", () => {
  it("returns 200 with valid JSON", async () => {
    const { app } = createTestApp();
    const res = await app.request(makeRequest("/public/v1/openapi.json"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  });

  it("contains OpenAPI 3.1 version", async () => {
    const { app } = createTestApp();
    const res = await app.request(makeRequest("/public/v1/openapi.json"));

    const body = (await res.json()) as { openapi: string };
    expect(body.openapi).toBe("3.1.0");
  });

  it("describes all public verification endpoints", async () => {
    const { app } = createTestApp();
    const res = await app.request(makeRequest("/public/v1/openapi.json"));

    const body = (await res.json()) as { paths: Record<string, unknown> };
    const paths = Object.keys(body.paths);

    expect(paths).toContain("/health");
    expect(paths).toContain("/state-bundle");
    expect(paths).toContain("/submit-report");
    expect(paths).toContain("/reports");
    expect(paths).toContain("/consensus");
  });

  it("defines component schemas for key types", async () => {
    const { app } = createTestApp();
    const res = await app.request(makeRequest("/public/v1/openapi.json"));

    const body = (await res.json()) as {
      components: { schemas: Record<string, unknown> };
    };

    expect(body.components.schemas.ExportableStateBundle).toBeDefined();
    expect(body.components.schemas.VerifierReport).toBeDefined();
    expect(body.components.schemas.ConsensusResult).toBeDefined();
    expect(body.components.schemas.Pagination).toBeDefined();
    expect(body.components.schemas.ErrorEnvelope).toBeDefined();
  });

  // V1-002 [MEDIUM, contract-drift]: the published ConsensusResult schema must
  // match the served shape — including the singleVerifierPass weak-quorum flag.
  it("documents singleVerifierPass on ConsensusResult (matches served shape)", async () => {
    const { app } = createTestApp();
    const res = await app.request(makeRequest("/public/v1/openapi.json"));

    const body = (await res.json()) as {
      components: {
        schemas: {
          ConsensusResult: {
            properties: Record<string, { type?: string }>;
            required: string[];
          };
        };
      };
    };

    const consensus = body.components.schemas.ConsensusResult;
    expect(consensus.properties.singleVerifierPass).toBeDefined();
    expect(consensus.properties.singleVerifierPass.type).toBe("boolean");
    expect(consensus.required).toContain("singleVerifierPass");
  });

  it("includes rate limiting response definition", async () => {
    const { app } = createTestApp();
    const res = await app.request(makeRequest("/public/v1/openapi.json"));

    const body = (await res.json()) as {
      components: { responses: Record<string, unknown> };
    };

    expect(body.components.responses.RateLimited).toBeDefined();
    expect(body.components.responses.ValidationError).toBeDefined();
  });

  it("has title and description in info", async () => {
    const { app } = createTestApp();
    const res = await app.request(makeRequest("/public/v1/openapi.json"));

    const body = (await res.json()) as { info: { title: string; description: string; version: string } };
    expect(body.info.title).toBeTruthy();
    expect(body.info.description).toBeTruthy();
    expect(body.info.version).toBeTruthy();
  });

  it("does not require authentication", async () => {
    const { app } = createTestApp();
    // No auth headers
    const res = await app.request(makeRequest("/public/v1/openapi.json"));
    expect(res.status).toBe(200);
  });
});
