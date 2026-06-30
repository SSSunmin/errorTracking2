import { describe, expect, test } from "vitest";

import {
  evaluateAlerts,
  type AlertEvaluationRule,
  type AlertIssueState
} from "./evaluator.js";

const spikeRule = (
  overrides: Partial<AlertEvaluationRule> = {}
): AlertEvaluationRule => ({
  id: "rule-spike",
  condition: "event_spike",
  threshold: null,
  windowMinutes: 10,
  baselineMinutes: 70,
  spikeMultiplier: 3,
  minEvents: 5,
  ...overrides
});

const issueState = (
  recent: number,
  baseline: number
): AlertIssueState => ({
  isNew: false,
  regressed: false,
  eventCountsByWindowMinutes: new Map(),
  spikeCountsByRuleId: new Map([
    ["rule-spike", { recent, baseline }]
  ])
});

describe("evaluateAlerts event_spike", () => {
  test("fires when recent rate is above the baseline multiplier", () => {
    const evaluations = evaluateAlerts([spikeRule()], issueState(30, 30));

    expect(evaluations).toEqual([
      { ruleId: "rule-spike", condition: "event_spike" }
    ]);
  });

  test("does not fire when the multiplier threshold is not met", () => {
    const evaluations = evaluateAlerts([spikeRule()], issueState(14, 30));

    expect(evaluations).toEqual([]);
  });

  test("does not fire below the minimum event floor", () => {
    const evaluations = evaluateAlerts(
      [spikeRule({ minEvents: 5 })],
      issueState(4, 0)
    );

    expect(evaluations).toEqual([]);
  });

  test("fires with a zero baseline once the minimum event floor is met", () => {
    const evaluations = evaluateAlerts(
      [spikeRule({ minEvents: 5 })],
      issueState(5, 0)
    );

    expect(evaluations).toEqual([
      { ruleId: "rule-spike", condition: "event_spike" }
    ]);
  });

  test("does not fire with a zero baseline below the minimum event floor", () => {
    const evaluations = evaluateAlerts(
      [spikeRule({ minEvents: 5 })],
      issueState(4, 0)
    );

    expect(evaluations).toEqual([]);
  });

  test("normalizes by per-minute rate at the boundary", () => {
    const evaluations = evaluateAlerts(
      [
        spikeRule({
          windowMinutes: 5,
          baselineMinutes: 65,
          spikeMultiplier: 2,
          minEvents: 10
        })
      ],
      issueState(10, 60)
    );

    expect(evaluations).toEqual([
      { ruleId: "rule-spike", condition: "event_spike" }
    ]);
  });

  test("defensively returns false when required parameters are null", () => {
    const requiredFields = [
      "windowMinutes",
      "baselineMinutes",
      "spikeMultiplier",
      "minEvents"
    ] as const;

    for (const field of requiredFields) {
      const evaluations = evaluateAlerts(
        [spikeRule({ [field]: null })],
        issueState(30, 30)
      );

      expect(evaluations, field).toEqual([]);
    }
  });
});
