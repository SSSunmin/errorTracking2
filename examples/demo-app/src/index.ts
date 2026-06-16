import * as MiniSentry from "@mini-sentry/sdk";

const byId = (id: string): HTMLElement | null => document.getElementById(id);

const log = (message: string): void => {
  const out = byId("log");
  if (out) {
    out.textContent = `${new Date().toISOString()}  ${message}\n${out.textContent}`;
  }
};

const initFromInput = (): void => {
  const input = byId("dsn");
  const dsn = input instanceof HTMLInputElement ? input.value.trim() : "";
  if (!dsn) {
    log("Enter a DSN first.");
    return;
  }
  const client = MiniSentry.init({ dsn, release: "demo-1.0.0", environment: "demo" });
  if (!client) {
    log("Init failed — check the DSN format.");
    return;
  }
  MiniSentry.setTag("surface", "demo-app");
  log(`SDK initialised for ${dsn}`);
};

const throwUncaught = (): void => {
  // Intentionally uncaught — exercises the SDK's global error handler.
  throw new TypeError("Demo uncaught error from button");
};

const captureHandled = (): void => {
  try {
    JSON.parse("{ definitely not json");
  } catch (error) {
    const id = MiniSentry.captureException(error);
    log(`Captured handled exception: ${String(id)}`);
  }
};

const sendMessage = (): void => {
  const id = MiniSentry.captureMessage("Hello from the demo app", "info");
  log(`Captured message: ${String(id)}`);
};

document.addEventListener("DOMContentLoaded", () => {
  byId("init")?.addEventListener("click", initFromInput);
  byId("throw")?.addEventListener("click", throwUncaught);
  byId("capture")?.addEventListener("click", captureHandled);
  byId("message")?.addEventListener("click", sendMessage);
});
