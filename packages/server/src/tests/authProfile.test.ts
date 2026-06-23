import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { buildApp } from "../app.js";
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
