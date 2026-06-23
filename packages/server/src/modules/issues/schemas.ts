import { z } from "zod/v4";

import { issueLevelSchema } from "../events/schemas.js";

export const issueStatusSchema = z.enum(["unresolved", "resolved", "ignored"]);
const maxPaginationOffset = 10_000;

export const issueParamsSchema = z.object({
  id: z.string().min(1),
  issueId: z.string().min(1)
});

export const eventSnapshotParamsSchema = issueParamsSchema.extend({
  eventId: z.string().min(1)
});

export const commentParamsSchema = issueParamsSchema.extend({
  commentId: z.string().min(1)
});

export const listIssuesQuerySchema = z
  .object({
    status: issueStatusSchema.optional(),
    level: issueLevelSchema.optional(),
    // release/environment live on Event, not Issue: these match issues that have
    // at least one event in the given release/environment (events.some).
    release: z.string().min(1).max(256).optional(),
    environment: z.string().min(1).max(256).optional(),
    // Inclusive window on the issue's lastSeen (ISO timestamps).
    since: z.coerce.date().optional(),
    until: z.coerce.date().optional(),
    query: z.string().min(1).optional(),
    sort: z.enum(["lastSeen", "firstSeen", "timesSeen"]).default("lastSeen"),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).optional(),
    page: z.coerce.number().int().min(1).default(1)
  })
  .refine((query) => query.cursor !== undefined || query.page * query.limit <= maxPaginationOffset, {
    message: "Pagination offset is too large",
    path: ["page"]
  })
  .refine((query) => query.since === undefined || query.until === undefined || query.since <= query.until, {
    message: "since must not be after until",
    path: ["since"]
  });

export const listEventsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).optional(),
    page: z.coerce.number().int().min(1).default(1)
  })
  .refine((query) => query.cursor !== undefined || query.page * query.limit <= maxPaginationOffset, {
    message: "Pagination offset is too large",
    path: ["page"]
  });

export const issueStatsQuerySchema = z.object({
  window: z.enum(["24h", "7d"]).default("24h")
});

export const releaseIssuesParamsSchema = z.object({
  id: z.string().min(1),
  // URL-encoded release segment; same 1–256 bounds as the release filter.
  // Fastify decodes the segment, so encodeURIComponent round-trips. Releases
  // containing a literal "/" can't be addressed as one path segment (router 404)
  // — out of scope; release tags rarely contain slashes.
  release: z.string().min(1).max(256)
});

export const updateIssueSchema = z.object({
  status: issueStatusSchema
});

export const updateAssigneeSchema = z.object({
  // A user id to assign, or null to clear the assignee. "" is rejected (min 1).
  assigneeId: z.string().min(1).nullable()
});

const maxCommentLength = 5_000;

export const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(maxCommentLength)
});

export const issueAssigneeSchema = z
  .object({
    userId: z.string(),
    email: z.string(),
    name: z.string().nullable()
  })
  .nullable();

export const issueListItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  culprit: z.string().nullable(),
  level: issueLevelSchema,
  status: issueStatusSchema,
  timesSeen: z.number().int(),
  firstSeen: z.string(),
  lastSeen: z.string(),
  assignee: issueAssigneeSchema
});

export const issueCommentSchema = z.object({
  id: z.string(),
  body: z.string(),
  author: z.object({
    userId: z.string(),
    email: z.string(),
    name: z.string().nullable()
  }),
  createdAt: z.string()
});

export const listCommentsResponseSchema = z.object({
  comments: z.array(issueCommentSchema)
});

export const commentResponseSchema = z.object({
  comment: issueCommentSchema
});

export const eventSummarySchema = z.object({
  id: z.string(),
  message: z.string().nullable(),
  exceptionType: z.string().nullable(),
  exceptionValue: z.string().nullable(),
  level: issueLevelSchema,
  environment: z.string().nullable(),
  release: z.string().nullable(),
  timestamp: z.string(),
  receivedAt: z.string()
});

export const eventDetailSchema = eventSummarySchema.extend({
  stacktrace: z.unknown().nullable(),
  breadcrumbs: z.unknown().nullable(),
  tags: z.unknown().nullable(),
  userContext: z.unknown().nullable(),
  contexts: z.unknown().nullable(),
  sdkName: z.string().nullable(),
  sdkVersion: z.string().nullable(),
  requestUrl: z.string().nullable(),
  userAgent: z.string().nullable(),
  hasSnapshot: z.boolean(),
  hasReplay: z.boolean()
});

export const listIssuesResponseSchema = z.object({
  issues: z.array(issueListItemSchema),
  nextCursor: z.string().nullable()
});

export const issueFacetsResponseSchema = z.object({
  releases: z.array(z.string()),
  environments: z.array(z.string())
});

export const issueDetailResponseSchema = z.object({
  issue: issueListItemSchema.extend({
    latestEvent: eventSummarySchema.nullable()
  })
});

export const issueEventsResponseSchema = z.object({
  events: z.array(eventDetailSchema),
  nextCursor: z.string().nullable()
});

export const eventSnapshotResponseSchema = z.object({
  snapshot: z
    .object({
      data: z.unknown(),
      href: z.string().nullable(),
      width: z.number().int().nullable(),
      height: z.number().int().nullable()
    })
    .nullable()
});

export const issueStatsResponseSchema = z.object({
  buckets: z.array(
    z.object({
      bucket: z.string(),
      count: z.number().int()
    })
  )
});

export const updateIssueResponseSchema = z.object({
  issue: issueListItemSchema
});

export type IssueFacetsResponse = z.infer<typeof issueFacetsResponseSchema>;

export const releaseIssuesResponseSchema = z.object({
  release: z.string(),
  newIssues: z.array(issueListItemSchema),
  // true when more than the 100-item cap matched (rest omitted).
  newIssuesTruncated: z.boolean(),
  regressedIssues: z.array(issueListItemSchema),
  regressedIssuesTruncated: z.boolean()
});

export type ListIssuesQuery = z.infer<typeof listIssuesQuerySchema>;
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;
export type IssueStatsQuery = z.infer<typeof issueStatsQuerySchema>;
export type UpdateIssueInput = z.infer<typeof updateIssueSchema>;
export type UpdateAssigneeInput = z.infer<typeof updateAssigneeSchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
