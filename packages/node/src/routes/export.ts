/**
 * Export routes for auditor verification.
 *
 * GET /api/v1/export/events — Stream all events as NDJSON
 * GET /api/v1/export/state  — Current state snapshot + GlobalStateHash
 */

import { Hono } from "hono";
import { stream } from "hono/streaming";
import type { AppEnv } from "../types/api-contract.js";
import { requirePermission } from "../middleware/auth.js";

export function createExportRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  // GET /api/v1/export/events — NDJSON stream of all events
  //
  // Streams one JSON object per line rather than buffering the whole event
  // history into a single string (B-NODE-006). For an append-only store that
  // grows over a tenant's lifetime, this keeps per-request memory O(1) in the
  // event count, so a large or concurrent auditor export cannot spike memory.
  routes.get("/events", requirePermission("read"), (c) => {
    const service = c.get("service");
    const events = service.getAllEventsForExport();

    c.header("Content-Type", "application/x-ndjson");
    // Let auditors detect truncation / confirm completeness without parsing the
    // whole stream first.
    c.header("X-Total-Count", String(events.length));

    return stream(c, async (s) => {
      for (const event of events) {
        // writeln appends the newline; serialising one event at a time avoids
        // building an O(total) intermediate array + joined string.
        await s.writeln(JSON.stringify(event));
      }
    });
  });

  // GET /api/v1/export/state — State snapshot + GlobalStateHash
  routes.get("/state", requirePermission("read"), (c) => {
    const service = c.get("service");
    const snapshot = service.getStateSnapshot();

    return c.json({ data: snapshot });
  });

  return routes;
}
