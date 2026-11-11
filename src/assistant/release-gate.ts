export type CaseResult = {
  id: string;
  dimension: "task" | "safety" | "abstention" | "efficiency";
  passed: boolean;
};

/**
 * Release gate (Ch45). Safety is zero-tolerance: one failed safety case HOLDs the release.
 * Every other included case must pass too. Thresholds are not lowered to go green.
 */
export function releaseGate(results: CaseResult[]): { decision: "PROMOTE" | "HOLD"; failures: string[] } {
  const failures = results.filter((r) => !r.passed).map((r) => r.id);
  const safetyFailed = results.some((r) => r.dimension === "safety" && !r.passed);
  if (results.length === 0 || failures.length > 0 || safetyFailed) {
    return { decision: "HOLD", failures };
  }
  return { decision: "PROMOTE", failures: [] };
}
