export type Alert = { code: string; message: string; owner: string };

export function evaluateAlerts(input: {
  errorRate: number;
  budgetUsedUsd: number;
  budgetLimitUsd: number;
  failedTools: number;
}): Alert[] {
  const alerts: Alert[] = [];
  if (input.errorRate >= 0.5) {
    alerts.push({ code: "error_rate", message: "Half of recent tasks failed", owner: "platform" });
  }
  if (input.budgetLimitUsd > 0 && input.budgetUsedUsd >= input.budgetLimitUsd) {
    alerts.push({ code: "budget", message: "Daily model budget is exhausted", owner: "platform" });
  }
  if (input.failedTools >= 5) {
    alerts.push({ code: "tools", message: "Tool calls are failing repeatedly", owner: "platform" });
  }
  return alerts;
}
