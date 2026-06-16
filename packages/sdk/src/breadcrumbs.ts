import type { Breadcrumb } from "./types.js";

/** Fixed-size rolling buffer of breadcrumbs (oldest dropped first). */
export class BreadcrumbBuffer {
  private readonly items: Breadcrumb[] = [];

  public constructor(private readonly max: number) {}

  public add(breadcrumb: Breadcrumb): void {
    this.items.push(breadcrumb);
    if (this.items.length > this.max) {
      this.items.shift();
    }
  }

  public snapshot(): Breadcrumb[] {
    return [...this.items];
  }

  public clear(): void {
    this.items.length = 0;
  }
}

const nowIso = (): string => new Date().toISOString();

const describeTarget = (target: EventTarget | null): string => {
  if (!(target instanceof Element)) {
    return "unknown";
  }
  const tag = target.tagName.toLowerCase();
  const id = target.id ? `#${target.id}` : "";
  const cls =
    typeof target.className === "string" && target.className
      ? `.${target.className.trim().split(/\s+/).slice(0, 3).join(".")}`
      : "";
  return `${tag}${id}${cls}`.slice(0, 200);
};

/**
 * Instrument console, clicks and history navigation so the breadcrumb buffer
 * captures the trail leading up to an error. Returns a teardown function.
 * No-ops outside a browser environment.
 */
export const instrumentBreadcrumbs = (
  add: (breadcrumb: Breadcrumb) => void
): (() => void) => {
  const teardowns: (() => void)[] = [];
  // Guard against re-entrancy: an internal console call (or a third-party that
  // also wrapped console) must not recurse back into breadcrumb capture.
  let inConsoleHook = false;

  if (typeof console !== "undefined") {
    const levels = ["log", "info", "warn", "error"] as const;
    for (const level of levels) {
      const original = console[level] as unknown;
      if (typeof original !== "function") {
        continue;
      }
      const bound = (original as (...args: unknown[]) => void).bind(console);
      console[level] = (...args: unknown[]): void => {
        if (!inConsoleHook) {
          inConsoleHook = true;
          try {
            add({
              type: "debug",
              category: "console",
              level:
                level === "warn" ? "warning" : level === "log" ? "info" : level,
              message: args.map((arg) => String(arg)).join(" ").slice(0, 1_000),
              timestamp: nowIso()
            });
          } catch {
            /* never let breadcrumb capture break console */
          }
          inConsoleHook = false;
        }
        bound(...args);
      };
      teardowns.push(() => {
        console[level] = bound;
      });
    }
  }

  if (typeof document !== "undefined") {
    const onClick = (event: Event): void => {
      add({
        type: "default",
        category: "ui.click",
        message: describeTarget(event.target),
        timestamp: nowIso()
      });
    };
    document.addEventListener("click", onClick, { capture: true });
    teardowns.push(() => {
      document.removeEventListener("click", onClick, { capture: true });
    });
  }

  if (typeof window !== "undefined") {
    const addNavigation = (): void => {
      add({
        type: "navigation",
        category: "navigation",
        message: window.location.pathname,
        timestamp: nowIso()
      });
    };

    window.addEventListener("popstate", addNavigation);
    teardowns.push(() => {
      window.removeEventListener("popstate", addNavigation);
    });

    // SPA navigations don't fire popstate — wrap the history API too.
    // pushState and replaceState share the same signature.
    type HistoryFn = (...args: Parameters<History["pushState"]>) => void;
    const methods = ["pushState", "replaceState"] as const;
    for (const method of methods) {
      const original = history[method].bind(history) as HistoryFn;
      const wrapped: HistoryFn = (...args) => {
        addNavigation();
        original(...args);
      };
      history[method] = wrapped;
      teardowns.push(() => {
        history[method] = original;
      });
    }
  }

  return () => {
    for (const teardown of teardowns) {
      teardown();
    }
  };
};
