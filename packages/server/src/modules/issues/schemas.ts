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

export const listIssuesQuerySchema = z
  .object({
    status: issueStatusSchema.optional(),
    query: z.string().min(1).optional(),
    sort: z.enum(["lastSeen", "firstSeen", "timesSeen"]).default("lastSeen"),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).optional(),
    page: z.coerce.number().int().min(1).default(1)
  })
  .refine((query) => query.cursor !== undefined || query.page * query.limit <= maxPaginationOffset, {
    message: "Pagination offset is too large",
    path: ["page"]
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

export const updateIssueSchema = z.object({
  status: issueStatusSchema
});

export const issueListItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  culprit: z.string().nullable(),
  level: issueLevelSchema,
  status: issueStatusSchema,
  timesSeen: z.number().int(),
  firstSeen: z.string(),
  lastSeen: z.string()
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

export type ListIssuesQuery = z.infer<typeof listIssuesQuerySchema>;
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;
export type IssueStatsQuery = z.infer<typeof issueStatsQuerySchema>;
export type UpdateIssueInput = z.infer<typeof updateIssueSchema>;
