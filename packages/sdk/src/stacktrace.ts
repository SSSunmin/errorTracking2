import type { StackFrame } from "./types.js";

const MAX_FRAMES = 50;

const parseLocation = (
  location: string
): Pick<StackFrame, "filename" | "lineno" | "colno"> | null => {
  // location looks like "https://host/app.js:42:13" (filename may contain colons)
  const match = /^(.*):(\d+):(\d+)$/.exec(location);
  const filename = match?.[1];
  const lineno = match?.[2];
  const colno = match?.[3];
  if (filename === undefined || lineno === undefined || colno === undefined) {
    return null;
  }
  return {
    filename,
    lineno: Number(lineno),
    colno: Number(colno)
  };
};

const parseLine = (raw: string): StackFrame | null => {
  const line = raw.trim();
  if (!line.startsWith("at ")) {
    return null;
  }

  let rest = line.slice(3).trim();
  let fn: string | undefined;

  const parenStart = rest.indexOf(" (");
  if (parenStart !== -1 && rest.endsWith(")")) {
    fn = rest.slice(0, parenStart).trim();
    rest = rest.slice(parenStart + 2, -1);
  }

  const location = parseLocation(rest);
  if (!location) {
    return null;
  }

  const inApp =
    location.filename !== undefined && !location.filename.includes("node_modules");

  return {
    ...(fn ? { function: fn } : {}),
    ...location,
    in_app: inApp
  };
};

/**
 * Best-effort stack parsing. Targets V8/Chromium `Error.stack` formatting
 * (both `at fn (loc)` and `at loc`). Frames it can't parse are skipped.
 */
export const parseStack = (stack: string | undefined): StackFrame[] => {
  if (!stack) {
    return [];
  }

  const frames: StackFrame[] = [];
  for (const raw of stack.split("\n")) {
    const frame = parseLine(raw);
    if (frame) {
      frames.push(frame);
    }
    if (frames.length >= MAX_FRAMES) {
      break;
    }
  }

  return frames;
};
