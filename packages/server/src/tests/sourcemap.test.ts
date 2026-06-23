/**
 * Integration tests for source-map upload + lazy stacktrace symbolication.
 *
 * Covers:
 *  POST /api/projects/:id/releases/:release/sourcemaps
 *   - no auth → 401
 *   - another user's project → 404
 *   - valid upload → 201 + summary, SourceMap row stored gzipped (round-trips)
 *   - re-upload same (release, filename) → upsert (one row, bytes updated)
 *   - upload invalidates cached Event.symbolicated for that release
 *
 *  GET /api/projects/:id/releases/:release/sourcemaps → lists uploaded maps
 *
 *  listIssueEvents lazy symbolication
 *   - event with a release + matching map → frames gain original* fields and the
 *     result is cached into Event.symbolicated
 *   - event without a matching map → raw stacktrace, symbolicated stays null
 *
 * DB setup follows replay.test.ts (real prisma + TEST_DATABASE_URL, TRUNCATE in
 * setup.ts beforeEach, buildApp helper).
 */

import { gunzipSync } from "node:zlib";

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { processEvent } from "../modules/events/process.js";
import { tokenResponseSchema } from "../modules/auth/schemas.js";
import { createProjectResponseSchema } from "../modules/projects/schemas.js";
import { issueEventsResponseSchema } from "../modules/issues/schemas.js";
import type { EventPayload } from "../modules/events/schemas.js";

let app: FastifyInstance;

beforeEach(async () => {
  app = buildApp({
    ingest: {
      enqueue: (data) => Promise.resolve(data.payload.eventId ?? "queued")
    }
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

// ── helpers ───────────────────────────────────────────────────────────────────

interface AuthSession {
  accessToken: string;
  userId: string;
}

const registerViaApi = async (email: string): Promise<AuthSession> => {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, password: "password123", name: "Test" }
  });
  expect(response.statusCode).toBe(201);
  const body = tokenResponseSchema.parse(response.json<unknown>());
  return { accessToken: body.accessToken, userId: body.user.id };
};

const createProjectViaApi = async (session: AuthSession): Promise<string> => {
  const response = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: { authorization: `Bearer ${session.accessToken}` },
    payload: { name: "SourceMap Project", platform: "javascript-browser" }
  });
  expect(response.statusCode).toBe(201);
  const body = createProjectResponseSchema.parse(response.json<unknown>());
  return body.project.id;
};

const uploadSourceMap = (
  projectId: string,
  release: string,
  filename: string,
  token: string,
  body: Buffer
) =>
  app.inject({
    method: "POST",
    url:
      `/api/projects/${projectId}/releases/${encodeURIComponent(release)}/sourcemaps` +
      `?filename=${encodeURIComponent(filename)}`,
    headers: {
      "content-type": "application/octet-stream",
      authorization: `Bearer ${token}`
    },
    payload: body
  });

// Real v3 source map: generated (1,0) → src/app.ts (1,0) with name handleClick.
const sourceMapJson = (): string =>
  JSON.stringify({
    version: 3,
    file: "app.js",
    sources: ["src/app.ts"],
    names: ["handleClick"],
    mappings: "AAAAA",
    sourcesContent: ["function handleClick() {\n  doThing();\n}\n"]
  });

const RELEASE = "1.0.0";

const eventWithStack = (): EventPayload => ({
  timestamp: new Date().toISOString(),
  level: "error",
  message: "boom",
  release: RELEASE,
  exception: {
    type: "TypeError",
    value: "x is not a function",
    stacktrace: {
      frames: [
        {
          function: "a",
          filename: "https://app.com/assets/app.js",
          lineno: 1,
          colno: 1,
          in_app: true
        }
      ]
    }
  }
});

interface OriginalFrame {
  originalFilename?: string;
  originalFunction?: string;
  originalLineno?: number;
}

const firstFrame = (stacktrace: unknown): OriginalFrame => {
  const frames = (stacktrace as { frames?: OriginalFrame[] }).frames ?? [];
  const frame = frames[0];
  if (!frame) throw new Error("expected a stack frame");
  return frame;
};

// ── upload route ────────────────────────────────────────────────────────────

describe("POST …/releases/:release/sourcemaps", () => {
  test("no auth → 401", async () => {
    const session = await registerViaApi("sm-noauth@example.com");
    const projectId = await createProjectViaApi(session);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/releases/${RELEASE}/sourcemaps?filename=app.js`,
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from(sourceMapJson())
    });

    expect(response.statusCode).toBe(401);
  });

  test("release with a path separator → 400", async () => {
    const session = await registerViaApi("sm-badrelease@example.com");
    const projectId = await createProjectViaApi(session);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/releases/${encodeURIComponent("a/b")}/sourcemaps?filename=app.js`,
      headers: {
        "content-type": "application/octet-stream",
        authorization: `Bearer ${session.accessToken}`
      },
      payload: Buffer.from("{}")
    });

    expect(response.statusCode).toBe(400);
  });

  test("filename containing '..' → 400", async () => {
    const session = await registerViaApi("sm-badfilename@example.com");
    const projectId = await createProjectViaApi(session);

    const response = await uploadSourceMap(
      projectId,
      RELEASE,
      "../../etc/passwd",
      session.accessToken,
      Buffer.from("{}")
    );

    expect(response.statusCode).toBe(400);
  });

  test("all-slash filename (canonicalizes to empty) → 400", async () => {
    const session = await registerViaApi("sm-slashname@example.com");
    const projectId = await createProjectViaApi(session);

    const response = await uploadSourceMap(
      projectId,
      RELEASE,
      "/",
      session.accessToken,
      Buffer.from("{}")
    );

    expect(response.statusCode).toBe(400);
  });

  test("another user's project → 404", async () => {
    const owner = await registerViaApi("sm-owner@example.com");
    const projectId = await createProjectViaApi(owner);
    const intruder = await registerViaApi("sm-intruder@example.com");

    const response = await uploadSourceMap(
      projectId,
      RELEASE,
      "app.js",
      intruder.accessToken,
      Buffer.from(sourceMapJson())
    );

    expect(response.statusCode).toBe(404);
  });

  test("valid upload → 201, stored gzipped and round-trips", async () => {
    const session = await registerViaApi("sm-upload@example.com");
    const projectId = await createProjectViaApi(session);
    const raw = sourceMapJson();

    const response = await uploadSourceMap(
      projectId,
      RELEASE,
      "app.js",
      session.accessToken,
      Buffer.from(raw)
    );

    expect(response.statusCode).toBe(201);
    const body = response.json<{ filename: string; release: string; sizeBytes: number }>();
    expect(body.filename).toBe("app.js");
    expect(body.release).toBe(RELEASE);

    const row = await prisma.sourceMap.findUnique({
      where: {
        projectId_release_filename: { projectId, release: RELEASE, filename: "app.js" }
      },
      select: { data: true, sizeBytes: true }
    });
    if (!row) throw new Error("expected SourceMap row");
    // Stored bytes are gzipped; decompressing recovers the original JSON.
    expect(gunzipSync(Buffer.from(row.data)).toString("utf8")).toBe(raw);
    expect(row.sizeBytes).toBe(Buffer.from(row.data).length);
  });

  test("re-upload same (release, filename) upserts a single row", async () => {
    const session = await registerViaApi("sm-upsert@example.com");
    const projectId = await createProjectViaApi(session);

    await uploadSourceMap(projectId, RELEASE, "app.js", session.accessToken, Buffer.from("{}"));
    const second = await uploadSourceMap(
      projectId,
      RELEASE,
      "app.js",
      session.accessToken,
      Buffer.from(sourceMapJson())
    );
    expect(second.statusCode).toBe(201);

    const rows = await prisma.sourceMap.findMany({
      where: { projectId, release: RELEASE, filename: "app.js" }
    });
    expect(rows.length).toBe(1);
    const row = rows[0];
    if (!row) throw new Error("expected SourceMap row");
    expect(gunzipSync(Buffer.from(row.data)).toString("utf8")).toBe(sourceMapJson());
  });

  test("upload invalidates cached Event.symbolicated for the release", async () => {
    const session = await registerViaApi("sm-invalidate@example.com");
    const projectId = await createProjectViaApi(session);

    const result = await processEvent(projectId, eventWithStack());
    // Pretend an earlier read cached a symbolicated stacktrace for this event.
    await prisma.event.update({
      where: { id: result.eventId },
      data: { symbolicated: { frames: [{ cached: true }] } }
    });

    await uploadSourceMap(
      projectId,
      RELEASE,
      "app.js",
      session.accessToken,
      Buffer.from(sourceMapJson())
    );

    const row = await prisma.event.findUnique({
      where: { id: result.eventId },
      select: { symbolicated: true }
    });
    expect(row?.symbolicated).toBeNull();
  });
});

describe("GET …/releases/:release/sourcemaps", () => {
  test("lists uploaded maps", async () => {
    const session = await registerViaApi("sm-list@example.com");
    const projectId = await createProjectViaApi(session);

    await uploadSourceMap(projectId, RELEASE, "app.js", session.accessToken, Buffer.from("{}"));
    await uploadSourceMap(projectId, RELEASE, "vendor.js", session.accessToken, Buffer.from("{}"));

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/releases/${RELEASE}/sourcemaps`,
      headers: { authorization: `Bearer ${session.accessToken}` }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ sourceMaps: { filename: string }[] }>();
    expect(body.sourceMaps.map((m) => m.filename).sort()).toEqual(["app.js", "vendor.js"]);
  });
});

// ── delete route ──────────────────────────────────────────────────────────────

const deleteSourceMap = (
  projectId: string,
  release: string,
  token: string,
  filename?: string
) =>
  app.inject({
    method: "DELETE",
    url:
      `/api/projects/${projectId}/releases/${encodeURIComponent(release)}/sourcemaps` +
      (filename === undefined ? "" : `?filename=${encodeURIComponent(filename)}`),
    headers: { authorization: `Bearer ${token}` }
  });

describe("DELETE …/releases/:release/sourcemaps", () => {
  test("no auth → 401", async () => {
    const session = await registerViaApi("sm-del-noauth@example.com");
    const projectId = await createProjectViaApi(session);

    const response = await app.inject({
      method: "DELETE",
      url: `/api/projects/${projectId}/releases/${RELEASE}/sourcemaps?filename=app.js`
    });

    expect(response.statusCode).toBe(401);
  });

  test("another user's project → 404", async () => {
    const owner = await registerViaApi("sm-del-owner@example.com");
    const projectId = await createProjectViaApi(owner);
    await uploadSourceMap(projectId, RELEASE, "app.js", owner.accessToken, Buffer.from("{}"));
    const intruder = await registerViaApi("sm-del-intruder@example.com");

    const response = await deleteSourceMap(projectId, RELEASE, intruder.accessToken, "app.js");

    expect(response.statusCode).toBe(404);
    // The map must still exist.
    const rows = await prisma.sourceMap.findMany({ where: { projectId, release: RELEASE } });
    expect(rows.length).toBe(1);
  });

  test("deletes a single artifact and invalidates the cache", async () => {
    const session = await registerViaApi("sm-del-one@example.com");
    const projectId = await createProjectViaApi(session);
    await uploadSourceMap(projectId, RELEASE, "app.js", session.accessToken, Buffer.from("{}"));
    await uploadSourceMap(projectId, RELEASE, "vendor.js", session.accessToken, Buffer.from("{}"));

    // Seed a cached symbolication to prove deletion invalidates it.
    const result = await processEvent(projectId, eventWithStack());
    await prisma.event.update({
      where: { id: result.eventId },
      data: { symbolicated: { frames: [{ cached: true }] } }
    });

    const response = await deleteSourceMap(projectId, RELEASE, session.accessToken, "app.js");

    expect(response.statusCode).toBe(200);
    expect(response.json<{ deleted: number }>().deleted).toBe(1);

    const remaining = await prisma.sourceMap.findMany({
      where: { projectId, release: RELEASE },
      select: { filename: true }
    });
    expect(remaining.map((m) => m.filename)).toEqual(["vendor.js"]);

    const row = await prisma.event.findUnique({
      where: { id: result.eventId },
      select: { symbolicated: true }
    });
    expect(row?.symbolicated).toBeNull();
  });

  test("deletes the whole release when no filename is given", async () => {
    const session = await registerViaApi("sm-del-all@example.com");
    const projectId = await createProjectViaApi(session);
    await uploadSourceMap(projectId, RELEASE, "app.js", session.accessToken, Buffer.from("{}"));
    await uploadSourceMap(projectId, RELEASE, "vendor.js", session.accessToken, Buffer.from("{}"));

    const response = await deleteSourceMap(projectId, RELEASE, session.accessToken);

    expect(response.statusCode).toBe(200);
    expect(response.json<{ deleted: number }>().deleted).toBe(2);
    const rows = await prisma.sourceMap.findMany({ where: { projectId, release: RELEASE } });
    expect(rows.length).toBe(0);
  });

  test("deleting a missing artifact → 200 deleted:0", async () => {
    const session = await registerViaApi("sm-del-missing@example.com");
    const projectId = await createProjectViaApi(session);

    const response = await deleteSourceMap(projectId, RELEASE, session.accessToken, "nope.js");

    expect(response.statusCode).toBe(200);
    expect(response.json<{ deleted: number }>().deleted).toBe(0);
  });
});

// ── lazy symbolication in the events list ─────────────────────────────────────

describe("listIssueEvents lazy symbolication", () => {
  test("event with a matching map gains original* fields and caches the result", async () => {
    const session = await registerViaApi("sm-symbolicate@example.com");
    const projectId = await createProjectViaApi(session);

    const result = await processEvent(projectId, eventWithStack());
    await uploadSourceMap(
      projectId,
      RELEASE,
      "app.js",
      session.accessToken,
      Buffer.from(sourceMapJson())
    );

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/issues/${result.issueId}/events`,
      headers: { authorization: `Bearer ${session.accessToken}` }
    });
    expect(response.statusCode).toBe(200);
    const body = issueEventsResponseSchema.parse(response.json<unknown>());

    const frame = firstFrame(body.events[0]?.stacktrace);
    expect(frame.originalFilename).toBe("src/app.ts");
    expect(frame.originalFunction).toBe("handleClick");
    expect(frame.originalLineno).toBe(1);

    // The read should have cached the symbolicated stacktrace.
    const row = await prisma.event.findUnique({
      where: { id: result.eventId },
      select: { symbolicated: true }
    });
    expect(row?.symbolicated).not.toBeNull();
    expect(firstFrame(row?.symbolicated).originalFilename).toBe("src/app.ts");
  });

  test("matches the right map when same-named artifacts live in different dirs", async () => {
    const session = await registerViaApi("sm-pathmatch@example.com");
    const projectId = await createProjectViaApi(session);

    // Event frame points at routes/index.js; utils/index.js must not win.
    const payload = eventWithStack();
    const frames = (
      payload.exception?.stacktrace as { frames: { filename: string }[] }
    ).frames;
    const target = frames[0];
    if (!target) throw new Error("expected a stack frame");
    target.filename = "https://app.com/assets/routes/index.js";
    const result = await processEvent(projectId, payload);

    const routesMap = JSON.stringify({
      version: 3,
      file: "index.js",
      sources: ["routes/index.ts"],
      names: ["handleClick"],
      mappings: "AAAAA",
      sourcesContent: ["function handleClick() {}\n"]
    });
    const utilsMap = JSON.stringify({
      version: 3,
      file: "index.js",
      sources: ["utils/index.ts"],
      names: ["other"],
      mappings: "AAAAA",
      sourcesContent: ["function other() {}\n"]
    });
    await uploadSourceMap(projectId, RELEASE, "routes/index.js", session.accessToken, Buffer.from(routesMap));
    await uploadSourceMap(projectId, RELEASE, "utils/index.js", session.accessToken, Buffer.from(utilsMap));

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/issues/${result.issueId}/events`,
      headers: { authorization: `Bearer ${session.accessToken}` }
    });
    expect(response.statusCode).toBe(200);
    const body = issueEventsResponseSchema.parse(response.json<unknown>());
    expect(firstFrame(body.events[0]?.stacktrace).originalFilename).toBe("routes/index.ts");
  });

  test("event without a matching map returns raw stacktrace and caches nothing", async () => {
    const session = await registerViaApi("sm-nomap@example.com");
    const projectId = await createProjectViaApi(session);

    const result = await processEvent(projectId, eventWithStack());
    // No source map uploaded for this release.

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/issues/${result.issueId}/events`,
      headers: { authorization: `Bearer ${session.accessToken}` }
    });
    expect(response.statusCode).toBe(200);
    const body = issueEventsResponseSchema.parse(response.json<unknown>());

    const frame = firstFrame(body.events[0]?.stacktrace);
    expect(frame.originalFilename).toBeUndefined();

    const row = await prisma.event.findUnique({
      where: { id: result.eventId },
      select: { symbolicated: true }
    });
    expect(row?.symbolicated).toBeNull();
  });
});
