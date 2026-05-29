/**
 * Tests for metrics middleware path labelling.
 *
 * V2-003 [LOW, enumeration]: the Prometheus `path` label must be the matched
 * ROUTE TEMPLATE (e.g. /api/v1/intents/:id), never the concrete request path.
 * Otherwise arbitrary, non-UUID resource IDs (attestation/intent/framework IDs)
 * end up verbatim in the label and are exposed when /metrics is unauthenticated.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../../src/types/api-contract.js";
import { MetricsCollector, metricsMiddleware } from "../../src/middleware/metrics.js";

function makeApp(collector: MetricsCollector): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", metricsMiddleware(collector));

  // Sub-app mounted under a prefix, mirroring the real app's structure so the
  // recorded template is the full, flattened path.
  const sub = new Hono<AppEnv>();
  sub.get("/:id", (c) => c.text("intent"));
  sub.post("/:id/approve", (c) => c.text("approved"));
  app.route("/api/v1/intents", sub);

  return app;
}

describe("metricsMiddleware path labelling (V2-003)", () => {
  it("labels by route template, not the concrete non-UUID id", async () => {
    const collector = new MetricsCollector();
    const app = makeApp(collector);

    // A human-readable, NON-UUID id — the exact case the old UUID-only
    // normalizer leaked verbatim.
    await app.request("/api/v1/intents/payroll-2025-06");

    const rendered = collector.render();
    expect(rendered).toContain('path="/api/v1/intents/:id"');
    // The concrete id must NEVER appear in the metrics output.
    expect(rendered).not.toContain("payroll-2025-06");
  });

  it("collapses many distinct ids onto a single template label (bounded cardinality)", async () => {
    const collector = new MetricsCollector();
    const app = makeApp(collector);

    await app.request("/api/v1/intents/alpha");
    await app.request("/api/v1/intents/bravo");
    await app.request("/api/v1/intents/charlie");

    const rendered = collector.render();
    // One counter line for the GET template, count 3 — not three separate lines.
    const counterLines = rendered
      .split("\n")
      .filter((l) => l.startsWith('http_requests_total{') && l.includes('method="GET"'));
    expect(counterLines.length).toBe(1);
    expect(counterLines[0]).toContain('path="/api/v1/intents/:id"');
    expect(counterLines[0]?.trim().endsWith(" 3")).toBe(true);

    expect(rendered).not.toContain("alpha");
    expect(rendered).not.toContain("bravo");
    expect(rendered).not.toContain("charlie");
  });

  it("labels nested templated routes by their full template", async () => {
    const collector = new MetricsCollector();
    const app = makeApp(collector);

    await app.request("/api/v1/intents/secret-intent-id/approve", { method: "POST" });

    const rendered = collector.render();
    expect(rendered).toContain('path="/api/v1/intents/:id/approve"');
    expect(rendered).not.toContain("secret-intent-id");
  });

  it("falls back to the concrete path for unmatched (404) requests", async () => {
    const collector = new MetricsCollector();
    const app = makeApp(collector);

    const res = await app.request("/no/such/route");
    expect(res.status).toBe(404);

    const rendered = collector.render();
    // 404s remain observable — there is no template to use here.
    expect(rendered).toContain("/no/such/route");
  });
});
