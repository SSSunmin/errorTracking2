import { z } from "zod/v4";

const cuidLikeSchema = z.string().min(1);

export const projectParamsSchema = z.object({
  id: cuidLikeSchema
});

export const projectKeyParamsSchema = z.object({
  id: cuidLikeSchema,
  keyId: cuidLikeSchema
});

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(80).optional(),
  platform: z.string().trim().min(1).max(80).optional()
});

export const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  platform: z.string().trim().min(1).max(80).optional()
});

export const createProjectKeySchema = z.object({
  label: z.string().trim().min(1).max(120).optional()
});

export const updateProjectKeySchema = z.object({
  isActive: z.boolean()
});

export const memberParamsSchema = z.object({
  id: cuidLikeSchema,
  userId: cuidLikeSchema
});

const projectRoleSchema = z.enum(["owner", "member"]);

export const addMemberSchema = z.object({
  email: z.email().trim().toLowerCase(),
  role: projectRoleSchema.optional()
});

export const updateMemberSchema = z.object({
  role: projectRoleSchema
});

export const projectMemberSchema = z.object({
  userId: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  role: projectRoleSchema,
  createdAt: z.string()
});

export const listMembersResponseSchema = z.object({
  members: z.array(projectMemberSchema)
});

export const memberResponseSchema = z.object({
  member: projectMemberSchema
});

export const projectStatsQuerySchema = z.object({
  window: z.enum(["24h", "7d"]).default("24h")
});

export const projectStatsResponseSchema = z.object({
  buckets: z.array(
    z.object({
      bucket: z.string(),
      count: z.number().int(),
      // Distinct affected users in this bucket (userContext->>'id').
      users: z.number().int()
    })
  ),
  totalEvents: z.number().int(),
  // Distinct users affected within the window, counted by userContext->>'id'
  // (the SDK's user.id). Events without a user.id are excluded.
  affectedUsers: z.number().int()
});

export const projectEnvironmentStatsResponseSchema = z.object({
  // One row per distinct environment over the window, busiest first. The null
  // row aggregates events the SDK sent without an environment tag.
  environments: z.array(
    z.object({
      environment: z.string().nullable(),
      events: z.number().int(),
      // Distinct issues touched in this environment over the window.
      issues: z.number().int(),
      // Distinct affected users (id → email → username fallback key).
      affectedUsers: z.number().int()
    })
  )
});

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  platform: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const projectListItemSchema = projectSchema.extend({
  keyCount: z.number().int().nonnegative()
});

export const projectKeySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  publicKey: z.string(),
  label: z.string().nullable(),
  isActive: z.boolean(),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string(),
  dsn: z.string()
});

export const listProjectsResponseSchema = z.object({
  projects: z.array(projectListItemSchema)
});

export const projectResponseSchema = z.object({
  project: projectSchema
});

export const createProjectResponseSchema = z.object({
  project: projectSchema,
  key: projectKeySchema,
  dsn: z.string()
});

export const listProjectKeysResponseSchema = z.object({
  keys: z.array(projectKeySchema)
});

export const projectKeyResponseSchema = z.object({
  key: projectKeySchema,
  dsn: z.string()
});

export type ProjectStatsQuery = z.infer<typeof projectStatsQuerySchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type CreateProjectKeyInput = z.infer<typeof createProjectKeySchema>;
export type UpdateProjectKeyInput = z.infer<typeof updateProjectKeySchema>;
export type AddMemberInput = z.infer<typeof addMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
