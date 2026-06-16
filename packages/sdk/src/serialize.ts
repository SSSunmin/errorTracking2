const MAX_DEPTH = 6; // stay under the server's depth limit (8)
const MAX_STRING = 1_024;
const MAX_KEYS = 50;
const MAX_ARRAY = 50;

/**
 * Defensively normalize arbitrary host-supplied data so it (a) cannot contain
 * circular references, (b) respects the ingest server's depth/size limits, and
 * (c) never lets a hostile getter/toJSON throw into our hot path.
 */
export const sanitize = (value: unknown, depth = 0): unknown => {
  if (value === null) {
    return null;
  }

  const type = typeof value;
  if (type === "string") {
    return (value as string).slice(0, MAX_STRING);
  }
  if (type === "number" || type === "boolean") {
    return value;
  }
  if (type === "bigint") {
    return (value as bigint).toString();
  }
  if (type === "function" || type === "symbol" || type === "undefined") {
    return undefined;
  }

  if (depth >= MAX_DEPTH) {
    return "[Truncated]";
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((item) => sanitize(item, depth + 1));
  }

  const out: Record<string, unknown> = {};
  let count = 0;
  try {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (count >= MAX_KEYS) {
        break;
      }
      const sanitized = sanitize(item, depth + 1);
      if (sanitized !== undefined) {
        out[key.slice(0, 200)] = sanitized;
        count += 1;
      }
    }
  } catch {
    return "[Unserializable]";
  }
  return out;
};

export const sanitizeRecord = (
  value: Record<string, unknown>
): Record<string, unknown> => sanitize(value) as Record<string, unknown>;

/** JSON.stringify that never throws (e.g. on residual circular refs). */
export const safeStringify = (value: unknown): string | null => {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
};

export const truncate = (value: string, max = MAX_STRING): string =>
  value.length > max ? value.slice(0, max) : value;
