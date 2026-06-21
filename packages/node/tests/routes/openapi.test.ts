/**
 * Authenticated OpenAPI Document Tests
 *
 * Verifies:
 * - GET /api/v1/openapi.json returns a valid OpenAPI 3.1 document
 * - The security scheme (X-Api-Key + Bearer JWT) is present and applied
 * - DRIFT GUARD: every authenticated /api/v1 route mounted on the app is
 *   documented in the spec, and every documented path corresponds to a real
 *   mounted route. A new endpoint added without a spec entry (or a spec entry
 *   with no route) fails this test.
 */

import { describe, it, expect } from "vitest";
import { createApp } from "../../src/app.js";
import type { AppInstance } from "../../src/app.js";
import { OPENAPI_SCHEMA } from "../../src/routes/openapi.js";

function createTestApp(): AppInstance {
  return createApp({
    serviceConfig: {
      ownerId: "test-tenant",
      defaultCurrency: "USDC",
      defaultDecimals: 6,
    },
  });
}

/**
 * Enumerate the app's real authenticated routes as a set of "METHOD path"
 * strings, where path is the OpenAPI-style path under /api/v1 (leading segment
 * stripped, :param → {param}). Middleware (method "ALL") and non-/api/v1 routes
 * (health, metrics, public/*) are excluded.
 */
function mountedApiOperations(instance: AppInstance): Set<string> {
  const ops = new Set<string>();
  // Hono exposes registered routes (including composed mounts) on app.routes.
  const routes = (instance.app as unknown as {
    routes: ReadonlyArray<{ method: string; path: string }>;
  }).routes;

  for (const r of routes) {
    if (r.method === "ALL") continue; // middleware, not an operation
    if (!r.path.startsWith("/api/v1/") && r.path !== "/api/v1") continue;

    // Strip the /api/v1 server prefix to match OpenAPI `paths` keys.
    let sub = r.path.slice("/api/v1".length);
    if (sub === "") sub = "/";
    // :param → {param}
    sub = sub.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
    ops.add(`${r.method} ${sub}`);
  }
  return ops;
}

/** Enumerate the documented operations the same way (METHOD path). */
function documentedOperations(): Set<string> {
  const ops = new Set<string>();
  const paths = OPENAPI_SCHEMA.paths as Record<string, Record<string, unknown>>;
  for (const [path, item] of Object.entries(paths)) {
    for (const method of Object.keys(item)) {
      ops.add(`${method.toUpperCase()} ${path}`);
    }
  }
  return ops;
}

// =============================================================================
// Served document
// =============================================================================

describe("GET /api/v1/openapi.json", () => {
  it("serves a valid OpenAPI 3.1 document", async () => {
    const instance = createTestApp();
    const res = await instance.app.request("/api/v1/openapi.json");

    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      openapi: string;
      info: { title: string; version: string };
      paths: Record<string, unknown>;
      components: Record<string, unknown>;
    };

    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toBeTruthy();
    expect(doc.info.version).toBeTruthy();
    expect(Object.keys(doc.paths).length).toBeGreaterThan(0);
    expect(doc.components).toBeDefined();
  });

  it("declares the X-Api-Key + Bearer JWT security schemes and applies them", async () => {
    const instance = createTestApp();
    const res = await instance.app.request("/api/v1/openapi.json");
    const doc = (await res.json()) as {
      security: Array<Record<string, unknown>>;
      components: {
        securitySchemes: Record<
          string,
          { type: string; in?: string; name?: string; scheme?: string }
        >;
      };
    };

    const schemes = doc.components.securitySchemes;
    expect(schemes.ApiKeyAuth).toEqual(
      expect.objectContaining({ type: "apiKey", in: "header", name: "X-Api-Key" }),
    );
    expect(schemes.BearerAuth).toEqual(
      expect.objectContaining({ type: "http", scheme: "bearer" }),
    );

    // Applied globally so every operation requires auth.
    expect(doc.security).toEqual(
      expect.arrayContaining([{ ApiKeyAuth: [] }, { BearerAuth: [] }]),
    );
  });

  it("every path item references only resolvable component $refs", async () => {
    const instance = createTestApp();
    const res = await instance.app.request("/api/v1/openapi.json");
    const doc = (await res.json()) as Record<string, unknown>;

    const refs: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk);
      } else if (node !== null && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) {
          if (k === "$ref" && typeof v === "string") refs.push(v);
          else walk(v);
        }
      }
    };
    walk(doc.paths);
    walk(doc.components);

    for (const ref of refs) {
      expect(ref.startsWith("#/components/")).toBe(true);
      const segments = ref.replace("#/", "").split("/");
      let cursor: unknown = doc;
      for (const seg of segments) {
        expect(cursor).toBeTypeOf("object");
        cursor = (cursor as Record<string, unknown>)[seg];
      }
      expect(cursor, `unresolved $ref: ${ref}`).toBeDefined();
    }
  });
});

// =============================================================================
// Drift guard
// =============================================================================

describe("OpenAPI drift guard", () => {
  it("documents every mounted authenticated /api/v1 operation", () => {
    const instance = createTestApp();
    const mounted = mountedApiOperations(instance);
    const documented = documentedOperations();

    const undocumented = [...mounted].filter((op) => !documented.has(op));
    expect(
      undocumented,
      `These mounted /api/v1 operations are NOT in openapi.json:\n${undocumented.join("\n")}`,
    ).toEqual([]);
  });

  it("does not document operations that are not mounted", () => {
    const instance = createTestApp();
    const mounted = mountedApiOperations(instance);
    const documented = documentedOperations();

    const orphaned = [...documented].filter((op) => !mounted.has(op));
    expect(
      orphaned,
      `These documented operations have NO mounted route:\n${orphaned.join("\n")}`,
    ).toEqual([]);
  });
});
