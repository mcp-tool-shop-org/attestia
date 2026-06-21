/**
 * Tests for event query routes.
 *
 * The InMemoryEventStore starts empty. Events are appended via
 * the service's event store directly for testing.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestApp, jsonRequest } from "./setup.js";
import type { AppInstance } from "../src/app.js";

let instance: AppInstance;

beforeEach(() => {
  instance = createTestApp();
});

describe("GET /api/v1/events", () => {
  it("returns empty list when no events exist", async () => {
    const { app } = instance;
    const res = await app.request("/api/v1/events");

    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      data: unknown[];
      pagination: { hasMore: boolean };
    };
    expect(body.data).toEqual([]);
    expect(body.pagination.hasMore).toBe(false);
  });

  it("returns events after they are appended", async () => {
    const { app, tenantRegistry } = instance;

    // Get the default tenant's service
    const service = await tenantRegistry.getOrCreate("test-tenant");
    service.eventStore.append("stream-1", [
      { type: "IntentDeclared", payload: { id: "i1" }, metadata: {} },
    ]);

    const res = await app.request("/api/v1/events");
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      data: { event: { type: string } }[];
    };
    expect(body.data.length).toBe(1);
    expect(body.data[0]!.event.type).toBe("IntentDeclared");
  });

  it("supports pagination with limit", async () => {
    const { app, tenantRegistry } = instance;

    const service = await tenantRegistry.getOrCreate("test-tenant");
    service.eventStore.append("stream-1", [
      { type: "Event1", payload: {}, metadata: {} },
      { type: "Event2", payload: {}, metadata: {} },
      { type: "Event3", payload: {}, metadata: {} },
    ]);

    const res = await app.request("/api/v1/events?limit=2");
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      data: unknown[];
      pagination: { cursor: string | null; hasMore: boolean };
    };
    expect(body.data.length).toBe(2);
    expect(body.pagination.hasMore).toBe(true);
    expect(body.pagination.cursor).not.toBeNull();
  });
});

describe("GET /api/v1/events/:streamId", () => {
  it("returns events for a specific stream", async () => {
    const { app, tenantRegistry } = instance;

    const service = await tenantRegistry.getOrCreate("test-tenant");
    service.eventStore.append("orders", [
      { type: "OrderCreated", payload: { orderId: "o1" }, metadata: {} },
    ]);
    service.eventStore.append("payments", [
      { type: "PaymentReceived", payload: { paymentId: "p1" }, metadata: {} },
    ]);

    const res = await app.request("/api/v1/events/orders");
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      data: { event: { type: string } }[];
    };
    expect(body.data.length).toBe(1);
    expect(body.data[0]!.event.type).toBe("OrderCreated");
  });

  it("returns empty list for non-existent stream", async () => {
    const { app } = instance;
    const res = await app.request("/api/v1/events/nonexistent");

    expect(res.status).toBe(200);

    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });
});
