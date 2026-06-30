import { AlertCondition, NotificationStatus, type AlertRule } from "@prisma/client";

import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import {
  evaluateAlerts,
  type AlertEvaluationRule,
  type AlertIssueState
} from "./evaluator.js";
import { defaultNotifier, type NotificationMessage, type Notifier } from "./notifier.js";

export interface AlertProcessEventResult {
  issueId: string;
  eventId: string;
  isNew: boolean;
  regressed: boolean;
}

export interface AlertDispatchOptions {
  notifier?: Notifier;
}

const DEFAULT_REGRESSION_COOLDOWN_MINUTES = 60;

const toEvaluationRule = (rule: AlertRule): AlertEvaluationRule => ({
  id: rule.id,
  condition: rule.condition,
  threshold: rule.threshold,
  windowMinutes: rule.windowMinutes,
  baselineMinutes: rule.baselineMinutes,
  spikeMultiplier:
    rule.spikeMultiplier === null ? null : Number(rule.spikeMultiplier),
  minEvents: rule.minEvents
});

const getEventCountsByWindowMinutes = async (
  projectId: string,
  issueId: string,
  windows: readonly number[],
  now: number
): Promise<Map<number, number>> => {
  const counts = new Map<number, number>();

  await Promise.all(
    windows.map(async (windowMinutes) => {
      const count = await prisma.event.count({
        where: {
          projectId,
          issueId,
          receivedAt: {
            gte: new Date(now - windowMinutes * 60 * 1_000)
          }
        }
      });

      counts.set(windowMinutes, count);
    })
  );

  return counts;
};

const getSpikeBaselineCountsByWindow = async (
  projectId: string,
  issueId: string,
  windows: readonly { windowMinutes: number; baselineMinutes: number }[],
  now: number
): Promise<Map<string, number>> => {
  const counts = new Map<string, number>();
  const uniqueWindows = [
    ...new Map(
      windows.map((window) => [
        `${String(window.windowMinutes)}:${String(window.baselineMinutes)}`,
        window
      ])
    ).values()
  ];

  await Promise.all(
    uniqueWindows.map(async ({ windowMinutes, baselineMinutes }) => {
      const count = await prisma.event.count({
        where: {
          projectId,
          issueId,
          receivedAt: {
            gte: new Date(now - baselineMinutes * 60 * 1_000),
            lt: new Date(now - windowMinutes * 60 * 1_000)
          }
        }
      });

      counts.set(`${String(windowMinutes)}:${String(baselineMinutes)}`, count);
    })
  );

  return counts;
};

const getDedupeSince = (
  condition: AlertCondition,
  windowMinutes: number | null,
  cooldownMinutes: number | null
): Date | null => {
  if (condition === "new_issue") {
    return null;
  }

  // Spike/threshold conditions honor an explicit cooldown when set, otherwise
  // fall back to the measurement window. Regression has no measurement window,
  // so it uses a fixed default.
  const dedupeMinutes =
    condition === "regression"
      ? cooldownMinutes ?? DEFAULT_REGRESSION_COOLDOWN_MINUTES
      : cooldownMinutes ?? windowMinutes;

  if (dedupeMinutes === null) {
    return null;
  }

  return new Date(Date.now() - dedupeMinutes * 60 * 1_000);
};

// Atomically decide whether to notify AND reserve the slot, so two concurrent
// worker jobs for the same issue cannot both send. A transaction-scoped Postgres
// advisory lock keyed on (rule, issue) serializes the check-and-claim; the
// `pending` row inserted here is what a concurrent job sees so it backs off.
// Returns the claimed notification id, or null if a recent notification already
// covers this (rule, issue) within the dedup window.
const claimNotification = async (
  rule: AlertRule,
  issueId: string
): Promise<string | null> => {
  const since = getDedupeSince(
    rule.condition,
    rule.windowMinutes,
    rule.cooldownMinutes
  );
  const lockKey = `${rule.id}:${issueId}`;

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

    const existing = await tx.notification.findFirst({
      where: {
        alertRuleId: rule.id,
        issueId,
        ...(since ? { sentAt: { gte: since } } : {})
      },
      select: { id: true }
    });

    if (existing) {
      return null;
    }

    const claimed = await tx.notification.create({
      data: {
        alertRuleId: rule.id,
        issueId,
        channel: rule.channel,
        status: NotificationStatus.pending
      },
      select: { id: true }
    });

    return claimed.id;
  });
};

const finalizeNotification = async (
  notificationId: string,
  status: NotificationStatus,
  error?: string
): Promise<void> => {
  await prisma.notification.update({
    where: { id: notificationId },
    data: {
      status,
      ...(error ? { error: error.slice(0, 2_000) } : {})
    }
  });
};

const buildNotificationMessage = async (
  projectId: string,
  issueId: string
): Promise<NotificationMessage> => {
  const issue = await prisma.issue.findFirstOrThrow({
    where: {
      id: issueId,
      projectId
    },
    include: {
      project: true
    }
  });

  const dashboardUrl = `${env.CORS_ORIGIN}/projects/${projectId}/issues/${issueId}`;
  // Strip CRLF from untrusted, SDK-derived values before they enter the email
  // Subject header (header-injection / Bcc smuggling defence).
  const sanitizeHeader = (value: string): string => value.replace(/[\r\n]+/g, " ");
  const subject = `[Mini-Sentry] ${sanitizeHeader(issue.project.name)}: ${sanitizeHeader(issue.title)}`;
  const text = [
    `Project: ${issue.project.name}`,
    `Issue: ${issue.title}`,
    `Level: ${issue.level}`,
    `Times seen: ${String(issue.timesSeen)}`,
    `Status: ${issue.status}`,
    `Dashboard: ${dashboardUrl}`
  ].join("\n");

  return { subject, text };
};

export const processAlertsForEvent = async (
  projectId: string,
  result: AlertProcessEventResult,
  options: AlertDispatchOptions = {}
): Promise<void> => {
  const rules = await prisma.alertRule.findMany({
    where: {
      projectId,
      isActive: true
    },
    orderBy: { createdAt: "asc" }
  });

  if (rules.length === 0) {
    return;
  }

  const countWindows = [
    ...new Set(
      rules
        .filter(
          (rule) =>
            rule.condition === "event_threshold" ||
            rule.condition === "event_spike"
        )
        .map((rule) => rule.windowMinutes)
        .filter((windowMinutes): windowMinutes is number => windowMinutes !== null)
    )
  ];
  const spikeRules = rules.filter(
    (
      rule
    ): rule is AlertRule & {
      windowMinutes: number;
      baselineMinutes: number;
    } =>
      rule.condition === "event_spike" &&
      rule.windowMinutes !== null &&
      rule.baselineMinutes !== null
  );
  const now = Date.now();
  const [eventCountsByWindowMinutes, baselineCountsByWindow] =
    await Promise.all([
      getEventCountsByWindowMinutes(
        projectId,
        result.issueId,
        countWindows,
        now
      ),
      getSpikeBaselineCountsByWindow(
        projectId,
        result.issueId,
        spikeRules.map((rule) => ({
          windowMinutes: rule.windowMinutes,
          baselineMinutes: rule.baselineMinutes
        })),
        now
      )
    ]);
  const spikeCountsByRuleId = new Map(
    spikeRules.map((rule) => [
      rule.id,
      {
        recent: eventCountsByWindowMinutes.get(rule.windowMinutes) ?? 0,
        baseline:
          baselineCountsByWindow.get(
            `${String(rule.windowMinutes)}:${String(rule.baselineMinutes)}`
          ) ?? 0
      }
    ])
  );
  const issueState: AlertIssueState = {
    isNew: result.isNew,
    regressed: result.regressed,
    eventCountsByWindowMinutes,
    spikeCountsByRuleId
  };
  const evaluations = evaluateAlerts(rules.map(toEvaluationRule), issueState);

  if (evaluations.length === 0) {
    return;
  }

  const notifier = options.notifier ?? defaultNotifier;
  const message = await buildNotificationMessage(projectId, result.issueId);
  const rulesById = new Map(rules.map((rule) => [rule.id, rule]));

  await Promise.all(
    evaluations.map(async (evaluation) => {
      const rule = rulesById.get(evaluation.ruleId);
      if (!rule) {
        return;
      }

      const notificationId = await claimNotification(rule, result.issueId);
      if (!notificationId) {
        return;
      }

      try {
        await notifier.send(rule.channel, rule.target, message);
        await finalizeNotification(notificationId, NotificationStatus.sent);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        console.error("Notification delivery failed", {
          alertRuleId: rule.id,
          issueId: result.issueId,
          error
        });

        await finalizeNotification(
          notificationId,
          NotificationStatus.failed,
          errorMessage
        );
      }
    })
  );
};
