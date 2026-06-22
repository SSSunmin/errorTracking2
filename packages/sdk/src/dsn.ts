export interface DsnComponents {
  /** Full ingest endpoint, e.g. http://host/api/<projectId>/store */
  ingestUrl: string;
  /** Full session-replay upload endpoint, e.g. http://host/api/<projectId>/replay */
  replayUrl: string;
  publicKey: string;
  projectId: string;
}

/**
 * Parse a Mini-Sentry DSN of the form
 *   <scheme>://<publicKey>@<host>[:port]/<projectId>
 * into the pieces the transport needs.
 */
export const parseDsn = (dsn: string): DsnComponents => {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    throw new Error("Invalid DSN: not a valid URL");
  }

  const publicKey = url.username;
  const projectId = url.pathname.replace(/^\/+/, "").replace(/\/+$/, "");

  if (!publicKey) {
    throw new Error("Invalid DSN: missing public key");
  }
  if (url.password) {
    // A DSN carries only a public key; a password likely means a real secret
    // was pasted by mistake — refuse rather than silently transmit it.
    throw new Error("Invalid DSN: unexpected password component");
  }
  if (!projectId) {
    throw new Error("Invalid DSN: missing project id");
  }

  const apiBase = `${url.protocol}//${url.host}/api/${projectId}`;

  return {
    publicKey,
    projectId,
    ingestUrl: `${apiBase}/store`,
    replayUrl: `${apiBase}/replay`
  };
};
