import {
  addBreadcrumb,
  captureException,
  captureMessage,
  close,
  getClient,
  init,
  setContext,
  setTag,
  setUser
} from "./index.js";
import { readInitOptionsFromScript } from "./loader-options.js";

const MiniSentry = {
  init,
  getClient,
  captureException,
  captureMessage,
  setUser,
  setTag,
  setContext,
  addBreadcrumb,
  close
};

declare global {
  interface Window {
    MiniSentry?: typeof MiniSentry;
  }
}

const currentScript = (): HTMLScriptElement | null => {
  if (typeof document === "undefined") {
    return null;
  }

  const script = document.currentScript;
  if (script === null || !(script instanceof HTMLScriptElement)) {
    return null;
  }

  return script;
};

const autoInit = (): void => {
  const script = currentScript();
  if (script === null) {
    return;
  }

  const options = readInitOptionsFromScript(script);
  if (options !== null) {
    init(options);
  }
};

if (typeof window !== "undefined") {
  window.MiniSentry = MiniSentry;
  autoInit();
}

export {
  addBreadcrumb,
  captureException,
  captureMessage,
  close,
  getClient,
  init,
  setContext,
  setTag,
  setUser
};
