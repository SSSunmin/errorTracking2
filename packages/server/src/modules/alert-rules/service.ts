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
  isActive: rule.isActive,
  createdAt: rule.createdAt.toISOString(),
  updatedAt: rule.updatedAt.toISOString()
});

const MAX_ALERT_RULES_PER_PROJECT = 50;

const ensureOwnedProject = async (
  ownerId: string,
  projectId: string
): Promise<void> => {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      ownerId
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
  condition === "event_threshold"
    ? {
        threshold: threshold ?? null,
        windowMinutes: windowMinutes ?? null
      }
    : {
        threshold: null,
        windowMinutes: null
      };

const parseMergedAlertRule = (
  rule: Pick<
    AlertRule,
    | "name"
    | "channel"
    | "target"
    | "condition"
    | "threshold"
    | "windowMinutes"
    | "isActive"
  >
): {
  name: string;
  channel: AlertChannel;
  target: string;
  condition: AlertCondition;
  threshold: number | null;
  windowMinutes: number | null;
  isActive: boolean;
} => {
  const parsed = mergedAlertRuleSchema.safeParse({
    ...rule,
    threshold: rule.threshold ?? undefined,
    windowMinutes: rule.windowMinutes ?? undefined
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
        isActive: parsed.isActive,
        project: {
          connect: {
            id: projectId,
            ownerId
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
        ownerId
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
            ownerId
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
        isActive: input.isActive ?? existing.isActive
      });

      return tx.alertRule.update({
        where: {
          id: ruleId,
          projectId,
          project: {
            ownerId
          }
        },
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
  try {
    await prisma.alertRule.delete({
      where: {
        id: ruleId,
        projectId,
        project: {
          ownerId
        }
      }
    });
  } catch (error) {
    if (isRecordNotFoundError(error)) {
      throw notFound("Alert rule not found");
    }

    throw error;
  }
};
