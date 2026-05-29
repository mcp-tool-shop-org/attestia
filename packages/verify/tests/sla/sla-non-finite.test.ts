/**
 * SLA Engine Non-Finite Fail-Closed Tests (D5-A-003).
 *
 * Attestia is fail-closed: NaN / Infinity / -Infinity metric values must
 * FAIL, never PASS. The original engine was fail-OPEN:
 *
 *   - `Infinity >= threshold` and `Infinity > threshold` return true → PASS
 *   - the missing-metric guard only caught `=== undefined`, not NaN
 *
 * A metric pipeline that emits Infinity (e.g. divide-by-zero rate) or NaN
 * (parse failure) could thus silently satisfy an SLA. Fix: any non-finite
 * actual value FAILS, and a non-finite threshold makes the comparison FAIL.
 */

import { describe, it, expect } from "vitest";
import { evaluateSla } from "../../src/sla/sla-engine.js";
import type { SlaPolicy, SlaMetrics, ThresholdOperator } from "../../src/sla/types.js";

function policyWith(operator: ThresholdOperator, threshold = 100): SlaPolicy {
  return {
    id: "p",
    name: "p",
    version: 1,
    createdAt: "2025-01-01T00:00:00.000Z",
    targets: [{ metric: "m", operator, threshold, window: "24h" }],
  };
}

const OPERATORS: ThresholdOperator[] = ["lte", "gte", "lt", "gt", "eq"];
const NON_FINITE: Array<[string, number]> = [
  ["NaN", NaN],
  ["Infinity", Infinity],
  ["-Infinity", -Infinity],
];

describe("SLA fail-closed on non-finite actual values (D5-A-003)", () => {
  for (const op of OPERATORS) {
    for (const [label, value] of NON_FINITE) {
      it(`operator '${op}' with actual ${label} → FAIL`, () => {
        const metrics: SlaMetrics = { m: value };
        const result = evaluateSla(policyWith(op), metrics);

        expect(result.verdict).toBe("FAIL");
        expect(result.results[0]!.passed).toBe(false);
        expect(result.results[0]!.detail.toLowerCase()).toContain("non-finite");
      });
    }
  }

  it("a finite value still PASSes (no regression)", () => {
    // gte 100 with actual 150 must remain a PASS — the guard only rejects
    // non-finite values, not legitimate ones.
    const result = evaluateSla(policyWith("gte", 100), { m: 150 });
    expect(result.verdict).toBe("PASS");
  });

  it("non-finite threshold makes the target FAIL even for a finite actual", () => {
    const result = evaluateSla(policyWith("gte", Infinity), { m: 1e9 });
    expect(result.verdict).toBe("FAIL");
    expect(result.results[0]!.passed).toBe(false);
  });

  it("Infinity does not satisfy gte/gt (the original fail-open path)", () => {
    expect(evaluateSla(policyWith("gte"), { m: Infinity }).verdict).toBe("FAIL");
    expect(evaluateSla(policyWith("gt"), { m: Infinity }).verdict).toBe("FAIL");
  });
});
