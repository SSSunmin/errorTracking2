import type { AlertCondition } from "@prisma/client";

export interface AlertEvaluationRule {
  id: string;
  condition: AlertCondition;
  threshold: number | null;
  windowMinutes: number | null;
  baselineMinutes: number | null;
  spikeMultiplier: number | null;
  minEvents: number | null;
}

export interface AlertIssueState {
  isNew: boolean;
  regressed: boolean;
  eventCountsByWindowMinutes: ReadonlyMap<number, number>;
  spikeCountsByRuleId: ReadonlyMap<string, { recent: number; baseline: number }>;
}

export interface AlertEvaluation {
  ruleId: string;
  condition: AlertCondition;
}

export const evaluateAlerts = (
  rules: readonly AlertEvaluationRule[],
  issueState: AlertIssueState
): AlertEvaluation[] =>
  rules
    .filter((rule) => {
      switch (rule.condition) {
        case "new_issue":
          return issueState.isNew;

        case "regression":
          return issueState.regressed;

        case "event_threshold": {
          if (rule.threshold === null || rule.windowMinutes === null) {
            return false;
          }

          return (
            (issueState.eventCountsByWindowMinutes.get(rule.windowMinutes) ??
              0) >= rule.threshold
          );
        }

        case "event_spike": {
          if (
            rule.windowMinutes === null ||
            rule.baselineMinutes === null ||
            rule.spikeMultiplier === null ||
            rule.minEvents === null ||
            rule.baselineMinutes <= rule.windowMinutes
          ) {
            return false;
          }

          const counts = issueState.spikeCountsByRuleId.get(rule.id);
          const recent = counts?.recent ?? 0;
          const baseline = counts?.baseline ?? 0;
          if (recent < rule.minEvents) {
            return false;
          }

          const recentRate = recent / rule.windowMinutes;
          const baselineRate =
            baseline / (rule.baselineMinutes - rule.windowMinutes);

          return baselineRate > 0
            ? recentRate >= baselineRate * rule.spikeMultiplier
            : recent >= rule.minEvents;
        }

        default: {
          // Exhaustiveness guard: adding a new AlertCondition without a case
          // above fails to compile here instead of silently misclassifying it.
          const unhandled: never = rule.condition;
          return unhandled;
        }
      }
    })
    .map((rule) => ({
      ruleId: rule.id,
      condition: rule.condition
    }));
