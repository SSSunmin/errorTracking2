import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { buildApp } from "../app.js";
import { refreshCookieName } from "../modules/auth/routes.js";
import { tokenResponseSchema, userResponseSchema } from "../modules/auth/schemas.js";

let app: FastifyInstance;

interface Session {
  accessToken: string;
  userId: string;
}

const register = async (email: string, name?: string): Promise<Session> => {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: name
      ? { email, password: "password123", name }
      : { email, password: "password123" }
  });
  expect(response.statusCode).toBe(201);
  const body = tokenResponseSchema.parse(response.json<unknown>());
  return { accessToken: body.accessToken, userId: body.user.id };
};

const authHeaders = (session: Session): { authorization: string } => ({
  authorization: `Bearer ${session.accessToken}`
});

const patchName = (session: Session, name: unknown) =>
  app.inject({
    method: "PATCH",
    url: "/api/auth/me",
    headers: authHeaders(session),
    payload: { name }
  });

const changePw = (
  session: Session,
  body: { currentPassword: string; newPassword: string }
) =>
  app.inject({
    method: "PATCH",
    url: "/api/auth/me/password",
    headers: authHeaders(session),
    payload: body
  });

const login = (email: string, password: string) =>
  app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password }
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

// NOTE: cross-user mutation is structurally impossible — the endpoint reads the
// userId only from the JWT claim (getUserId), never from the body/path, so there
// is no injection surface to test.
describe("PATCH /api/auth/me (profile name)", () => {
  test("updates the caller's own name and GET /me reflects it", async () => {
    const session = await register("profile-update@example.com", "Old Name");

    const response = await patchName(session, "New Name");
    expect(response.statusCode).toBe(200);
    expect(userResponseSchema.parse(response.json<unknown>()).name).toBe("New Name");

    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: authHeaders(session)
    });
    expect(userResponseSchema.parse(me.json<unknown>()).name).toBe("New Name");
  });

  test("trims surrounding whitespace", async () => {
    const session = await register("profile-trim@example.com");
    const response = await patchName(session, "  Spaced  ");
    expect(response.statusCode).toBe(200);
    expect(userResponseSchema.parse(response.json<unknown>()).name).toBe("Spaced");
  });

  test("rejects an empty (whitespace-only) name with 400", async () => {
    const session = await register("profile-empty@example.com");
    const response = await patchName(session, "   ");
    expect(response.statusCode).toBe(400);
  });

  test("rejects a name longer than 120 chars with 400", async () => {
    const session = await register("profile-long@example.com");
    const response = await patchName(session, "a".repeat(121));
    expect(response.statusCode).toBe(400);
  });

  test("requires authentication (401)", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/auth/me",
      payload: { name: "Nobody" }
    });
    expect(response.statusCode).toBe(401);
  });
});

describe("PATCH /api/auth/me/password", () => {
  test("changes the password: old fails, new works", async () => {
    const email = "pw-change@example.com";
    const session = await register(email);

    const response = await changePw(session, {
      currentPassword: "password123",
      newPassword: "newpassword456"
    });
    expect(response.statusCode).toBe(200);
    // Returns a fresh session (new access token + user).
    expect(tokenResponseSchema.parse(response.json<unknown>()).user.email).toBe(email);

    expect((await login(email, "password123")).statusCode).toBe(401);
    expect((await login(email, "newpassword456")).statusCode).toBe(200);
  });

  test("rejects a wrong current password with 400", async () => {
    const session = await register("pw-wrong@example.com");
    const response = await changePw(session, {
      currentPassword: "not-the-password",
      newPassword: "newpassword456"
    });
    expect(response.statusCode).toBe(400);
  });

  test("rejects a too-short new password with 400", async () => {
    const session = await register("pw-short@example.com");
    const response = await changePw(session, {
      currentPassword: "password123",
      newPassword: "short"
    });
    expect(response.statusCode).toBe(400);
  });

  test("rejects a new password identical to the current one with 400", async () => {
    const session = await register("pw-same@example.com");
    const response = await changePw(session, {
      currentPassword: "password123",
      newPassword: "password123"
    });
    expect(response.statusCode).toBe(400);
  });

  test("revokes existing refresh tokens (other sessions) on change", async () => {
    const email = "pw-revoke@example.com";
    const registerResponse = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email, password: "password123" }
    });
    const oldRefreshCookie = registerResponse.cookies.find(
      (c) => c.name === refreshCookieName
    );
    if (!oldRefreshCookie) throw new Error("Expected a refresh cookie");
    const session = {
      accessToken: tokenResponseSchema.parse(registerResponse.json<unknown>()).accessToken,
      userId: "n/a"
    };

    const changeResponse = await changePw(session, {
      currentPassword: "password123",
      newPassword: "newpassword456"
    });
    const newRefreshCookie = changeResponse.cookies.find(
      (c) => c.name === refreshCookieName
    );
    if (!newRefreshCookie) throw new Error("Expected a fresh refresh cookie");

    // The fresh cookie from the change keeps the current session working. Check
    // this BEFORE the old one: reusing a revoked token trips reuse-detection,
    // which then revokes the whole family (including this fresh token).
    const newRefresh = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { [refreshCookieName]: newRefreshCookie.value }
    });
    expect(newRefresh.statusCode).toBe(200);

    // The refresh token issued at registration is now revoked.
    const oldRefresh = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { [refreshCookieName]: oldRefreshCookie.value }
    });
    expect(oldRefresh.statusCode).toBe(401);
  });

  test("requires authentication (401)", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/auth/me/password",
      payload: { currentPassword: "password123", newPassword: "newpassword456" }
    });
    expect(response.statusCode).toBe(401);
  });
});
