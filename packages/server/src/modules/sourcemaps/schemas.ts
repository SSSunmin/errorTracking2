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

// The full relative path is stored and matched by suffix, but reject
// path-traversal shapes up front as defense in depth.
const artifactFilename = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9._\-/]+$/u)
  .refine((value) => !value.includes(".."), "filename must not contain '..'")
  // Reject all-slash inputs ("/", "//"): they canonicalize to an empty key,
  // which would store a row that can never be matched at symbolication time.
  .refine((value) => /[^/]/u.test(value), "filename must name an artifact");

export const sourceMapUploadQuerySchema = z.object({
  filename: artifactFilename
});

// Delete one artifact (filename given) or the whole release (filename omitted).
export const sourceMapDeleteQuerySchema = z.object({
  filename: artifactFilename.optional()
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

export const sourceMapDeleteResponseSchema = z.object({
  deleted: z.number().int()
});
