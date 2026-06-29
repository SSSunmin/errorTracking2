import { Prisma, type Event, type Issue, type IssueStatus } from "@prisma/client";

import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { symbolicateEvents } from "../sourcemaps/service.js";
import type {
  CreateCommentInput,
  IssueStatsQuery,
  ListEventsQuery,
  ListIssuesQuery,
  UpdateAssigneeInput,
  UpdateIssueInput
} from "./schemas.js";

interface IssueAssigneeDto {
  userId: string;
  email: string;
  name: string | null;
}

interface IssueListItemDto {
  id: string;
  title: string;
  culprit: string | null;
  level: Issue["level"];
  status: Issue["status"];
  timesSeen: number;
  firstSeen: string;
  lastSeen: string;
  assignee: IssueAssigneeDto | null;
}

interface IssueCommentDto {
  id: string;
  body: string;
  author: IssueAssigneeDto;
  createdAt: string;
}

// At most this many comments are returned per issue (oldest first). Threads on a
// single issue are expected to be small; this is a safety cap, consistent with
// other list endpoints that bound their result size.
const maxComments = 200;

// Prisma `select` that pulls the assignee's public fields for DTO mapping.
const assigneeSelect = {
  select: { id: true, email: true, name: true }
};

type IssueWithAssignee = Issue & {
  assignee: { id: string; email: string; name: string | null } | null;
};

const toAssigneeDto = (
  user: { id: string; email: string; name: string | null } | null
): IssueAssigneeDto | null =>
  user ? { userId: user.id, email: user.email, name: user.name } : null;

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

const toIssueListItem = (issue: IssueWithAssignee): IssueListItemDto => ({
  id: issue.id,
  title: issue.title,
  culprit: issue.culprit,
  level: issue.level,
  status: issue.status,
  timesSeen: issue.timesSeen,
  firstSeen: issue.firstSeen.toISOString(),
  lastSeen: issue.lastSeen.toISOString(),
  assignee: toAssigneeDto(issue.assignee)
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
): Promise<IssueWithAssignee> => {
  const issue = await prisma.issue.findFirst({
    where: {
      id: issueId,
      projectId,
      project: {
        members: { some: { userId: ownerId } }
      }
    },
    include: { assignee: assigneeSelect }
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
    include: { assignee: assigneeSelect },
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

export const listIssueFacets = async (
  ownerId: string,
  projectId: string
): Promise<{ releases: string[]; environments: string[] }> => {
  await ensureOwnedProject(ownerId, projectId);

  // Distinct release/environment values for this project's events, for the
  // dashboard filter autocomplete. null excluded, asc, capped at 100 each.
  // Raw SQL (like getIssueStats) so the plan is a guaranteed DISTINCT + ORDER BY
  // + LIMIT that uses the (projectId, release)/(projectId, environment) indexes,
  // rather than relying on what Prisma's `distinct` happens to generate.
  const [releaseRows, environmentRows] = await Promise.all([
    prisma.$queryRaw<{ value: string }[]>`
      SELECT DISTINCT "release" AS value
      FROM "Event"
      WHERE "projectId" = ${projectId} AND "release" IS NOT NULL
      ORDER BY "release" ASC
      LIMIT 100
    `,
    prisma.$queryRaw<{ value: string }[]>`
      SELECT DISTINCT "environment" AS value
      FROM "Event"
      WHERE "projectId" = ${projectId} AND "environment" IS NOT NULL
      ORDER BY "environment" ASC
      LIMIT 100
    `
  ]);

  return {
    releases: releaseRows.map((row) => row.value),
    environments: environmentRows.map((row) => row.value)
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
): Promise<{
  buckets: { bucket: string; count: number; users: number }[];
  affectedUsers: number;
}> => {
  await ensureOwnedIssue(ownerId, projectId, issueId);

  const now = new Date();
  const windowMs = query.window === "24h" ? 24 * 60 * 60 * 1_000 : 7 * 24 * 60 * 60 * 1_000;
  const since = new Date(now.getTime() - windowMs);
  const truncUnit = query.window === "24h" ? "hour" : "day";
  const rows = await prisma.$queryRaw<
    { bucket: Date; count: bigint; users: bigint }[]
  >`
    SELECT date_trunc(${truncUnit}, "receivedAt") AS bucket,
      COUNT(*)::bigint AS count,
      (COUNT(DISTINCT "userContext"->>'id')
        FILTER (WHERE "userContext"->>'id' IS NOT NULL))::bigint AS users
    FROM "Event"
    WHERE "projectId" = ${projectId}
      AND "issueId" = ${issueId}
      AND "receivedAt" >= ${since}
    GROUP BY bucket
    ORDER BY bucket ASC
  `;

  // Distinct affected users over the same window, keyed by userContext->>'id'
  // (the SDK's user.id); events without a user.id are excluded.
  const affected = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(DISTINCT "userContext"->>'id')::bigint AS count
    FROM "Event"
    WHERE "projectId" = ${projectId}
      AND "issueId" = ${issueId}
      AND "receivedAt" >= ${since}
      AND "userContext"->>'id' IS NOT NULL
  `;

  return {
    buckets: rows.map((row) => ({
      bucket: row.bucket.toISOString(),
      count: Number(row.count),
      users: Number(row.users)
    })),
    affectedUsers: Number(affected[0]?.count ?? 0)
  };
};

const releaseIssuesLimit = 100;

export const getReleaseIssues = async (
  ownerId: string,
  projectId: string,
  release: string
): Promise<{
  release: string;
  newIssues: IssueListItemDto[];
  newIssuesTruncated: boolean;
  regressedIssues: IssueListItemDto[];
  regressedIssuesTruncated: boolean;
}> => {
  await ensureOwnedProject(ownerId, projectId);

  // New issues: first appeared in this release (firstRelease recorded on create).
  // Regressed issues: have at least one regression event tagged with this release
  // (events.some on isRegression + release); `ignored` is excluded since the user
  // has already triaged it away from the active list. The two lists are derived
  // from different signals and may overlap if an issue both debuted and regressed
  // in the same release — callers can dedupe if needed.
  // take limit+1 so we can report truncation rather than silently dropping rows.
  const [newIssues, regressedIssues] = await Promise.all([
    prisma.issue.findMany({
      where: { projectId, firstRelease: release },
      include: { assignee: assigneeSelect },
      orderBy: { lastSeen: "desc" },
      take: releaseIssuesLimit + 1
    }),
    prisma.issue.findMany({
      where: {
        projectId,
        status: { not: "ignored" },
        events: { some: { isRegression: true, release } }
      },
      include: { assignee: assigneeSelect },
      orderBy: { lastSeen: "desc" },
      take: releaseIssuesLimit + 1
    })
  ]);

  return {
    release,
    newIssues: newIssues.slice(0, releaseIssuesLimit).map(toIssueListItem),
    newIssuesTruncated: newIssues.length > releaseIssuesLimit,
    regressedIssues: regressedIssues.slice(0, releaseIssuesLimit).map(toIssueListItem),
    regressedIssuesTruncated: regressedIssues.length > releaseIssuesLimit
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
    },
    include: { assignee: assigneeSelect }
  });

  return {
    issue: toIssueListItem(issue)
  };
};

export const setIssueAssignee = async (
  ownerId: string,
  projectId: string,
  issueId: string,
  input: UpdateAssigneeInput
): Promise<{ issue: IssueListItemDto }> => {
  // Any member may (re)assign; prove issue membership first (non-members 404).
  await ensureOwnedIssue(ownerId, projectId, issueId);

  // A non-null assignee must be a member of THIS project. We check membership
  // (not mere user existence) so issues can only be assigned to teammates. The
  // membership check and the update run in one transaction so a member removed
  // in between can't slip through (TOCTOU).
  const issue = await prisma.$transaction(async (tx) => {
    if (input.assigneeId !== null) {
      const member = await tx.projectMember.findUnique({
        where: {
          projectId_userId: { projectId, userId: input.assigneeId }
        },
        select: { userId: true }
      });
      if (!member) {
        throw badRequest("Assignee must be a member of this project");
      }
    }

    return tx.issue.update({
      where: { id: issueId },
      data: { assigneeId: input.assigneeId },
      include: { assignee: assigneeSelect }
    });
  });

  return {
    issue: toIssueListItem(issue)
  };
};

const toCommentDto = (comment: {
  id: string;
  body: string;
  createdAt: Date;
  author: { id: string; email: string; name: string | null };
}): IssueCommentDto => ({
  id: comment.id,
  body: comment.body,
  author: {
    userId: comment.author.id,
    email: comment.author.email,
    name: comment.author.name
  },
  createdAt: comment.createdAt.toISOString()
});

export const listIssueComments = async (
  ownerId: string,
  projectId: string,
  issueId: string
): Promise<{ comments: IssueCommentDto[] }> => {
  await ensureOwnedIssue(ownerId, projectId, issueId);

  const comments = await prisma.issueComment.findMany({
    where: { issueId },
    include: { author: { select: { id: true, email: true, name: true } } },
    orderBy: { createdAt: "asc" },
    take: maxComments
  });

  return { comments: comments.map(toCommentDto) };
};

export const createIssueComment = async (
  ownerId: string,
  projectId: string,
  issueId: string,
  input: CreateCommentInput
): Promise<{ comment: IssueCommentDto }> => {
  await ensureOwnedIssue(ownerId, projectId, issueId);

  const comment = await prisma.issueComment.create({
    data: { issueId, authorId: ownerId, body: input.body },
    include: { author: { select: { id: true, email: true, name: true } } }
  });

  return { comment: toCommentDto(comment) };
};

export const deleteIssueComment = async (
  ownerId: string,
  projectId: string,
  issueId: string,
  commentId: string
): Promise<void> => {
  await ensureOwnedIssue(ownerId, projectId, issueId);

  const comment = await prisma.issueComment.findFirst({
    where: { id: commentId, issueId },
    select: { authorId: true }
  });
  if (!comment) {
    throw notFound("Comment not found");
  }

  // The author may always delete their own comment; otherwise only an
  // owner-role member of the project may delete it.
  if (comment.authorId !== ownerId) {
    const membership = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: ownerId } },
      select: { role: true }
    });
    if (membership?.role !== "owner") {
      throw forbidden("Only the author or a project owner can delete this comment");
    }
  }

  // Scope the delete to the issue too: the findFirst above already proves the
  // comment belongs to this issue, but keeping issueId here is a defense-in-depth
  // guard so the two checks can't drift apart in future edits.
  await prisma.issueComment.delete({ where: { id: commentId, issueId } });
};
