import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod/v4";

import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { processEvent } from "../modules/events/process.js";
import type { EventPayload } from "../modules/events/schemas.js";
import { refreshCookieName } from "../modules/auth/routes.js";
import { tokenResponseSchema } from "../modules/auth/schemas.js";
import {
  createProjectResponseSchema,
  listMembersResponseSchema,
  listProjectsResponseSchema,
  memberResponseSchema
} from "../modules/projects/schemas.js";

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

const issuePayload = (): EventPayload => ({
  timestamp: new Date().toISOString(),
  level: "error",
  message: "Membership test failure"
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

describe("project membership", () => {
  test("createProject creates an owner-role membership for the creator", async () => {
    const owner = await register("mem-create-owner@example.com");
    const created = await createProject(owner, "Owner Membership");

    const member = await prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId: created.project.id,
          userId: owner.userId
        }
      }
    });

    expect(member).not.toBeNull();
    expect(member?.role).toBe("owner");
  });

  test("added member can access project, issues, and stats; non-members get 404", async () => {
    const owner = await register("mem-access-owner@example.com");
    const teammate = await register("mem-access-teammate@example.com");
    const stranger = await register("mem-access-stranger@example.com");
    const created = await createProject(owner, "Shared Project");

    const issue = await processEvent(created.project.id, issuePayload());

    // Before being added, the teammate is denied (404).
    const before = await app.inject({
      method: "GET",
      url: `/api/projects/${created.project.id}`,
      headers: authHeaders(teammate)
    });
    expect(before.statusCode).toBe(404);

    const added = await addMember(
      owner,
      created.project.id,
      "mem-access-teammate@example.com"
    );
    expect(added.statusCode).toBe(201);

    // After being added, the teammate can read project, issues and stats.
    const projectResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${created.project.id}`,
      headers: authHeaders(teammate)
    });
    expect(projectResponse.statusCode).toBe(200);

    const issuesResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${created.project.id}/issues`,
      headers: authHeaders(teammate)
    });
    expect(issuesResponse.statusCode).toBe(200);

    const statsResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${created.project.id}/issues/${issue.issueId}/stats?window=24h`,
      headers: authHeaders(teammate)
    });
    expect(statsResponse.statusCode).toBe(200);

    // A member can also write (status update).
    const statusResponse = await app.inject({
      method: "PATCH",
      url: `/api/projects/${created.project.id}/issues/${issue.issueId}`,
      headers: authHeaders(teammate),
      payload: { status: "resolved" }
    });
    expect(statusResponse.statusCode).toBe(200);

    // A non-member is still denied.
    const strangerResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${created.project.id}/issues`,
      headers: authHeaders(stranger)
    });
    expect(strangerResponse.statusCode).toBe(404);
  });

  test("listProjects includes projects the user is a member of", async () => {
    const owner = await register("mem-list-owner@example.com");
    const teammate = await register("mem-list-teammate@example.com");
    const created = await createProject(owner, "Visible To Member");

    await addMember(owner, created.project.id, "mem-list-teammate@example.com");

    const response = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: authHeaders(teammate)
    });
    expect(response.statusCode).toBe(200);
    const listed = listProjectsResponseSchema.parse(response.json<unknown>());
    expect(listed.projects.map((p) => p.id)).toContain(created.project.id);
  });

  test("non-owner member cannot delete the project or manage members", async () => {
    const owner = await register("mem-perm-owner@example.com");
    const teammate = await register("mem-perm-teammate@example.com");
    const created = await createProject(owner, "Perm Project");
    await addMember(owner, created.project.id, "mem-perm-teammate@example.com");

    // Project delete is founder-only: a member (who can GET the project) gets 403,
    // not 404 — the project plainly exists for them.
    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/projects/${created.project.id}`,
      headers: authHeaders(teammate)
    });
    expect(deleteResponse.statusCode).toBe(403);

    // Member management is owner-role-only: a plain member gets 403.
    const addResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${created.project.id}/members`,
      headers: authHeaders(teammate),
      payload: { email: "mem-perm-owner@example.com" }
    });
    expect(addResponse.statusCode).toBe(403);
  });

  test("non-owner member cannot change project settings or manage DSN keys; an owner-role member can", async () => {
    const founder = await register("mem-settings-founder@example.com");
    const member = await register("mem-settings-member@example.com");
    const promoted = await register("mem-settings-promoted@example.com");
    const created = await createProject(founder, "Settings Project");
    const keyId = created.key.id;

    await addMember(
      founder,
      created.project.id,
      "mem-settings-member@example.com"
    );

    // A plain member may read the project and list keys, but cannot mutate
    // settings or DSN credentials — all owner-role-only (403, not 404: the
    // project plainly exists for them).
    const updateByMember = await app.inject({
      method: "PATCH",
      url: `/api/projects/${created.project.id}`,
      headers: authHeaders(member),
      payload: { name: "Renamed By Member" }
    });
    expect(updateByMember.statusCode).toBe(403);

    const createKeyByMember = await app.inject({
      method: "POST",
      url: `/api/projects/${created.project.id}/keys`,
      headers: authHeaders(member),
      payload: { label: "member key" }
    });
    expect(createKeyByMember.statusCode).toBe(403);

    const rotateByMember = await app.inject({
      method: "POST",
      url: `/api/projects/${created.project.id}/keys/${keyId}/rotate`,
      headers: authHeaders(member)
    });
    expect(rotateByMember.statusCode).toBe(403);

    const toggleByMember = await app.inject({
      method: "PATCH",
      url: `/api/projects/${created.project.id}/keys/${keyId}`,
      headers: authHeaders(member),
      payload: { isActive: false }
    });
    expect(toggleByMember.statusCode).toBe(403);

    // Promote a second member to owner role: settings and keys open up.
    await addMember(
      founder,
      created.project.id,
      "mem-settings-promoted@example.com",
      "owner"
    );

    const updateByOwner = await app.inject({
      method: "PATCH",
      url: `/api/projects/${created.project.id}`,
      headers: authHeaders(promoted),
      payload: { name: "Renamed By Owner" }
    });
    expect(updateByOwner.statusCode).toBe(200);

    const createKeyByOwner = await app.inject({
      method: "POST",
      url: `/api/projects/${created.project.id}/keys`,
      headers: authHeaders(promoted),
      payload: { label: "owner key" }
    });
    expect(createKeyByOwner.statusCode).toBe(201);
  });

  test("non-members are denied keys, alert-rules, and sourcemaps; access ends on removal", async () => {
    const owner = await register("mem-iso-owner@example.com");
    const stranger = await register("mem-iso-stranger@example.com");
    const teammate = await register("mem-iso-teammate@example.com");
    const created = await createProject(owner, "Isolation Project");

    // A non-member cannot reach any project sub-resource.
    for (const url of [
      `/api/projects/${created.project.id}/keys`,
      `/api/projects/${created.project.id}/alert-rules`,
      `/api/projects/${created.project.id}/sourcemaps`
    ]) {
      const denied = await app.inject({
        method: "GET",
        url,
        headers: authHeaders(stranger)
      });
      expect(denied.statusCode).toBe(404);
    }

    // A member can reach keys; after removal the same request is denied.
    await addMember(owner, created.project.id, "mem-iso-teammate@example.com");
    const allowed = await app.inject({
      method: "GET",
      url: `/api/projects/${created.project.id}/keys`,
      headers: authHeaders(teammate)
    });
    expect(allowed.statusCode).toBe(200);

    await app.inject({
      method: "DELETE",
      url: `/api/projects/${created.project.id}/members/${teammate.userId}`,
      headers: authHeaders(owner)
    });
    const afterRemoval = await app.inject({
      method: "GET",
      url: `/api/projects/${created.project.id}/keys`,
      headers: authHeaders(teammate)
    });
    expect(afterRemoval.statusCode).toBe(404);
  });

  test("an owner-role member (not the founder) can manage members", async () => {
    const founder = await register("mem-admin-founder@example.com");
    const admin = await register("mem-admin-admin@example.com");
    // newcomer must exist as a user to be addable by email (side effect only).
    await register("mem-admin-newcomer@example.com");
    const created = await createProject(founder, "Admin Project");

    // Promote `admin` to owner role; they should then be able to add members.
    await addMember(
      founder,
      created.project.id,
      "mem-admin-admin@example.com",
      "owner"
    );

    const added = await addMember(
      admin,
      created.project.id,
      "mem-admin-newcomer@example.com"
    );
    expect(added.statusCode).toBe(201);

    // But an owner-role member that is NOT the founder still cannot delete the
    // project (founder-only) — and cannot remove the founder.
    const deleteByAdmin = await app.inject({
      method: "DELETE",
      url: `/api/projects/${created.project.id}`,
      headers: authHeaders(admin)
    });
    expect(deleteByAdmin.statusCode).toBe(403);

    const removeFounder = await app.inject({
      method: "DELETE",
      url: `/api/projects/${created.project.id}/members/${founder.userId}`,
      headers: authHeaders(admin)
    });
    expect(removeFounder.statusCode).toBe(400);
  });

  test("member CRUD: duplicate 409, missing user 404, role change, removal, owner protections", async () => {
    const owner = await register("mem-crud-owner@example.com");
    const teammate = await register("mem-crud-teammate@example.com");
    const created = await createProject(owner, "CRUD Project");

    // Add by email.
    const added = await addMember(
      owner,
      created.project.id,
      "mem-crud-teammate@example.com"
    );
    expect(added.statusCode).toBe(201);
    const addedMember = memberResponseSchema.parse(added.json<unknown>());
    expect(addedMember.member.role).toBe("member");

    // Duplicate add → 409.
    const duplicate = await addMember(
      owner,
      created.project.id,
      "mem-crud-teammate@example.com"
    );
    expect(duplicate.statusCode).toBe(409);

    // Unknown user email → 404.
    const missing = await addMember(
      owner,
      created.project.id,
      "nobody-here@example.com"
    );
    expect(missing.statusCode).toBe(404);

    // Role change member → owner.
    const promote = await app.inject({
      method: "PATCH",
      url: `/api/projects/${created.project.id}/members/${teammate.userId}`,
      headers: authHeaders(owner),
      payload: { role: "owner" }
    });
    expect(promote.statusCode).toBe(200);
    expect(memberResponseSchema.parse(promote.json<unknown>()).member.role).toBe(
      "owner"
    );

    // Owner (Project.ownerId) cannot be demoted.
    const demoteOwner = await app.inject({
      method: "PATCH",
      url: `/api/projects/${created.project.id}/members/${owner.userId}`,
      headers: authHeaders(owner),
      payload: { role: "member" }
    });
    expect(demoteOwner.statusCode).toBe(400);

    // Owner (Project.ownerId) cannot be removed.
    const removeOwner = await app.inject({
      method: "DELETE",
      url: `/api/projects/${created.project.id}/members/${owner.userId}`,
      headers: authHeaders(owner)
    });
    expect(removeOwner.statusCode).toBe(400);

    // Member list is visible to a member and includes both users.
    const listResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${created.project.id}/members`,
      headers: authHeaders(teammate)
    });
    expect(listResponse.statusCode).toBe(200);
    const members = listMembersResponseSchema.parse(listResponse.json<unknown>());
    expect(members.members.map((m) => m.userId).sort()).toEqual(
      [owner.userId, teammate.userId].sort()
    );

    // Remove the teammate.
    const removeMemberResponse = await app.inject({
      method: "DELETE",
      url: `/api/projects/${created.project.id}/members/${teammate.userId}`,
      headers: authHeaders(owner)
    });
    expect(removeMemberResponse.statusCode).toBe(204);

    // After removal the (now non-member) teammate is denied again.
    const afterRemoval = await app.inject({
      method: "GET",
      url: `/api/projects/${created.project.id}`,
      headers: authHeaders(teammate)
    });
    expect(afterRemoval.statusCode).toBe(404);
  });
});
