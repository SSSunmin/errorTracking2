export interface User {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
}

export interface AuthResponse {
  accessToken: string;
  user: User;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  platform: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectListItem extends Project {
  keyCount: number;
}

export interface ProjectKey {
  id: string;
  projectId: string;
  publicKey: string;
  label: string | null;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  dsn: string;
}

export interface CreateProjectResponse {
  project: Project;
  key: ProjectKey;
  dsn: string;
}

export type IssueLevel = "debug" | "info" | "warning" | "error" | "fatal";
export type IssueStatus = "unresolved" | "resolved" | "ignored";

export interface IssueAssignee {
  userId: string;
  email: string;
  name: string | null;
}

export interface IssueListItem {
  id: string;
  title: string;
  culprit: string | null;
  level: IssueLevel;
  status: IssueStatus;
  timesSeen: number;
  firstSeen: string;
  lastSeen: string;
  assignee: IssueAssignee | null;
}

export interface IssueComment {
  id: string;
  body: string;
  author: IssueAssignee;
  createdAt: string;
}

export interface EventSummary {
  id: string;
  message: string | null;
  exceptionType: string | null;
  exceptionValue: string | null;
  level: IssueLevel;
  environment: string | null;
  release: string | null;
  timestamp: string;
  receivedAt: string;
}

export interface EventDetail extends EventSummary {
  stacktrace: unknown;
  breadcrumbs: unknown;
  tags: unknown;
  userContext: unknown;
  contexts: unknown;
  sdkName: string | null;
  sdkVersion: string | null;
  requestUrl: string | null;
  userAgent: string | null;
  hasSnapshot: boolean;
  hasReplay: boolean;
}

export interface EventSnapshot {
  data: unknown;
  href: string | null;
  width: number | null;
  height: number | null;
}

/** A single rrweb event (rrweb's `eventWithTime`). Kept structural here so the
 *  API layer needn't depend on rrweb types; the player narrows it on use. */
export interface ReplayEvent {
  type: number;
  data: unknown;
  timestamp: number;
  [key: string]: unknown;
}

export interface IssueDetail extends IssueListItem {
  latestEvent: EventSummary | null;
}

export interface StatBucket {
  bucket: string;
  count: number;
}

export type AlertChannel = "email" | "slack";
export type AlertCondition = "new_issue" | "regression" | "event_threshold";

export interface AlertRule {
  id: string;
  projectId: string;
  name: string;
  channel: AlertChannel;
  target: string;
  condition: AlertCondition;
  threshold: number | null;
  windowMinutes: number | null;
  cooldownMinutes: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ProjectRole = "owner" | "member";

export interface ProjectMember {
  userId: string;
  email: string;
  name: string | null;
  role: ProjectRole;
  createdAt: string;
}

export class ApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let accessToken: string | null = null;
export const setAccessToken = (token: string | null): void => {
  accessToken = token;
};

interface RequestOptions {
  method?: string;
  body?: unknown;
  retry?: boolean;
}

interface ErrorBody {
  error?: { code?: string; message?: string };
}

const doRefresh = async (): Promise<boolean> => {
  try {
    const res = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "include"
    });
    if (!res.ok) {
      accessToken = null;
      return false;
    }
    const data = (await res.json()) as AuthResponse;
    accessToken = data.accessToken;
    return true;
  } catch {
    accessToken = null;
    return false;
  }
};

// Coalesce concurrent refreshes so N parallel 401s trigger a single rotation.
let refreshPromise: Promise<boolean> | null = null;
const refresh = (): Promise<boolean> => {
  refreshPromise ??= doRefresh().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
};

const request = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const res = await fetch(path, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    credentials: "include"
  });

  if (
    res.status === 401 &&
    options.retry !== false &&
    !path.startsWith("/api/auth/")
  ) {
    if (await refresh()) {
      return request<T>(path, { ...options, retry: false });
    }
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ErrorBody | null;
    throw new ApiError(
      res.status,
      body?.error?.code ?? "ERROR",
      body?.error?.message ?? res.statusText
    );
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
};

export const api = {
  restoreSession: async (): Promise<User | null> => {
    if (!(await refresh())) {
      return null;
    }
    return request<User>("/api/auth/me", { retry: false });
  },
  login: (email: string, password: string): Promise<AuthResponse> =>
    request("/api/auth/login", { method: "POST", body: { email, password }, retry: false }),
  register: (email: string, password: string, name?: string): Promise<AuthResponse> =>
    request("/api/auth/register", {
      method: "POST",
      body: name ? { email, password, name } : { email, password },
      retry: false
    }),
  logout: (): Promise<{ ok: boolean }> =>
    request("/api/auth/logout", { method: "POST", retry: false }),
  updateProfile: (name: string): Promise<User> =>
    request("/api/auth/me", { method: "PATCH", body: { name } }),
  changePassword: (
    currentPassword: string,
    newPassword: string
  ): Promise<AuthResponse> =>
    request("/api/auth/me/password", {
      method: "PATCH",
      body: { currentPassword, newPassword }
    }),

  listProjects: (): Promise<{ projects: ProjectListItem[] }> =>
    request("/api/projects"),
  createProject: (name: string): Promise<CreateProjectResponse> =>
    request("/api/projects", { method: "POST", body: { name } }),
  getProject: (id: string): Promise<{ project: Project }> =>
    request(`/api/projects/${id}`),
  deleteProject: (id: string): Promise<void> =>
    request(`/api/projects/${id}`, { method: "DELETE" }),
  listKeys: (projectId: string): Promise<{ keys: ProjectKey[] }> =>
    request(`/api/projects/${projectId}/keys`),

  listMembers: (projectId: string): Promise<{ members: ProjectMember[] }> =>
    request(`/api/projects/${projectId}/members`),
  addMember: (
    projectId: string,
    email: string,
    role?: ProjectRole
  ): Promise<{ member: ProjectMember }> =>
    request(`/api/projects/${projectId}/members`, {
      method: "POST",
      body: role ? { email, role } : { email }
    }),
  updateMemberRole: (
    projectId: string,
    userId: string,
    role: ProjectRole
  ): Promise<{ member: ProjectMember }> =>
    request(`/api/projects/${projectId}/members/${userId}`, {
      method: "PATCH",
      body: { role }
    }),
  removeMember: (projectId: string, userId: string): Promise<void> =>
    request(`/api/projects/${projectId}/members/${userId}`, {
      method: "DELETE"
    }),

  listIssues: (
    projectId: string,
    params: {
      status?: IssueStatus | undefined;
      level?: IssueLevel | undefined;
      release?: string | undefined;
      environment?: string | undefined;
      since?: string | undefined;
      until?: string | undefined;
      query?: string | undefined;
      sort?: string | undefined;
    }
  ): Promise<{ issues: IssueListItem[]; nextCursor: string | null }> => {
    const search = new URLSearchParams();
    if (params.status) search.set("status", params.status);
    if (params.level) search.set("level", params.level);
    if (params.release) search.set("release", params.release);
    if (params.environment) search.set("environment", params.environment);
    if (params.since) search.set("since", params.since);
    if (params.until) search.set("until", params.until);
    if (params.query) search.set("query", params.query);
    if (params.sort) search.set("sort", params.sort);
    const qs = search.toString();
    return request(`/api/projects/${projectId}/issues${qs ? `?${qs}` : ""}`);
  },
  listIssueFacets: (
    projectId: string
  ): Promise<{ releases: string[]; environments: string[] }> =>
    request(`/api/projects/${projectId}/issues/facets`),
  getIssue: (
    projectId: string,
    issueId: string
  ): Promise<{ issue: IssueDetail }> =>
    request(`/api/projects/${projectId}/issues/${issueId}`),
  listEvents: (
    projectId: string,
    issueId: string
  ): Promise<{ events: EventDetail[]; nextCursor: string | null }> =>
    request(`/api/projects/${projectId}/issues/${issueId}/events`),
  getStats: (
    projectId: string,
    issueId: string,
    window: "24h" | "7d"
  ): Promise<{ buckets: StatBucket[] }> =>
    request(`/api/projects/${projectId}/issues/${issueId}/stats?window=${window}`),
  getEventSnapshot: (
    projectId: string,
    issueId: string,
    eventId: string
  ): Promise<{ snapshot: EventSnapshot | null }> =>
    request(
      `/api/projects/${projectId}/issues/${issueId}/events/${eventId}/snapshot`
    ),
  // The replay endpoint returns gzip-encoded JSON (the events array); fetch
  // transparently decompresses, so request() yields the array directly. A 404
  // (no stored replay) maps to null rather than an error.
  getEventReplay: async (
    projectId: string,
    issueId: string,
    eventId: string
  ): Promise<ReplayEvent[] | null> => {
    try {
      return await request<ReplayEvent[]>(
        `/api/projects/${projectId}/issues/${issueId}/events/${eventId}/replay`
      );
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 204)) {
        return null;
      }
      throw error;
    }
  },
  setIssueStatus: (
    projectId: string,
    issueId: string,
    status: IssueStatus
  ): Promise<{ issue: IssueListItem }> =>
    request(`/api/projects/${projectId}/issues/${issueId}`, {
      method: "PATCH",
      body: { status }
    }),
  setAssignee: (
    projectId: string,
    issueId: string,
    assigneeId: string | null
  ): Promise<{ issue: IssueListItem }> =>
    request(`/api/projects/${projectId}/issues/${issueId}/assignee`, {
      method: "PATCH",
      body: { assigneeId }
    }),
  listComments: (
    projectId: string,
    issueId: string
  ): Promise<{ comments: IssueComment[] }> =>
    request(`/api/projects/${projectId}/issues/${issueId}/comments`),
  addComment: (
    projectId: string,
    issueId: string,
    body: string
  ): Promise<{ comment: IssueComment }> =>
    request(`/api/projects/${projectId}/issues/${issueId}/comments`, {
      method: "POST",
      body: { body }
    }),
  deleteComment: (
    projectId: string,
    issueId: string,
    commentId: string
  ): Promise<void> =>
    request(`/api/projects/${projectId}/issues/${issueId}/comments/${commentId}`, {
      method: "DELETE"
    }),

  listAlertRules: (projectId: string): Promise<{ alertRules: AlertRule[] }> =>
    request(`/api/projects/${projectId}/alert-rules`),
  createAlertRule: (
    projectId: string,
    input: {
      name: string;
      channel: AlertChannel;
      target: string;
      condition: AlertCondition;
      threshold?: number;
      windowMinutes?: number;
      cooldownMinutes?: number;
    }
  ): Promise<{ alertRule: AlertRule }> =>
    request(`/api/projects/${projectId}/alert-rules`, { method: "POST", body: input }),
  deleteAlertRule: (projectId: string, ruleId: string): Promise<void> =>
    request(`/api/projects/${projectId}/alert-rules/${ruleId}`, { method: "DELETE" })
};
