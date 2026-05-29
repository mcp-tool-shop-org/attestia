/**
 * SLA Evaluation Engine.
 *
 * Evaluates SLA policies against current metrics.
 *
 * Design:
 * - Pure functions, no I/O
 * - Advisory only — produces evaluation results, does not enforce
 * - Fail-closed: missing metrics are treated as failures
 * - Deterministic: same inputs always produce same output
 */

import type {
  SlaPolicy,
  SlaMetrics,
  SlaEvaluation,
  SlaTarget,
  SlaTargetResult,
  SlaVerdict,
  ThresholdOperator,
} from "./types.js";

// =============================================================================
// Threshold Comparison
// =============================================================================

/**
 * Compare a value against a threshold using the given operator.
 */
function compareThreshold(
  actual: number,
  operator: ThresholdOperator,
  threshold: number,
): boolean {
  // Fail-closed: a non-finite actual (NaN / ±Infinity) or threshold can never
  // satisfy a comparison. Guarding here closes the fail-OPEN path where
  // `Infinity >= threshold` / `Infinity > threshold` returned true.
  if (!Number.isFinite(actual) || !Number.isFinite(threshold)) {
    return false;
  }
  switch (operator) {
    case "lte":
      return actual <= threshold;
    case "gte":
      return actual >= threshold;
    case "lt":
      return actual < threshold;
    case "gt":
      return actual > threshold;
    case "eq":
      return actual === threshold;
    default:
      // Unknown operator → fail-closed
      return false;
  }
}

/**
 * Format a human-readable operator string.
 */
function operatorLabel(op: ThresholdOperator): string {
  switch (op) {
    case "lte":
      return "<=";
    case "gte":
      return ">=";
    case "lt":
      return "<";
    case "gt":
      return ">";
    case "eq":
      return "==";
    default:
      return op;
  }
}

// =============================================================================
// Target Evaluation
// =============================================================================

/**
 * Evaluate a single SLA target against the provided metrics.
 *
 * Fail-closed: if the metric is missing, the target fails.
 */
function evaluateTarget(target: SlaTarget, metrics: SlaMetrics): SlaTargetResult {
  const actualValue = metrics[target.metric];

  // Missing metric → fail-closed
  if (actualValue === undefined) {
    return {
      target,
      actualValue: undefined,
      passed: false,
      detail: `[FAIL] ${target.metric}: metric not available (fail-closed)`,
    };
  }

  // Non-finite metric (NaN / ±Infinity) → fail-closed. This catches values
  // that `=== undefined` does not, and prevents an Infinity from satisfying
  // a gte/gt threshold.
  if (!Number.isFinite(actualValue)) {
    return {
      target,
      actualValue,
      passed: false,
      detail: `[FAIL] ${target.metric}: non-finite value (fail-closed)`,
    };
  }

  // A non-finite threshold cannot be satisfied either → fail-closed.
  if (!Number.isFinite(target.threshold)) {
    return {
      target,
      actualValue,
      passed: false,
      detail: `[FAIL] ${target.metric}: non-finite threshold (fail-closed)`,
    };
  }

  const passed = compareThreshold(actualValue, target.operator, target.threshold);
  const opStr = operatorLabel(target.operator);

  if (passed) {
    return {
      target,
      actualValue,
      passed: true,
      detail: `[PASS] ${target.metric}: ${actualValue} ${opStr} ${target.threshold}`,
    };
  }

  return {
    target,
    actualValue,
    passed: false,
    detail: `[FAIL] ${target.metric}: ${actualValue} does not satisfy ${opStr} ${target.threshold}`,
  };
}

// =============================================================================
// Policy Evaluation
// =============================================================================

/**
 * Evaluate an SLA policy against the provided metrics.
 *
 * Returns a full evaluation with per-target results and an overall verdict.
 *
 * Verdict rules:
 * - PASS: all targets pass
 * - FAIL: any target fails
 * - DEGRADED: reserved for future use (partial compliance)
 *
 * @param policy - The SLA policy to evaluate
 * @param metrics - Current metric values
 * @returns Full evaluation result
 */
export function evaluateSla(policy: SlaPolicy, metrics: SlaMetrics): SlaEvaluation {
  const results = policy.targets.map((target) => evaluateTarget(target, metrics));

  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.length - passedCount;

  // Verdict: PASS only if all targets pass, FAIL otherwise
  let verdict: SlaVerdict;
  if (failedCount === 0) {
    verdict = "PASS";
  } else {
    verdict = "FAIL";
  }

  return {
    policy,
    results,
    verdict,
    passedCount,
    failedCount,
    evaluatedAt: new Date().toISOString(),
  };
}

/**
 * Evaluate multiple SLA policies against the provided metrics.
 *
 * @param policies - Array of SLA policies to evaluate
 * @param metrics - Current metric values
 * @returns Array of evaluation results (one per policy)
 */
export function evaluateMultipleSla(
  policies: readonly SlaPolicy[],
  metrics: SlaMetrics,
): readonly SlaEvaluation[] {
  return policies.map((policy) => evaluateSla(policy, metrics));
}
