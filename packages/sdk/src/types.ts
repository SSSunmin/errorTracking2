export type SeverityLevel = "debug" | "info" | "warning" | "error" | "fatal";

export interface StackFrame {
  function?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
}

export interface Breadcrumb {
  type: string;
  category: string;
  message?: string;
  level?: SeverityLevel;
  data?: Record<string, unknown>;
  timestamp: string;
}

export interface EventException {
  type?: string;
  value?: string;
  stacktrace?: { frames: StackFrame[] };
}

export interface SentryEvent {
  eventId: string;
  timestamp: string;
  level: SeverityLevel;
  platform: string;
  sdk: { name: string; version: string };
  message?: string;
  exception?: EventException;
  breadcrumbs?: Breadcrumb[];
  tags?: Record<string, string>;
  user?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  release?: string;
  environment?: string;
  request?: { url?: string };
}

export interface InitOptions {
  dsn: string;
  release?: string;
  environment?: string;
  /** Max breadcrumbs kept in the rolling buffer (default 50). */
  maxBreadcrumbs?: number;
  /** Auto-install global error/rejection handlers + breadcrumb instrumentation (default true). */
  autoInstrument?: boolean;
  /** Capture console.* calls as breadcrumbs when enabled (default false). */
  captureConsole?: boolean;
}
