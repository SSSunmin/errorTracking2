import { z } from "zod/v4";

// release is a URL path segment and a lookup key; restrict to safe version-ish
// characters so it can't carry path separators or other surprising input.
const releaseSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9._\-+:@]+$/u);

export const sourceMapParamsSchema = z.object({
  id: z.string().min(1),
  release: releaseSchema
});

// Only the basename is ultimately used for matching, but reject path-traversal
// shapes up front as defense in depth.
export const sourceMapUploadQuerySchema = z.object({
  filename: z
    .string()
    .min(1)
    .max(512)
    .regex(/^[A-Za-z0-9._\-/]+$/u)
    .refine((value) => !value.includes(".."), "filename must not contain '..'")
});

const sourceMapSummarySchema = z.object({
  filename: z.string(),
  release: z.string(),
  sizeBytes: z.number().int().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const sourceMapUploadResponseSchema = sourceMapSummarySchema;

export const listSourceMapsResponseSchema = z.object({
  sourceMaps: z.array(sourceMapSummarySchema)
});
