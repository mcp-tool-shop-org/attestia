/**
 * Prometheus metrics middleware + collector.
 *
 * Hand-rolled Prometheus text format — no prom-client dependency.
 * Collects:
 * - http_requests_total (counter, by method + status + path)
 * - http_request_duration_seconds (histogram, by method + path)
 */

import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types/api-contract.js";

// =============================================================================
// Metrics Collector
// =============================================================================

interface CounterEntry {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  count: number;
}

interface HistogramEntry {
  readonly method: string;
  readonly path: string;
  sum: number;
  count: number;
  buckets: Map<number, number>; // le → count
}

const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export class MetricsCollector {
  private readonly _counters = new Map<string, CounterEntry>();
  private readonly _histograms = new Map<string, HistogramEntry>();
  private readonly _buckets: readonly number[];

  /** Generic named counters: name → labels-key → { labels, count } */
  private readonly _namedCounters = new Map<
    string,
    Map<string, { labels: Record<string, string>; count: number }>
  >();

  constructor(buckets: readonly number[] = DEFAULT_BUCKETS) {
    this._buckets = buckets;
  }

  /**
   * Record an HTTP request.
   */
  recordRequest(
    method: string,
    path: string,
    status: number,
    durationMs: number,
  ): void {
    // Counter
    const counterKey = `${method}:${path}:${status}`;
    const counter = this._counters.get(counterKey);
    if (counter !== undefined) {
      counter.count++;
    } else {
      this._counters.set(counterKey, { method, path, status, count: 1 });
    }

    // Histogram
    const histKey = `${method}:${path}`;
    const durationSec = durationMs / 1000;
    let hist = this._histograms.get(histKey);
    if (hist === undefined) {
      hist = {
        method,
        path,
        sum: 0,
        count: 0,
        buckets: new Map(this._buckets.map((b) => [b, 0])),
      };
      this._histograms.set(histKey, hist);
    }
    hist.sum += durationSec;
    hist.count++;
    for (const le of this._buckets) {
      if (durationSec <= le) {
        hist.buckets.set(le, (hist.buckets.get(le) ?? 0) + 1);
      }
    }
  }

  /**
   * Increment a named counter with arbitrary labels.
   *
   * Used for business metrics like attestia_intents_total{action="declare"}.
   */
  incrementCounter(name: string, labels: Record<string, string> = {}): void {
    let metric = this._namedCounters.get(name);
    if (metric === undefined) {
      metric = new Map();
      this._namedCounters.set(name, metric);
    }

    const labelsKey = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(",");

    const entry = metric.get(labelsKey);
    if (entry !== undefined) {
      entry.count++;
    } else {
      metric.set(labelsKey, { labels: { ...labels }, count: 1 });
    }
  }

  /**
   * Render metrics in Prometheus text exposition format.
   */
  render(): string {
    const lines: string[] = [];

    // http_requests_total
    lines.push("# HELP http_requests_total Total HTTP requests");
    lines.push("# TYPE http_requests_total counter");
    for (const entry of this._counters.values()) {
      lines.push(
        `http_requests_total{method="${entry.method}",path="${entry.path}",status="${entry.status}"} ${entry.count}`,
      );
    }

    // http_request_duration_seconds
    lines.push("# HELP http_request_duration_seconds HTTP request duration in seconds");
    lines.push("# TYPE http_request_duration_seconds histogram");
    for (const hist of this._histograms.values()) {
      for (const [le, count] of hist.buckets) {
        lines.push(
          `http_request_duration_seconds_bucket{method="${hist.method}",path="${hist.path}",le="${le}"} ${count}`,
        );
      }
      lines.push(
        `http_request_duration_seconds_bucket{method="${hist.method}",path="${hist.path}",le="+Inf"} ${hist.count}`,
      );
      lines.push(
        `http_request_duration_seconds_sum{method="${hist.method}",path="${hist.path}"} ${hist.sum}`,
      );
      lines.push(
        `http_request_duration_seconds_count{method="${hist.method}",path="${hist.path}"} ${hist.count}`,
      );
    }

    // Named counters (business metrics)
    for (const [name, entries] of this._namedCounters) {
      lines.push(`# HELP ${name} Business metric counter`);
      lines.push(`# TYPE ${name} counter`);
      for (const { labels, count } of entries.values()) {
        const labelStr = Object.entries(labels)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}="${v}"`)
          .join(",");
        if (labelStr.length > 0) {
          lines.push(`${name}{${labelStr}} ${count}`);
        } else {
          lines.push(`${name} ${count}`);
        }
      }
    }

    return lines.join("\n") + "\n";
  }

  clear(): void {
    this._counters.clear();
    this._histograms.clear();
    this._namedCounters.clear();
  }
}

// =============================================================================
// Middleware
// =============================================================================

/**
 * Create metrics collection middleware.
 *
 * Records method, route-template path, status, and duration for every request.
 *
 * Path labelling (security-critical): the `path` label is the matched ROUTE
 * TEMPLATE (`c.req.routePath`, e.g. `/api/v1/intents/:id`), NOT the concrete
 * request path. Labelling by the concrete path leaked arbitrary resource IDs
 * into the Prometheus `path` label whenever they were not UUID-shaped
 * (attestation / intent / framework IDs), exposing them when `/metrics` is
 * unauthenticated and unbounding label cardinality (V2-003). Using the template
 * keeps IDs out of the label regardless of their format. Unmatched requests
 * (no route) fall back to the concrete path so 404s are still observable.
 */
export function metricsMiddleware(
  collector: MetricsCollector,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const start = performance.now();
    await next();
    const durationMs = performance.now() - start;

    // Prefer the matched route template; it never contains concrete IDs.
    // routePath is "/*" (or empty) when nothing matched — fall back to the
    // concrete path so unmatched routes remain visible in metrics.
    const routePath = c.req.routePath;
    const path =
      routePath !== undefined && routePath !== "" && routePath !== "/*"
        ? routePath
        : c.req.path;

    collector.recordRequest(
      c.req.method,
      path,
      c.res.status,
      durationMs,
    );
  };
}
