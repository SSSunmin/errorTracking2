import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api, ApiError, setAccessToken } from "./api";

// The API client's request() layer carries the auth/resilience logic: it attaches
// the bearer token, and on a 401 it refreshes the session once and replays the
// request — but never on /api/auth/* paths (to avoid a refresh→401→refresh loop)
// and never when retry is disabled. doRefresh() is coalesced so N parallel 401s
// rotate the session a single time. None of this needs a DOM, only a mocked
// fetch, so it runs in the no-DB "ui" project.

// Minimal Response stand-ins — request() only reads ok/status/statusText/json().
const jsonRes = (status: number, body: unknown, statusText = ""): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: () => Promise.resolve(body)
  }) as unknown as Response;

// A non-OK response whose body is not valid JSON (request() must fall back to
// statusText / "ERROR" instead of throwing the parse error).
const badJsonRes = (status: number, statusText: string): Response =>
  ({
    ok: false,
    status,
    statusText,
    json: () => Promise.reject(new Error("not json"))
  }) as unknown as Response;

describe("api request()", () => {
  const fetchMock =
    vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    setAccessToken(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const headersOf = (callIndex: number): Record<string, string> => {
    const call = fetchMock.mock.calls.at(callIndex);
    if (!call) {
      throw new Error(`fetch call ${String(callIndex)} not found`);
    }
    return (call[1]?.headers ?? {}) as Record<string, string>;
  };

  test("attaches the Authorization header when an access token is set", async () => {
    setAccessToken("tok-1");
    fetchMock.mockResolvedValueOnce(jsonRes(200, { projects: [] }));

    await api.listProjects();

    expect(headersOf(0).authorization).toBe("Bearer tok-1");
  });

  test("omits Authorization and content-type when no token and no body", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(200, { projects: [] }));

    await api.listProjects();

    const headers = headersOf(0);
    expect(headers.authorization).toBeUndefined();
    expect(headers["content-type"]).toBeUndefined();
  });

  test("sets content-type only when a request carries a body", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(200, { project: {}, key: {}, dsn: "" }));

    await api.createProject("X");

    expect(headersOf(0)["content-type"]).toBe("application/json");
  });

  test("on 401 it refreshes the session and replays the request once", async () => {
    setAccessToken("stale");
    fetchMock
      .mockResolvedValueOnce(jsonRes(401, { error: { code: "UNAUTHORIZED" } }))
      .mockResolvedValueOnce(jsonRes(200, { accessToken: "fresh", user: {} }))
      .mockResolvedValueOnce(jsonRes(200, { projects: [{ id: "p1" }] }));

    const result = await api.listProjects();

    expect(result.projects).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/auth/refresh");
    // The replayed request must carry the freshly-rotated token, not the stale one.
    expect(headersOf(2).authorization).toBe("Bearer fresh");
  });

  test("throws the original error (and does not retry) when refresh fails", async () => {
    setAccessToken("stale");
    fetchMock
      .mockResolvedValueOnce(
        jsonRes(401, { error: { code: "UNAUTHORIZED", message: "expired" } })
      )
      .mockResolvedValueOnce(jsonRes(401, {})); // refresh itself is rejected

    const err = await api.listProjects().catch((error: unknown) => error);

    expect(err).toBeInstanceOf(ApiError);
    // The original 401 body is re-parsed into the surfaced error (not swallowed).
    expect(err).toMatchObject({ status: 401, code: "UNAUTHORIZED", message: "expired" });
    expect(fetchMock).toHaveBeenCalledTimes(2); // original + refresh, no replay
  });

  test("never refreshes on /api/auth/* paths even when retry is allowed", async () => {
    // updateProfile hits /api/auth/me with retry enabled; the path guard must
    // still suppress the refresh-and-retry to avoid a refresh loop.
    fetchMock.mockResolvedValueOnce(jsonRes(401, { error: { code: "UNAUTHORIZED" } }));

    await expect(api.updateProfile("New Name")).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("coalesces concurrent refreshes into a single rotation", async () => {
    setAccessToken("stale");
    let projectsHits = 0;
    let refreshHits = 0;
    fetchMock.mockImplementation((url) => {
      if (url === "/api/auth/refresh") {
        refreshHits += 1;
        return Promise.resolve(jsonRes(200, { accessToken: "fresh", user: {} }));
      }
      projectsHits += 1;
      // The two initial concurrent requests 401; their replays succeed.
      return Promise.resolve(
        projectsHits <= 2 ? jsonRes(401, {}) : jsonRes(200, { projects: [] })
      );
    });

    await Promise.all([api.listProjects(), api.listProjects()]);

    expect(refreshHits).toBe(1);
    expect(projectsHits).toBe(4);
    // Bound total fetches (2 initial + 1 refresh + 2 replays) so a regression that
    // re-refreshes or loops can't slip through the per-URL counters above.
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  test("maps an error body to ApiError, falling back to statusText when unparseable", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes(403, { error: { code: "FORBIDDEN", message: "no access" } })
    );
    const withBody = await api.listProjects().catch((error: unknown) => error);
    expect(withBody).toMatchObject({ status: 403, code: "FORBIDDEN", message: "no access" });

    fetchMock.mockResolvedValueOnce(badJsonRes(500, "Server Error"));
    const withoutBody = await api.listProjects().catch((error: unknown) => error);
    expect(withoutBody).toMatchObject({ status: 500, code: "ERROR", message: "Server Error" });
  });

  test("returns undefined for a 204 No Content response without reading the body", async () => {
    // json() rejects: request() must short-circuit on 204 before ever calling it.
    const noContent = {
      ok: true,
      status: 204,
      statusText: "",
      json: () => Promise.reject(new Error("204 has no body"))
    } as unknown as Response;
    fetchMock.mockResolvedValueOnce(noContent);

    await expect(api.deleteProject("p1")).resolves.toBeUndefined();
  });

  test("getEventReplay maps a 404 to null but rethrows other errors", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(404, { error: { code: "NOT_FOUND" } }));
    await expect(api.getEventReplay("p", "i", "e")).resolves.toBeNull();

    fetchMock.mockResolvedValueOnce(jsonRes(500, { error: { code: "BOOM" } }));
    await expect(api.getEventReplay("p", "i", "e")).rejects.toBeInstanceOf(ApiError);
  });
});
