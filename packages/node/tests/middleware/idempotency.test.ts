/**
 * Tests for idempotency middleware.
 *
 * Verifies:
 * - POST with Idempotency-Key caches the response
 * - Replayed response includes X-Idempotent-Replay header
 * - GET requests bypass idempotency
 * - POST without key bypasses idempotency
 * - TTL expiry evicts cached entries
 */

import { describe, it, expect } from "vitest";
import { createTestApp, jsonRequest } from "../setup.js";

describe("idempotency middleware", () => {
  it("returns cached response for duplicate POST with same key", async () => {
    const { app } = createTestApp();

    const body = {
      id: "idem-1",
      kind: "transfer",
      description: "Idempotency test",
      params: {},
    };

    // First request
    const res1 = await app.request(
      jsonRequest("/api/v1/intents", "POST", body, {
        "Idempotency-Key": "key-123",
      }),
    );
    expect(res1.status).toBe(201);
    expect(res1.headers.get("X-Idempotent-Replay")).toBeNull();

    // Second request with same key
    const res2 = await app.request(
      jsonRequest("/api/v1/intents", "POST", body, {
        "Idempotency-Key": "key-123",
      }),
    );
    expect(res2.status).toBe(201);
    expect(res2.headers.get("X-Idempotent-Replay")).toBe("true");

    const body1 = await res1.json();
    const body2 = await res2.json();
    expect(body2).toEqual(body1);
  });

  it("does not cache GET requests", async () => {
    const { app } = createTestApp();

    const res1 = await app.request(
      jsonRequest("/api/v1/intents", "GET", undefined, {
        "Idempotency-Key": "get-key",
      }),
    );
    const res2 = await app.request(
      jsonRequest("/api/v1/intents", "GET", undefined, {
        "Idempotency-Key": "get-key",
      }),
    );

    expect(res1.headers.get("X-Idempotent-Replay")).toBeNull();
    expect(res2.headers.get("X-Idempotent-Replay")).toBeNull();
  });

  it("does not cache POST without Idempotency-Key", async () => {
    const { app } = createTestApp();

    const body = {
      id: "no-key-1",
      kind: "transfer",
      description: "No key",
      params: {},
    };

    const res = await app.request(
      jsonRequest("/api/v1/intents", "POST", body),
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("X-Idempotent-Replay")).toBeNull();
  });

  it("different keys get different cached responses", async () => {
    const { app } = createTestApp();

    const res1 = await app.request(
      jsonRequest(
        "/api/v1/intents",
        "POST",
        {
          id: "diff-1",
          kind: "transfer",
          description: "Key A",
          params: {},
        },
        { "Idempotency-Key": "key-a" },
      ),
    );

    const res2 = await app.request(
      jsonRequest(
        "/api/v1/intents",
        "POST",
        {
          id: "diff-2",
          kind: "swap",
          description: "Key B",
          params: {},
        },
        { "Idempotency-Key": "key-b" },
      ),
    );

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);

    const body1 = (await res1.json()) as { data: { id: string } };
    const body2 = (await res2.json()) as { data: { id: string } };
    expect(body1.data.id).toBe("diff-1");
    expect(body2.data.id).toBe("diff-2");
  });
});

describe("InMemoryIdempotencyStore", () => {
  it("evicts expired entries on get()", async () => {
    const { idempotencyStore } = createTestApp();

    // Manually set an expired entry
    idempotencyStore.set("expired-key", {
      status: 200,
      body: "{}",
      headers: {},
      cachedAt: Date.now() - 100_000_000, // well past TTL
      bodyHash: "0".repeat(64),
    });

    expect(idempotencyStore.get("expired-key")).toBeUndefined();
  });

  it("returns entry within TTL", () => {
    const { idempotencyStore } = createTestApp();

    idempotencyStore.set("fresh-key", {
      status: 200,
      body: '{"ok":true}',
      headers: {},
      cachedAt: Date.now(),
      bodyHash: "0".repeat(64),
    });

    const entry = idempotencyStore.get("fresh-key");
    expect(entry).toBeDefined();
    expect(entry!.body).toBe('{"ok":true}');
  });
});

// =============================================================================
// M1: Body hash comparison
// =============================================================================

describe("idempotency body hash (M1)", () => {
  it("returns cached response when same key + same body", async () => {
    const { app } = createTestApp();

    const body = {
      id: "hash-same",
      kind: "transfer",
      description: "Body hash test",
      params: {},
    };

    const res1 = await app.request(
      jsonRequest("/api/v1/intents", "POST", body, {
        "Idempotency-Key": "hash-key-1",
      }),
    );
    expect(res1.status).toBe(201);

    const res2 = await app.request(
      jsonRequest("/api/v1/intents", "POST", body, {
        "Idempotency-Key": "hash-key-1",
      }),
    );
    expect(res2.status).toBe(201);
    expect(res2.headers.get("X-Idempotent-Replay")).toBe("true");
  });

  it("returns 422 when same key + different body", async () => {
    const { app } = createTestApp();

    const body1 = {
      id: "hash-diff-1",
      kind: "transfer",
      description: "First body",
      params: {},
    };
    const body2 = {
      id: "hash-diff-2",
      kind: "swap",
      description: "Different body",
      params: {},
    };

    const res1 = await app.request(
      jsonRequest("/api/v1/intents", "POST", body1, {
        "Idempotency-Key": "hash-key-2",
      }),
    );
    expect(res1.status).toBe(201);

    const res2 = await app.request(
      jsonRequest("/api/v1/intents", "POST", body2, {
        "Idempotency-Key": "hash-key-2",
      }),
    );
    expect(res2.status).toBe(422);
    const errBody = (await res2.json()) as { error: { code: string } };
    expect(errBody.error.code).toBe("IDEMPOTENCY_MISMATCH");
  });
});

// =============================================================================
// D6-A-001 [CRITICAL, authz]: Idempotency cache must be tenant-scoped
// =============================================================================

describe("idempotency tenant isolation (D6-A-001)", () => {
  it("tenant B cannot read tenant A's cached idempotent response", async () => {
    const { app } = createTestApp();

    // Same idempotency key AND same body bytes used by both tenants.
    const key = "shared-key-cross-tenant";
    const body = {
      id: "cross-tenant-intent",
      kind: "transfer",
      description: "Cross-tenant idempotency probe",
      params: {},
    };

    // Tenant A declares the intent (gets cached under A).
    const resA = await app.request(
      jsonRequest("/api/v1/intents", "POST", body, {
        "Idempotency-Key": key,
        "X-Tenant-Id": "tenant-a",
      }),
    );
    expect(resA.status).toBe(201);
    const bodyA = (await resA.json()) as { data: { id: string; declaredBy: string } };
    expect(bodyA.data.declaredBy).toBe("tenant-a");

    // Tenant B sends the SAME key + SAME body. It must NOT receive A's cached
    // response; B must get its own freshly created intent (declaredBy=tenant-b).
    const resB = await app.request(
      jsonRequest("/api/v1/intents", "POST", body, {
        "Idempotency-Key": key,
        "X-Tenant-Id": "tenant-b",
      }),
    );

    // Cross-tenant replay must not happen.
    expect(resB.headers.get("X-Idempotent-Replay")).toBeNull();
    expect(resB.status).toBe(201);
    const bodyB = (await resB.json()) as { data: { id: string; declaredBy: string } };
    expect(bodyB.data.declaredBy).toBe("tenant-b");
  });

  it("a tenant still gets its own cached response within its own scope", async () => {
    const { app } = createTestApp();

    const key = "scoped-key-same-tenant";
    const body = {
      id: "same-tenant-intent",
      kind: "transfer",
      description: "Same-tenant replay",
      params: {},
    };

    const res1 = await app.request(
      jsonRequest("/api/v1/intents", "POST", body, {
        "Idempotency-Key": key,
        "X-Tenant-Id": "tenant-x",
      }),
    );
    expect(res1.status).toBe(201);
    expect(res1.headers.get("X-Idempotent-Replay")).toBeNull();

    const res2 = await app.request(
      jsonRequest("/api/v1/intents", "POST", body, {
        "Idempotency-Key": key,
        "X-Tenant-Id": "tenant-x",
      }),
    );
    expect(res2.status).toBe(201);
    expect(res2.headers.get("X-Idempotent-Replay")).toBe("true");
  });
});

// =============================================================================
// D6-A-002 [HIGH, correctness]: Idempotency cache must be route-scoped
// =============================================================================

describe("idempotency route scoping (D6-A-002)", () => {
  it("same key on a different path/param does not replay the first response", async () => {
    const { app } = createTestApp();

    // Two distinct intents the same tenant can approve.
    for (const id of ["route-intent-a", "route-intent-b"]) {
      const decl = await app.request(
        jsonRequest("/api/v1/intents", "POST", {
          id,
          kind: "transfer",
          description: `Intent ${id}`,
          params: {},
        }),
      );
      expect(decl.status).toBe(201);
    }

    const key = "shared-key-cross-route";

    // Approve intent A with an empty body + the shared key.
    const approveA = await app.request(
      jsonRequest("/api/v1/intents/route-intent-a/approve", "POST", {}, {
        "Idempotency-Key": key,
      }),
    );
    expect(approveA.status).toBe(200);
    const bodyA = (await approveA.json()) as { data: { id: string } };
    expect(bodyA.data.id).toBe("route-intent-a");

    // Approve intent B with the SAME key + SAME (empty) body, but a DIFFERENT path.
    // Must NOT replay A's result — it must approve B and return B's id.
    const approveB = await app.request(
      jsonRequest("/api/v1/intents/route-intent-b/approve", "POST", {}, {
        "Idempotency-Key": key,
      }),
    );

    expect(approveB.headers.get("X-Idempotent-Replay")).toBeNull();
    expect(approveB.status).toBe(200);
    const bodyB = (await approveB.json()) as { data: { id: string } };
    expect(bodyB.data.id).toBe("route-intent-b");
  });

  it("same key + same path still replays (per-route idempotency preserved)", async () => {
    const { app } = createTestApp();

    const decl = await app.request(
      jsonRequest("/api/v1/intents", "POST", {
        id: "route-replay-intent",
        kind: "transfer",
        description: "Route replay",
        params: {},
      }),
    );
    expect(decl.status).toBe(201);

    const key = "same-route-key";
    const approve1 = await app.request(
      jsonRequest("/api/v1/intents/route-replay-intent/approve", "POST", {}, {
        "Idempotency-Key": key,
      }),
    );
    expect(approve1.status).toBe(200);

    const approve2 = await app.request(
      jsonRequest("/api/v1/intents/route-replay-intent/approve", "POST", {}, {
        "Idempotency-Key": key,
      }),
    );
    expect(approve2.status).toBe(200);
    expect(approve2.headers.get("X-Idempotent-Replay")).toBe("true");
  });
});
