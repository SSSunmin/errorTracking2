import { z } from "zod/v4";

export const registerSchema = z.object({
  email: z.email().toLowerCase(),
  password: z.string().min(8),
  name: z.string().trim().min(1).max(120).optional()
});

export const loginSchema = z.object({
  email: z.email().toLowerCase(),
  password: z.string().min(1)
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(120)
});

export const userResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  createdAt: z.string()
});

export const tokenResponseSchema = z.object({
  accessToken: z.string(),
  user: userResponseSchema
});

export const okResponseSchema = z.object({
  ok: z.boolean()
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
