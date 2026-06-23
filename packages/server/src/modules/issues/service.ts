import { Prisma, type Event, type Issue, type IssueStatus } from "@prisma/client";

import { notFound } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { symbolicateEvents } from "../sourcemaps/service.js";
import type {
  IssueStatsQuery,
  ListEventsQuery,
  ListIssuesQuery,
  UpdateIssueInput
} from "./schemas.js";

interface IssueListItemDto {
  id: string;
  title: string;
  culprit: string | null;
  level: Issue["level"];
  status: Issue["status"];
  timesSeen: number;
  firstSeen: string;
  lastSeen: string;
}

interface EventSummaryDto {
  id: string;
  message: string | null;
  exceptionType: string | null;
  exceptionValue: string | null;
  level: Event["level"];
  environment: string | null;
  release: string | null;
  timestamp: string;
  receivedAt: string;
}

interface EventDetailDto extends EventSummaryDto {
  stacktrace: unknown;
  breadcrumbs: unknown;
  tags: unknown;
  userContext: unknown;
  contexts: unknown;
  sdkName: string | null;
  sdkVersion: string | null;
  requestUrl: string | null;
  userAgent: string | null;
  hasSnapshot: boolean;
  hasReplay: boolean;
}

interface EventSnapshotDto {
  data: unknown;
  href: string | null;
  width: number | null;
  height: number | null;
}

type EventWithSnapshotFlag = Event & { snapshot: { id: string } | null };

// Resolve the stacktrace to expose per event: a cached symbolicated stacktrace
// when present, otherwise lazily symbolicate against the release's source maps
// (caching the result), falling back to the raw stored stacktrace.
const resolveStacktraces = async (
  events: readonly EventWithSnapshotFlag[]
): Promise<Map<string, unknown>> => {
  const resolved = new Map<string, unknown>();
  const uncached: EventWithSnapshotFlag[] = [];

  for (const event of events) {
    if (event.symbolicated != null) {
      resolved.set(event.id, event.symbolicated);
    } else {
      resolved.set(event.id, event.stacktrace);
      uncached.push(event);
    }
  }

  if (uncached.length === 0) {
    return resolved;
  }

  const outcomes = await symbolicateEvents(
    uncached.map((event) => ({
      id: event.id,
      projectId: event.projectId,
      release: event.release,
      stacktrace: event.stacktrace
    }))
  );

  const cacheWrites: Promise<unknown>[] = [];
  for (const [eventId, outcome] of outcomes) {
    if (!outcome.changed) {
      continue;
    }
    const stacktrace = { frames: outcome.frames };
    resolved.set(eventId, stacktrace);
    // Cache-fill on read so later detail views skip re-decoding source maps.
    cacheWrites.push(
      prisma.event
        .update({
          where: { id: eventId },
          data: { symbolicated: stacktrace as unknown as Prisma.InputJsonValue }
        })
        .catch(() => undefined)
    );
  }
  await Promise.allSettled(cacheWrites);

  return resolved;
};

const toIssueListItem = (issue: Issue): IssueListItemDto => ({
  id: issue.id,
  title: issue.title,
  culprit: issue.culprit,
  level: issue.level,
  status: issue.status,
  timesSeen: issue.timesSeen,
  firstSeen: issue.firstSeen.toISOString(),
  lastSeen: issue.lastSeen.toISOString()
});

const toEventSummary = (event: Event): EventSummaryDto => ({
  id: event.id,
  message: event.message,
  exceptionType: event.exceptionType,
  exceptionValue: event.exceptionValue,
  level: event.level,
  environment: event.environment,
  release: event.release,
  timestamp: event.timestamp.toISOString(),
  receivedAt: event.receivedAt.toISOString()
});

const toEventDetail = (
  event: EventWithSnapshotFlag,
  replayClientEventIds: ReadonlySet<string>,
  stacktrace: unknown
): EventDetailDto => ({
  ...toEventSummary(event),
  stacktrace,
  breadcrumbs: event.breadcrumbs,
  tags: event.tags,
  userContext: event.userContext,
  contexts: event.contexts,
  sdkName: event.sdkName,
  sdkVersion: event.sdkVersion,
  requestUrl: event.requestUrl,
  userAgent: event.userAgent,
  hasSnapshot: event.snapshot != null,
  hasReplay:
    event.clientEventId != null && replayClientEventIds.has(event.clientEventId)
});

// Membership-based access: `ownerId` is the current user id; any project member
// may access the project's issues/events.
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

const ensureOwnedIssue = async (
  ownerId: string,
  projectId: string,
  issueId: string
): Promise<Issue> => {
  const issue = await prisma.issue.findFirst({
    where: {
      id: issueId,
      projectId,
      project: {
        members: { some: { userId: ownerId } }
      }
    }
  });

  if (!issue) {
    throw notFound("Issue not found");
  }

  return issue;
};

export const listIssues = async (
  ownerId: string,
  projectId: string,
  query: ListIssuesQuery
): Promise<{ issues: IssueListItemDto[]; nextCursor: string | null }> => {
  await ensureOwnedProject(ownerId, projectId);

  // release/environment are Event fields, so match issues that have at least one
  // event in that release/environment. Combined into one `some` so both, when
  // given, must be satisfied by the same event.
  const eventFilter: Prisma.EventWhereInput = {
    ...(query.release !== undefined ? { release: query.release } : {}),
    ...(query.environment !== undefined ? { environment: query.environment } : {})
  };
  const lastSeenFilter: Prisma.DateTimeFilter = {
    ...(query.since !== undefined ? { gte: query.since } : {}),
    ...(query.until !== undefined ? { lte: query.until } : {})
  };

  const issues = await prisma.issue.findMany({
    where: {
      projectId,
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.level !== undefined ? { level: query.level } : {}),
      ...(Object.keys(eventFilter).length > 0 ? { events: { some: eventFilter } } : {}),
      ...(Object.keys(lastSeenFilter).length > 0 ? { lastSeen: lastSeenFilter } : {}),
      ...(query.query !== undefined
        ? {
            title: {
              contains: query.query,
              mode: "insensitive"
            }
          }
        : {})
    },
    orderBy: {
      [query.sort]: "desc"
    },
    take: query.limit + 1,
    ...(query.cursor !== undefined
      ? {
          cursor: { id: query.cursor },
          skip: 1
        }
      : {
          skip: (query.page - 1) * query.limit
        })
  });

  const pageItems = issues.slice(0, query.limit);

  return {
    issues: pageItems.map(toIssueListItem),
    nextCursor: issues.length > query.limit ? (pageItems.at(-1)?.id ?? null) : null
  };
};

export const getIssue = async (
  ownerId: string,
  projectId: string,
  issueId: string
): Promise<{ issue: IssueListItemDto & { latestEvent: EventSummaryDto | null } }> => {
  const issue = await ensureOwnedIssue(ownerId, projectId, issueId);
  const latestEvent = await prisma.event.findFirst({
    where: {
      issueId,
      projectId
    },
    orderBy: {
      receivedAt: "desc"
    }
  });

  return {
    issue: {
      ...toIssueListItem(issue),
      latestEvent: latestEvent ? toEventSummary(latestEvent) : null
    }
  };
};

export const listIssueEvents = async (
  ownerId: string,
  projectId: string,
  issueId: string,
  query: ListEventsQuery
): Promise<{ events: EventDetailDto[]; nextCursor: string | null }> => {
  await ensureOwnedIssue(ownerId, projectId, issueId);

  const events = await prisma.event.findMany({
    where: {
      issueId,
      projectId
    },
    include: { snapshot: { select: { id: true } } },
    orderBy: {
      receivedAt: "desc"
    },
    take: query.limit + 1,
    ...(query.cursor !== undefined
      ? {
          cursor: { id: query.cursor },
          skip: 1
        }
      : {
          skip: (query.page - 1) * query.limit
        })
  });

  const pageItems = events.slice(0, query.limit);

  // Resolve hasReplay for the whole page in one query: which of the page's
  // clientEventIds have a stored EventReplay. (Snapshot/B uses the included
  // relation above; replays live in a separate table linked by clientEventId.)
  const clientEventIds = pageItems
    .map((event) => event.clientEventId)
    .filter((id): id is string => id != null);
  const replayClientEventIds = new Set<string>();
  if (clientEventIds.length > 0) {
    const replays = await prisma.eventReplay.findMany({
      where: { clientEventId: { in: clientEventIds } },
      select: { clientEventId: true }
    });
    for (const replay of replays) {
      replayClientEventIds.add(replay.clientEventId);
    }
  }

  const resolvedStacktraces = await resolveStacktraces(pageItems);

  return {
    events: pageItems.map((event) =>
      toEventDetail(
        event,
        replayClientEventIds,
        resolvedStacktraces.get(event.id) ?? event.stacktrace
      )
    ),
    nextCursor: events.length > query.limit ? (pageItems.at(-1)?.id ?? null) : null
  };
};

export const getEventSnapshot = async (
  ownerId: string,
  projectId: string,
  issueId: string,
  eventId: string
): Promise<{ snapshot: EventSnapshotDto | null }> => {
  await ensureOwnedIssue(ownerId, projectId, issueId);

  const snapshot = await prisma.eventSnapshot.findFirst({
    where: {
      eventId,
      event: { issueId, projectId }
    },
    select: { data: true, href: true, width: true, height: true }
  });

  return {
    snapshot: snapshot
      ? {
          data: snapshot.data,
          href: snapshot.href,
          width: snapshot.width,
          height: snapshot.height
        }
      : null
  };
};

export const getEventReplay = async (
  ownerId: string,
  projectId: string,
  issueId: string,
  eventId: string
): Promise<Buffer | null> => {
  await ensureOwnedIssue(ownerId, projectId, issueId);

  // Resolve the event (ownership already proven above) to get its client-side
  // eventId, which is how replays are linked (no hard FK — a replay may arrive
  // before async event processing has created the row).
  const event = await prisma.event.findFirst({
    where: { id: eventId, issueId, projectId },
    select: { clientEventId: true }
  });

  if (!event?.clientEventId) {
    return null;
  }

  const replay = await prisma.eventReplay.findUnique({
    where: { clientEventId: event.clientEventId },
    select: { data: true }
  });

  if (!replay) {
    return null;
  }

  // The stored bytes are already gzip-compressed (the server never decompresses
  // on store). Hand back the raw Buffer; the route sets content-encoding: gzip.
  return Buffer.isBuffer(replay.data) ? replay.data : Buffer.from(replay.data);
};

export const getIssueStats = async (
  ownerId: string,
  projectId: string,
  issueId: string,
  query: IssueStatsQuery
): Promise<{ buckets: { bucket: string; count: number }[] }> => {
  await ensureOwnedIssue(ownerId, projectId, issueId);

  const now = new Date();
  const windowMs = query.window === "24h" ? 24 * 60 * 60 * 1_000 : 7 * 24 * 60 * 60 * 1_000;
  const since = new Date(now.getTime() - windowMs);
  const truncUnit = query.window === "24h" ? "hour" : "day";
  const rows = await prisma.$queryRaw<{ bucket: Date; count: bigint }[]>`
    SELECT date_trunc(${truncUnit}, "receivedAt") AS bucket, COUNT(*)::bigint AS count
    FROM "Event"
    WHERE "projectId" = ${projectId}
      AND "issueId" = ${issueId}
      AND "receivedAt" >= ${since}
    GROUP BY bucket
    ORDER BY bucket ASC
  `;

  return {
    buckets: rows.map((row) => ({
      bucket: row.bucket.toISOString(),
      count: Number(row.count)
    }))
  };
};

export const updateIssueStatus = async (
  ownerId: string,
  projectId: string,
  issueId: string,
  input: UpdateIssueInput
): Promise<{ issue: IssueListItemDto }> => {
  // Any member may change issue status; prove membership, then update by id.
  await ensureOwnedIssue(ownerId, projectId, issueId);

  const issue = await prisma.issue.update({
    where: { id: issueId },
    data: {
      status: input.status as IssueStatus
    }
  });

  return {
    issue: toIssueListItem(issue)
  };
};
