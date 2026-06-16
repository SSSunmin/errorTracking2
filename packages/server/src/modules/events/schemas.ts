import { z } from "zod/v4";

export const issueLevelSchema = z.enum([
  "debug",
  "info",
  "warning",
  "error",
  "fatal"
]);

const maxJsonDepth = 8;
const maxObjectKeys = 100;
const maxLongTextLength = 8_192;
const maxMediumTextLength = 1_024;
const maxShortTextLength = 256;
const maxUrlLength = 2_048;

const isBoundedJsonValue = (value: unknown, depth = 0): boolean => {
  if (depth > maxJsonDepth) {
    return false;
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.length <= maxObjectKeys && value.every((item) => isBoundedJsonValue(item, depth + 1));
  }

  if (typeof value === "object") {
    const entries = Object.entries(value);
    return (
      entries.length <= maxObjectKeys &&
      entries.every(
        ([key, item]) => key.length <= maxShortTextLength && isBoundedJsonValue(item, depth + 1)
      )
    );
  }

  return false;
};

const boundedJsonSchema = z
  .unknown()
  .refine((value) => isBoundedJsonValue(value), "JSON value exceeds depth or size limits");

const boundedJsonRecordSchema = z
  .record(z.string().max(maxShortTextLength), boundedJsonSchema)
  .refine((value) => Object.keys(value).length <= maxObjectKeys, "Too many object keys");

export const stackFrameSchema = z.object({
  function: z.string().max(maxMediumTextLength).optional(),
  filename: z.string().max(maxMediumTextLength).optional(),
  lineno: z.number().int().optional(),
  colno: z.number().int().optional(),
  in_app: z.boolean().optional()
});

export const eventPayloadSchema = z
  .object({
    eventId: z.uuid().optional(),
    timestamp: z.iso.datetime(),
    level: issueLevelSchema.default("error"),
    platform: z.string().max(maxShortTextLength).optional(),
    message: z.string().max(maxLongTextLength).optional(),
    exception: z
      .object({
        type: z.string().max(maxLongTextLength).optional(),
        value: z.string().max(maxLongTextLength).optional(),
        stacktrace: z
          .object({
            frames: z.array(stackFrameSchema).max(100).default([])
          })
          .optional()
      })
      .optional(),
    breadcrumbs: z.array(boundedJsonSchema).max(100).optional(),
    tags: boundedJsonRecordSchema.optional(),
    user: boundedJsonRecordSchema.optional(),
    contexts: boundedJsonRecordSchema.optional(),
    release: z.string().max(maxShortTextLength).optional(),
    environment: z.string().max(maxShortTextLength).optional(),
    sdk: z
      .object({
        name: z.string().max(maxShortTextLength).optional(),
        version: z.string().max(maxShortTextLength).optional()
      })
      .optional(),
    request: z
      .object({
        url: z.string().max(maxUrlLength).optional(),
        headers: boundedJsonRecordSchema.optional()
      })
      .optional(),
    serverName: z.string().max(maxShortTextLength).optional()
  })
  .superRefine((payload, context) => {
    if (!payload.message && !payload.exception) {
      context.addIssue({
        code: "custom",
        path: ["message"],
        message: "Event must include message or exception"
      });
    }

    const timestamp = new Date(payload.timestamp);
    const now = Date.now();
    const minTimestamp = now - 24 * 60 * 60 * 1_000;
    const maxTimestamp = now + 5 * 60 * 1_000;

    if (timestamp.getTime() < minTimestamp || timestamp.getTime() > maxTimestamp) {
      context.addIssue({
        code: "custom",
        path: ["timestamp"],
        message: "Timestamp is outside the accepted clock-skew window"
      });
    }
  });

export type IssueLevelInput = z.infer<typeof issueLevelSchema>;
export type EventPayload = z.infer<typeof eventPayloadSchema>;
export type StackFrame = z.infer<typeof stackFrameSchema>;
