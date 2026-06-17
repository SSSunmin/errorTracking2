import type { InitOptions } from "./types.js";

interface ScriptConfigSource {
  readonly dataset: DOMStringMap;
  readonly src: string;
}

const cleanDataValue = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  if (trimmed === "") {
    return undefined;
  }

  return trimmed;
};

export const buildDsnFromScriptOrigin = (
  scriptSrc: string,
  publicKey: string,
  projectId: string
): string | null => {
  try {
    const origin = new URL(scriptSrc).origin;
    if (!origin.includes("://")) {
      return null;
    }

    return `${origin.replace("://", `://${publicKey}@`)}/${projectId}`;
  } catch {
    return null;
  }
};

export const readInitOptionsFromScript = (
  script: ScriptConfigSource
): InitOptions | null => {
  const explicitDsn = cleanDataValue(script.dataset.dsn);
  const key = cleanDataValue(script.dataset.key);
  const project = cleanDataValue(script.dataset.project);
  const dsn =
    explicitDsn ??
    (key !== undefined && project !== undefined
      ? buildDsnFromScriptOrigin(script.src, key, project)
      : null);

  if (dsn === null) {
    return null;
  }

  const environment = cleanDataValue(script.dataset.environment);
  const release = cleanDataValue(script.dataset.release);

  return {
    dsn,
    autoInstrument: script.dataset.autoInstrument !== "false",
    captureConsole: script.dataset.captureConsole === "true",
    ...(environment !== undefined ? { environment } : {}),
    ...(release !== undefined ? { release } : {})
  };
};
