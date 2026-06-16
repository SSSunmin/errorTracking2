import type { AlertCondition } from "@prisma/client";

export interface AlertEvaluationRule {
  id: string;
  condition: AlertCondition;
  threshold: number | null;
  windowMinutes: number | null;
}

export interface AlertIssueState {
  isNew: boolean;
  regressed: boolean;
  eventCountsByWindowMinutes: ReadonlyMap<number, number>;
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
      if (rule.condition === "new_issue") {
        return issueState.isNew;
      }

      if (rule.condition === "regression") {
        return issueState.regressed;
      }

      if (rule.threshold === null || rule.windowMinutes === null) {
        return false;
      }

      return (
        (issueState.eventCountsByWindowMinutes.get(rule.windowMinutes) ?? 0) >=
        rule.threshold
      );
    })
    .map((rule) => ({
      ruleId: rule.id,
      condition: rule.condition
    }));
