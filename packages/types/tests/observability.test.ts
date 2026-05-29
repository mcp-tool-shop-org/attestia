/**
 * Tests for the observability contract (@attestia/types).
 *
 * The contract is mostly compile-time types; the only runtime surface is
 * NOOP_TELEMETRY, which backend packages default to. These tests exercise it
 * so the no-op record() path is covered and provably never throws.
 */
import { describe, it, expect } from "vitest";
import {
  NOOP_TELEMETRY,
  type ObservabilityEvent,
  type ObservabilityLevel,
  type ObservabilityOutcome,
} from "../src/observability.js";

describe("NOOP_TELEMETRY", () => {
  it("record() accepts a minimal event and returns undefined", () => {
    const ev: ObservabilityEvent = {
      package: "@attestia/types",
      op: "test.minimal",
      level: "info",
    };
    expect(NOOP_TELEMETRY.record(ev)).toBeUndefined();
  });

  it("record() accepts a fully-populated event and returns undefined", () => {
    const ev: ObservabilityEvent = {
      package: "@attestia/types",
      op: "test.full",
      level: "warn",
      outcome: "degraded",
      durationMs: 12,
      attributes: { count: 3, name: "x", flag: true },
      message: "human-readable detail",
    };
    expect(NOOP_TELEMETRY.record(ev)).toBeUndefined();
  });

  it("record() never throws across every level and outcome", () => {
    const levels: ObservabilityLevel[] = ["debug", "info", "warn", "error"];
    const outcomes: ObservabilityOutcome[] = ["ok", "degraded", "failed"];
    for (const level of levels) {
      expect(() =>
        NOOP_TELEMETRY.record({ package: "p", op: "o", level }),
      ).not.toThrow();
    }
    for (const outcome of outcomes) {
      expect(() =>
        NOOP_TELEMETRY.record({ package: "p", op: "o", level: "info", outcome }),
      ).not.toThrow();
    }
  });
});
