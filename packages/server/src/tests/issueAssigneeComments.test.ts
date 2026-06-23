import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod/v4";

import { buildApp } from "../app.js";
import { processEvent } from "../modules/events/process.js";
import type { EventPayload } from "../modules/events/schemas.js";
import { refreshCookieName } from "../modules/auth/routes.js";
import { tokenResponseSchema } from "../modules/auth/schemas.js";
import {
  commentResponseSchema,
  issueDetailResponseSchema,
  listCommentsResponseSchema,
  listIssuesResponseSchema,
  updateIssueResponseSchema
} from "../modules/issues/schemas.js";
import { createProjectResponseSchema } from "../modules/projects/schemas.js";

interface CookieLike {
  name: string;
  value: string;
}

interface AuthSession {
  accessToken: string;
  userId: string;
}

let app: FastifyInstance;

const getRefreshCookie = (response: { cookies: CookieLike[] }): string => {
  const cookie = response.cookies.find((c) => c.name === refreshCookieName);
  if (!cookie) throw new Error("Expected refresh cookie to be set");
  return `${cookie.name}=${cookie.value}`;
};

const register = async (email: string): Promise<AuthSession> => {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, password: "password123", name: "Test User" }
  });
  expect(response.statusCode).toBe(201);
  getRefreshCookie(response);
  const body = tokenResponseSchema.parse(response.json<unknown>());
  return { accessToken: body.accessToken, userId: body.user.id };
};

const authHeaders = (session: AuthSession): { authorization: string } => ({
  authorization: `Bearer ${session.accessToken}`
});

const createProject = async (
  session: AuthSession,
  name: string
): Promise<z.infer<typeof createProjectResponseSchema>> => {
  const response = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: authHeaders(session),
    payload: { name, platform: "javascript-browser" }
  });
  expect(response.statusCode).toBe(201);
  return createProjectResponseSchema.parse(response.json<unknown>());
};

const addMember = async (
  owner: AuthSession,
  projectId: string,
  email: string,
  role?: "owner" | "member"
) =>
  app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/members`,
    headers: authHeaders(owner),
    payload: role ? { email, role } : { email }
  });

const makePayload = (): EventPayload => ({
  timestamp: new Date().toISOString(),
  level: "error",
  message: `Assignee/comment test ${Math.random().toString(36).slice(2)}`
});

beforeEach(async () => {
  app = buildApp({
    ingest: {
      enqueue: (data) => Promise.resolve(data.payload.eventId ?? "queued-event")
    }
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// Assignee
// ---------------------------------------------------------------------------

describe("issue assignee", () => {
  test("assign a member, surface in detail/list, then unassign", async () => {
    const owner = await register("asg-owner@example.com");
    const teammate = await register("asg-teammate@example.com");
    const { project } = await createProject(owner, "Assignee Project");
    await addMember(owner, project.id, "asg-teammate@example.com");
    const { issueId } = await processEvent(project.id, makePayload());

    // Assign the teammate.
    const assign = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/issues/${issueId}/assignee`,
      headers: authHeaders(owner),
      payload: { assigneeId: teammate.userId }
    });
    expect(assign.statusCode).toBe(200);
    const assigned = updateIssueResponseSchema.parse(assign.json<unknown>());
    expect(assigned.issue.assignee?.userId).toBe(teammate.userId);
    expect(assigned.issue.assignee?.email).toBe("asg-teammate@example.com");

    // getIssue exposes the assignee.
    const detail = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/issues/${issueId}`,
      headers: authHeaders(owner)
    });
    expect(detail.statusCode).toBe(200);
    const detailBody = issueDetailResponseSchema.parse(detail.json<unknown>());
    expect(detailBody.issue.assignee?.userId).toBe(teammate.userId);

    // listIssues exposes the assignee.
    const list = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/issues`,
      headers: authHeaders(owner)
    });
    expect(list.statusCode).toBe(200);
    const listBody = listIssuesResponseSchema.parse(list.json<unknown>());
    expect(listBody.issues[0]?.assignee?.userId).toBe(teammate.userId);

    // Unassign with null.
    const unassign = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/issues/${issueId}/assignee`,
      headers: authHeaders(owner),
      payload: { assigneeId: null }
    });
    expect(unassign.statusCode).toBe(200);
    expect(
      updateIssueResponseSchema.parse(unassign.json<unknown>()).issue.assignee
    ).toBeNull();
  });

  test("assigning a non-member returns 400", async () => {
    const owner = await register("asg-nonmember-owner@example.com");
    const stranger = await register("asg-nonmember-stranger@example.com");
    const { project } = await createProject(owner, "Assignee Nonmember");
    const { issueId } = await processEvent(project.id, makePayload());

    const response = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/issues/${issueId}/assignee`,
      headers: authHeaders(owner),
      payload: { assigneeId: stranger.userId }
    });
    expect(response.statusCode).toBe(400);
  });

  test("a non-member calling assignee gets 404", async () => {
    const owner = await register("asg-denied-owner@example.com");
    const stranger = await register("asg-denied-stranger@example.com");
    const { project } = await createProject(owner, "Assignee Denied");
    const { issueId } = await processEvent(project.id, makePayload());

    const response = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/issues/${issueId}/assignee`,
      headers: authHeaders(stranger),
      payload: { assigneeId: owner.userId }
    });
    expect(response.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

describe("issue comments", () => {
  test("create, list in order, and member access", async () => {
    const owner = await register("cmt-owner@example.com");
    const teammate = await register("cmt-teammate@example.com");
    const { project } = await createProject(owner, "Comment Project");
    await addMember(owner, project.id, "cmt-teammate@example.com");
    const { issueId } = await processEvent(project.id, makePayload());

    const first = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/issues/${issueId}/comments`,
      headers: authHeaders(owner),
      payload: { body: "first comment" }
    });
    expect(first.statusCode).toBe(201);
    commentResponseSchema.parse(first.json<unknown>());

    const second = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/issues/${issueId}/comments`,
      headers: authHeaders(teammate),
      payload: { body: "second comment" }
    });
    expect(second.statusCode).toBe(201);

    // A member can list; order is createdAt asc.
    const list = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/issues/${issueId}/comments`,
      headers: authHeaders(teammate)
    });
    expect(list.statusCode).toBe(200);
    const listBody = listCommentsResponseSchema.parse(list.json<unknown>());
    expect(listBody.comments.map((c) => c.body)).toEqual([
      "first comment",
      "second comment"
    ]);
    expect(listBody.comments[0]?.author.email).toBe("cmt-owner@example.com");
  });

  test("body is trimmed and empty body is rejected", async () => {
    const owner = await register("cmt-validate-owner@example.com");
    const { project } = await createProject(owner, "Comment Validate");
    const { issueId } = await processEvent(project.id, makePayload());

    const empty = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/issues/${issueId}/comments`,
      headers: authHeaders(owner),
      payload: { body: "   " }
    });
    expect(empty.statusCode).toBe(400);

    const trimmed = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/issues/${issueId}/comments`,
      headers: authHeaders(owner),
      payload: { body: "  hello  " }
    });
    expect(trimmed.statusCode).toBe(201);
    expect(commentResponseSchema.parse(trimmed.json<unknown>()).comment.body).toBe(
      "hello"
    );
  });

  test("non-members are denied (404) on list and create", async () => {
    const owner = await register("cmt-denied-owner@example.com");
    const stranger = await register("cmt-denied-stranger@example.com");
    const { project } = await createProject(owner, "Comment Denied");
    const { issueId } = await processEvent(project.id, makePayload());

    const list = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/issues/${issueId}/comments`,
      headers: authHeaders(stranger)
    });
    expect(list.statusCode).toBe(404);

    const create = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/issues/${issueId}/comments`,
      headers: authHeaders(stranger),
      payload: { body: "intruder" }
    });
    expect(create.statusCode).toBe(404);
  });

  test("delete permissions: author OK, other member 403, owner OK; missing 404", async () => {
    const owner = await register("cmt-del-owner@example.com");
    const memberA = await register("cmt-del-a@example.com");
    const memberB = await register("cmt-del-b@example.com");
    const { project } = await createProject(owner, "Comment Delete");
    await addMember(owner, project.id, "cmt-del-a@example.com");
    await addMember(owner, project.id, "cmt-del-b@example.com");
    const { issueId } = await processEvent(project.id, makePayload());

    const commentsUrl = `/api/projects/${project.id}/issues/${issueId}/comments`;

    const create = async (session: AuthSession, body: string): Promise<string> => {
      const res = await app.inject({
        method: "POST",
        url: commentsUrl,
        headers: authHeaders(session),
        payload: { body }
      });
      expect(res.statusCode).toBe(201);
      return commentResponseSchema.parse(res.json<unknown>()).comment.id;
    };

    // Missing comment → 404.
    const missing = await app.inject({
      method: "DELETE",
      url: `${commentsUrl}/does-not-exist`,
      headers: authHeaders(owner)
    });
    expect(missing.statusCode).toBe(404);

    // memberA's comment: another plain member (memberB) cannot delete → 403.
    const aComment = await create(memberA, "by A");
    const byB = await app.inject({
      method: "DELETE",
      url: `${commentsUrl}/${aComment}`,
      headers: authHeaders(memberB)
    });
    expect(byB.statusCode).toBe(403);

    // The author can delete their own comment → 204.
    const byAuthor = await app.inject({
      method: "DELETE",
      url: `${commentsUrl}/${aComment}`,
      headers: authHeaders(memberA)
    });
    expect(byAuthor.statusCode).toBe(204);

    // An owner-role member can delete someone else's comment → 204.
    const bComment = await create(memberB, "by B");
    const byOwner = await app.inject({
      method: "DELETE",
      url: `${commentsUrl}/${bComment}`,
      headers: authHeaders(owner)
    });
    expect(byOwner.statusCode).toBe(204);

    // A non-member is denied even with a valid commentId → 404 (membership gate).
    const cComment = await create(owner, "by owner");
    const stranger = await register("comment-del-stranger@example.com");
    const byStranger = await app.inject({
      method: "DELETE",
      url: `${commentsUrl}/${cComment}`,
      headers: authHeaders(stranger)
    });
    expect(byStranger.statusCode).toBe(404);
  });
});
