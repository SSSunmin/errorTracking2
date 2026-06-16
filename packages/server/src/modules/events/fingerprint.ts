import { createHash } from "node:crypto";

import type { EventPayload, StackFrame } from "./schemas.js";

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

export const getTopFrame = (payload: EventPayload): StackFrame | undefined => {
  const frames = payload.exception?.stacktrace?.frames ?? [];
  return frames.find((frame) => frame.in_app) ?? frames[0];
};

const frameSignature = (frame: StackFrame | undefined): string =>
  frame ? `${frame.function ?? ""}|${frame.filename ?? ""}` : "";

export const buildFingerprint = (payload: EventPayload): string => {
  const exceptionType = payload.exception?.type;
  const exceptionValue = payload.exception?.value;

  if (payload.exception) {
    return sha256(`${exceptionType ?? ""}|${frameSignature(getTopFrame(payload))}`);
  }

  if (payload.message) {
    return sha256(`message|${payload.message}`);
  }

  return sha256(`${payload.level}|${payload.message ?? exceptionValue ?? "unknown"}`);
};

export const buildTitle = (payload: EventPayload): string => {
  const rawTitle = payload.exception
    ? `${payload.exception.type ?? "Error"}: ${payload.exception.value ?? "Unknown error"}`
    : (payload.message ?? "Unknown event");

  return rawTitle.slice(0, 250);
};

export const buildCulprit = (payload: EventPayload): string | null => {
  const frame = getTopFrame(payload);
  if (!frame) {
    return null;
  }

  const functionName = frame.function ?? "<anonymous>";
  const filename = frame.filename ?? "<unknown>";

  return `${functionName} (${filename})`;
};
