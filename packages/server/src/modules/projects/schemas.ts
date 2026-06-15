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

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type CreateProjectKeyInput = z.infer<typeof createProjectKeySchema>;
export type UpdateProjectKeyInput = z.infer<typeof updateProjectKeySchema>;
