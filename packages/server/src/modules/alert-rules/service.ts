import {
  AlertChannel,
  AlertCondition,
  Prisma,
  type AlertRule
} from "@prisma/client";

import { badRequest, notFound } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import {
  mergedAlertRuleSchema,
  type CreateAlertRuleInput,
  type UpdateAlertRuleInput
} from "./schemas.js";

interface AlertRuleDto {
  id: string;
  projectId: string;
  name: string;
  channel: AlertRule["channel"];
  target: string;
  condition: AlertRule["condition"];
  threshold: number | null;
  windowMinutes: number | null;
  cooldownMinutes: number | null;
  baselineMinutes: number | null;
  spikeMultiplier: number | null;
  minEvents: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const toAlertRuleDto = (rule: AlertRule): AlertRuleDto => ({
  id: rule.id,
  projectId: rule.projectId,
  name: rule.name,
  channel: rule.channel,
  target: rule.target,
  condition: rule.condition,
  threshold: rule.threshold,
  windowMinutes: rule.windowMinutes,
  cooldownMinutes: rule.cooldownMinutes,
  baselineMinutes: rule.baselineMinutes,
  spikeMultiplier:
    rule.spikeMultiplier === null ? null : Number(rule.spikeMultiplier),
  minEvents: rule.minEvents,
  isActive: rule.isActive,
  createdAt: rule.createdAt.toISOString(),
  updatedAt: rule.updatedAt.toISOString()
});

const MAX_ALERT_RULES_PER_PROJECT = 50;

// Membership-based access: `ownerId` is the current user id; any project member
// may manage the project's alert rules.
const ensureOwnedProject = async (
  ownerId: string,
  projectId: string
): Promise<void> => {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      members: { some: { userId: ownerId } }
    },
    select: { id: true }
  });

  if (!project) {
    throw notFound("Project not found");
  }
};

const isRecordNotFoundError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";

const normalizeThresholdFields = (
  condition: AlertCondition,
  threshold: number | undefined,
  windowMinutes: number | undefined
): { threshold: number | null; windowMinutes: number | null } =>
  condition === "event_threshold" || condition === "event_spike"
    ? {
        threshold: condition === "event_threshold" ? threshold ?? null : null,
        windowMinutes: windowMinutes ?? null
      }
    : {
        threshold: null,
        windowMinutes: null
      };

const normalizeSpikeFields = (
  condition: AlertCondition,
  baselineMinutes: number | undefined,
  spikeMultiplier: number | undefined,
  minEvents: number | undefined
): {
  baselineMinutes: number | null;
  spikeMultiplier: Prisma.Decimal | null;
  minEvents: number | null;
} =>
  condition === "event_spike"
    ? {
        baselineMinutes: baselineMinutes ?? null,
        spikeMultiplier:
          spikeMultiplier === undefined ? null : new Prisma.Decimal(spikeMultiplier),
        minEvents: minEvents ?? null
      }
    : {
        baselineMinutes: null,
        spikeMultiplier: null,
        minEvents: null
      };

// Cooldown is the re-alert suppression window. It is meaningful for the two
// conditions that can fire repeatedly for one issue — regression and
// event_threshold — and dropped for new_issue (which fires at most once). When
// omitted for event_threshold the dispatcher falls back to windowMinutes.
const normalizeCooldownMinutes = (
  condition: AlertCondition,
  cooldownMinutes: number | undefined
): number | null =>
  condition === "regression" ||
  condition === "event_threshold" ||
  condition === "event_spike"
    ? cooldownMinutes ?? null
    : null;

const parseMergedAlertRule = (
  rule: Pick<
    AlertRule,
    | "name"
    | "channel"
    | "target"
    | "condition"
    | "threshold"
    | "windowMinutes"
    | "cooldownMinutes"
    | "baselineMinutes"
    | "spikeMultiplier"
    | "minEvents"
    | "isActive"
  >
): {
  name: string;
  channel: AlertChannel;
  target: string;
  condition: AlertCondition;
  threshold: number | null;
  windowMinutes: number | null;
  cooldownMinutes: number | null;
  baselineMinutes: number | null;
  spikeMultiplier: Prisma.Decimal | null;
  minEvents: number | null;
  isActive: boolean;
} => {
  const parsed = mergedAlertRuleSchema.safeParse({
    ...rule,
    threshold: rule.threshold ?? undefined,
    windowMinutes: rule.windowMinutes ?? undefined,
    cooldownMinutes: rule.cooldownMinutes ?? undefined,
    baselineMinutes: rule.baselineMinutes ?? undefined,
    spikeMultiplier:
      rule.spikeMultiplier === null ? undefined : Number(rule.spikeMultiplier),
    minEvents: rule.minEvents ?? undefined
  });

  if (!parsed.success) {
    throw badRequest("Invalid alert rule", parsed.error.issues);
  }

  return {
    name: parsed.data.name,
    channel: parsed.data.channel as AlertChannel,
    target: parsed.data.target,
    condition: parsed.data.condition as AlertCondition,
    ...normalizeThresholdFields(
      parsed.data.condition as AlertCondition,
      parsed.data.threshold,
      parsed.data.windowMinutes
    ),
    cooldownMinutes: normalizeCooldownMinutes(
      parsed.data.condition as AlertCondition,
      parsed.data.cooldownMinutes
    ),
    ...normalizeSpikeFields(
      parsed.data.condition as AlertCondition,
      parsed.data.baselineMinutes,
      parsed.data.spikeMultiplier,
      parsed.data.minEvents
    ),
    isActive: parsed.data.isActive
  };
};

export const listAlertRules = async (
  ownerId: string,
  projectId: string
): Promise<{ alertRules: AlertRuleDto[] }> => {
  await ensureOwnedProject(ownerId, projectId);

  const alertRules = await prisma.alertRule.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" }
  });

  return {
    alertRules: alertRules.map(toAlertRuleDto)
  };
};

export const createAlertRule = async (
  ownerId: string,
  projectId: string,
  input: CreateAlertRuleInput
): Promise<{ alertRule: AlertRuleDto }> => {
  await ensureOwnedProject(ownerId, projectId);

  const ruleCount = await prisma.alertRule.count({ where: { projectId } });
  if (ruleCount >= MAX_ALERT_RULES_PER_PROJECT) {
    throw badRequest(
      `Alert rule limit of ${String(MAX_ALERT_RULES_PER_PROJECT)} reached for this project`
    );
  }

  const parsed = parseMergedAlertRule({
    name: input.name,
    channel: input.channel as AlertChannel,
    target: input.target,
    condition: input.condition as AlertCondition,
    threshold: input.threshold ?? null,
    windowMinutes: input.windowMinutes ?? null,
    cooldownMinutes: input.cooldownMinutes ?? null,
    baselineMinutes: input.baselineMinutes ?? null,
    spikeMultiplier:
      input.spikeMultiplier === undefined
        ? null
        : new Prisma.Decimal(input.spikeMultiplier),
    minEvents: input.minEvents ?? null,
    isActive: input.isActive
  });

  try {
    const alertRule = await prisma.alertRule.create({
      data: {
        name: parsed.name,
        channel: parsed.channel,
        target: parsed.target,
        condition: parsed.condition,
        threshold: parsed.threshold,
        windowMinutes: parsed.windowMinutes,
        cooldownMinutes: parsed.cooldownMinutes,
        baselineMinutes: parsed.baselineMinutes,
        spikeMultiplier: parsed.spikeMultiplier,
        minEvents: parsed.minEvents,
        isActive: parsed.isActive,
        // Membership already verified by ensureOwnedProject above.
        project: {
          connect: {
            id: projectId
          }
        }
      }
    });

    return {
      alertRule: toAlertRuleDto(alertRule)
    };
  } catch (error) {
    if (isRecordNotFoundError(error)) {
      throw notFound("Project not found");
    }

    throw error;
  }
};

export const getAlertRule = async (
  ownerId: string,
  projectId: string,
  ruleId: string
): Promise<{ alertRule: AlertRuleDto }> => {
  const alertRule = await prisma.alertRule.findFirst({
    where: {
      id: ruleId,
      projectId,
      project: {
        members: { some: { userId: ownerId } }
      }
    }
  });

  if (!alertRule) {
    throw notFound("Alert rule not found");
  }

  return {
    alertRule: toAlertRuleDto(alertRule)
  };
};

export const updateAlertRule = async (
  ownerId: string,
  projectId: string,
  ruleId: string,
  input: UpdateAlertRuleInput
): Promise<{ alertRule: AlertRuleDto }> => {
  try {
    const alertRule = await prisma.$transaction(async (tx) => {
      const existing = await tx.alertRule.findFirstOrThrow({
        where: {
          id: ruleId,
          projectId,
          project: {
            members: { some: { userId: ownerId } }
          }
        }
      });

      const parsed = parseMergedAlertRule({
        name: input.name ?? existing.name,
        channel: input.channel ?? existing.channel,
        target: input.target ?? existing.target,
        condition: input.condition ?? existing.condition,
        threshold: input.threshold ?? existing.threshold,
        windowMinutes: input.windowMinutes ?? existing.windowMinutes,
        cooldownMinutes: input.cooldownMinutes ?? existing.cooldownMinutes,
        baselineMinutes: input.baselineMinutes ?? existing.baselineMinutes,
        spikeMultiplier:
          input.spikeMultiplier === undefined
            ? existing.spikeMultiplier
            : new Prisma.Decimal(input.spikeMultiplier),
        minEvents: input.minEvents ?? existing.minEvents,
        isActive: input.isActive ?? existing.isActive
      });

      return tx.alertRule.update({
        // Membership already verified by findFirstOrThrow above (same tx).
        where: { id: ruleId },
        data: parsed
      });
    });

    return {
      alertRule: toAlertRuleDto(alertRule)
    };
  } catch (error) {
    if (isRecordNotFoundError(error)) {
      throw notFound("Alert rule not found");
    }

    throw error;
  }
};

export const deleteAlertRule = async (
  ownerId: string,
  projectId: string,
  ruleId: string
): Promise<void> => {
  // Any member may delete alert rules; prove membership, then delete by id.
  await ensureOwnedProject(ownerId, projectId);

  try {
    await prisma.alertRule.delete({
      where: {
        id: ruleId,
        projectId
      }
    });
  } catch (error) {
    if (isRecordNotFoundError(error)) {
      throw notFound("Alert rule not found");
    }

    throw error;
  }
};
