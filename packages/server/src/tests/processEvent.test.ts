import { describe, expect, test } from "vitest";

import { prisma } from "../lib/prisma.js";
import { processEvent } from "../modules/events/process.js";
import type { EventPayload } from "../modules/events/schemas.js";

const createProject = async (): Promise<string> => {
  const user = await prisma.user.create({
    data: {
      email: "processor@example.com",
      passwordHash: "not-used"
    }
  });

  const project = await prisma.project.create({
    data: {
      name: "Processor",
      slug: "processor",
      ownerId: user.id
    }
  });

  return project.id;
};

const makePayload = (message: string, functionName = "render"): EventPayload => ({
  eventId: "22222222-2222-4222-8222-222222222222",
  timestamp: new Date().toISOString(),
  level: "error",
  message,
  exception: {
    type: "TypeError",
    value: message,
    stacktrace: {
      frames: [
        {
          function: functionName,
          filename: "src/app.tsx",
          lineno: 10,
          colno: 5,
          in_app: true
        }
      ]
    }
  },
  breadcrumbs: [{ category: "ui", message: "clicked" }],
  tags: { browser: "chromium" },
  user: { id: "user-1" },
  contexts: { runtime: { name: "browser" } },
  release: "1.0.0",
  environment: "test",
  sdk: {
    name: "mini-sentry-js",
    version: "0.1.0"
  },
  request: {
    url: "https://example.com/path"
  }
});

describe("processEvent", () => {
  test("groups identical events and persists JSON fields", async () => {
    const projectId = await createProject();
    const first = await processEvent(projectId, makePayload("Boom"));

    expect(first.isNew).toBe(true);

    const second = await processEvent(projectId, makePayload("Boom"));
    expect(second.isNew).toBe(false);
    expect(second.issueId).toBe(first.issueId);

    const issue = await prisma.issue.findUniqueOrThrow({
      where: { id: first.issueId }
    });
    expect(issue.timesSeen).toBe(2);

    const events = await prisma.event.findMany({
      where: { issueId: first.issueId },
      orderBy: { receivedAt: "asc" }
    });
    expect(events).toHaveLength(2);
    expect(events[0]?.id).not.toBe("22222222-2222-4222-8222-222222222222");
    expect(events[0]?.breadcrumbs).toEqual([{ category: "ui", message: "clicked" }]);
    expect(events[0]?.tags).toEqual({ browser: "chromium" });
    expect(events[0]?.userContext).toEqual({ id: "user-1" });
    expect(events[0]?.contexts).toEqual({ runtime: { name: "browser" } });

    const different = await processEvent(
      projectId,
      makePayload("Different boom", "submit")
    );
    expect(different.isNew).toBe(true);
    expect(different.issueId).not.toBe(first.issueId);
  });
});
