import { IssueLevel, Prisma } from "@prisma/client";

import { prisma } from "../../lib/prisma.js";
import { mergeEventContexts, truncateUserAgent } from "./enrich.js";
import { buildCulprit, buildFingerprint, buildTitle } from "./fingerprint.js";
import type { EventPayload, IssueLevelInput } from "./schemas.js";

export interface ProcessEventResult {
  issueId: string;
  eventId: string;
  isNew: boolean;
  regressed: boolean;
}

/** Server-captured metadata that isn't part of the SDK payload. */
export interface EventMeta {
  userAgent?: string;
}

const severityRank: Record<IssueLevelInput, number> = {
  debug: 0,
  info: 1,
  warning: 2,
  error: 3,
  fatal: 4
};

const maxSeverity = (
  currentLevel: IssueLevelInput,
  nextLevel: IssueLevelInput
): IssueLevelInput =>
  severityRank[nextLevel] > severityRank[currentLevel] ? nextLevel : currentLevel;

const toPrismaLevel = (level: IssueLevelInput): IssueLevel => level as IssueLevel;

const toJson = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;

const isKnownPrismaError = (
  error: unknown
): error is Prisma.PrismaClientKnownRequestError =>
  error instanceof Prisma.PrismaClientKnownRequestError;

const processEventOnce = async (
  projectId: string,
  payload: EventPayload,
  meta: EventMeta
): Promise<ProcessEventResult> => {
  const now = new Date();
  const fingerprint = buildFingerprint(payload);
  const title = buildTitle(payload);
  const culprit = buildCulprit(payload);
  const eventTimestamp = new Date(payload.timestamp);
  // Enrich with browser/os/device parsed from the request User-Agent; the SDK's
  // own contexts (if any) take precedence over the server-derived ones.
  const contexts = mergeEventContexts(payload.contexts, meta.userAgent);

  const result = await prisma.$transaction(async (tx) => {
    const existingIssue = await tx.issue.findUnique({
      where: {
        projectId_fingerprint: {
          projectId,
          fingerprint
        }
      },
      select: {
        id: true,
        level: true,
        status: true
      }
    });
    // Only a previously *resolved* issue regressing counts as a regression.
    // An intentionally *ignored* issue stays ignored and must not re-alert.
    const regressed = existingIssue?.status === "resolved";

    const issue = existingIssue
      ? await tx.issue.update({
          where: { id: existingIssue.id },
          data: {
            timesSeen: { increment: 1 },
            lastSeen: now,
            level: toPrismaLevel(
              maxSeverity(existingIssue.level as IssueLevelInput, payload.level)
            ),
            ...(regressed ? { status: "unresolved" as const } : {})
          },
          select: { id: true }
        })
      : await tx.issue.create({
          data: {
            projectId,
            fingerprint,
            title,
            culprit,
            level: toPrismaLevel(payload.level),
            timesSeen: 1,
            firstSeen: now,
            lastSeen: now,
            ...(payload.release !== undefined
              ? { firstRelease: payload.release }
              : {})
          },
          select: { id: true }
        });

    const event = await tx.event.create({
      data: {
        issueId: issue.id,
        projectId,
        ...(payload.message !== undefined ? { message: payload.message } : {}),
        ...(payload.exception?.type !== undefined
          ? { exceptionType: payload.exception.type }
          : {}),
        ...(payload.exception?.value !== undefined
          ? { exceptionValue: payload.exception.value }
          : {}),
        ...(payload.exception?.stacktrace !== undefined
          ? { stacktrace: toJson(payload.exception.stacktrace) }
          : {}),
        ...(payload.breadcrumbs !== undefined
          ? { breadcrumbs: toJson(payload.breadcrumbs) }
          : {}),
        ...(payload.tags !== undefined ? { tags: toJson(payload.tags) } : {}),
        ...(payload.user !== undefined
          ? { userContext: toJson(payload.user) }
          : {}),
        ...(contexts !== undefined ? { contexts: toJson(contexts) } : {}),
        ...(meta.userAgent !== undefined
          ? { userAgent: truncateUserAgent(meta.userAgent) }
          : {}),
        level: toPrismaLevel(payload.level),
        ...(payload.environment !== undefined
          ? { environment: payload.environment }
          : {}),
        ...(payload.release !== undefined ? { release: payload.release } : {}),
        isRegression: regressed,
        ...(payload.sdk?.name !== undefined ? { sdkName: payload.sdk.name } : {}),
        ...(payload.sdk?.version !== undefined
          ? { sdkVersion: payload.sdk.version }
          : {}),
        ...(payload.request?.url !== undefined
          ? { requestUrl: payload.request.url }
          : {}),
        ...(payload.eventId !== undefined
          ? { clientEventId: payload.eventId }
          : {}),
        timestamp: eventTimestamp,
        receivedAt: now
      },
      select: { id: true }
    });

    return {
      issueId: issue.id,
      eventId: event.id,
      isNew: !existingIssue,
      regressed
    };
  });

  // Best-effort snapshot insert OUTSIDE the transaction: a snapshot failure must
  // never roll back (and so lose) the error event. `eventId` is unique and each
  // successful transaction creates a fresh event row, so this runs once per
  // event — including on the fingerprint-conflict retry path.
  if (payload.replay !== undefined) {
    try {
      await prisma.eventSnapshot.create({
        data: {
          eventId: result.eventId,
          projectId,
          data: toJson(payload.replay.data),
          ...(payload.replay.href !== undefined ? { href: payload.replay.href } : {}),
          ...(payload.replay.width !== undefined ? { width: payload.replay.width } : {}),
          ...(payload.replay.height !== undefined ? { height: payload.replay.height } : {})
        }
      });
    } catch {
      /* snapshot is best-effort; never lose the event because of it */
    }
  }

  return result;
};

const isIssueFingerprintConflict = (error: unknown): boolean => {
  if (!isKnownPrismaError(error) || error.code !== "P2002") {
    return false;
  }

  const target = error.meta?.target;

  return Array.isArray(target)
    ? target.includes("projectId") && target.includes("fingerprint")
    : typeof target === "string" &&
        target.includes("projectId") &&
        target.includes("fingerprint");
};

export const processEvent = async (
  projectId: string,
  payload: EventPayload,
  meta: EventMeta = {}
): Promise<ProcessEventResult> => {
  try {
    return await processEventOnce(projectId, payload, meta);
  } catch (error) {
    if (isIssueFingerprintConflict(error)) {
      return await processEventOnce(projectId, payload, meta);
    }

    throw error;
  }
};
