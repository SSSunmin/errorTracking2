import type { AlertChannel } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod/v4";

import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import {
  alertRuleResponseSchema,
  listAlertRulesResponseSchema
} from "../modules/alert-rules/schemas.js";
import { refreshCookieName } from "../modules/auth/routes.js";
import { tokenResponseSchema } from "../modules/auth/schemas.js";
import { processEvent } from "../modules/events/process.js";
import type { EventPayload } from "../modules/events/schemas.js";
import {
  processAlertsForEvent,
  type AlertProcessEventResult
} from "../notifications/service.js";
import {
  defaultNotifier,
  type NotificationMessage,
  type Notifier
} from "../notifications/notifier.js";

interface CookieLike {
  name: string;
  value: string;
}

interface CookieResponse {
  cookies: CookieLike[];
}

interface AuthSession {
  accessToken: string;
}

interface MockSend {
  channel: AlertChannel;
  target: string;
  message: NotificationMessage;
}

class MockNotifier implements Notifier {
  public readonly sends: MockSend[] = [];

  public shouldFail = false;

  public send(
    channel: AlertChannel,
    target: string,
    message: NotificationMessage
  ): Promise<void> {
    this.sends.push({ channel, target, message });

    if (this.shouldFail) {
      return Promise.reject(new Error("mock delivery failed"));
    }

    return Promise.resolve();
  }
}

let app: FastifyInstance;

const getRefreshCookie = (response: CookieResponse): string => {
  const cookie = response.cookies.find(
    (candidate) => candidate.name === refreshCookieName
  );

  if (!cookie) {
    throw new Error("Expected refresh cookie to be set");
  }

  return `${cookie.name}=${cookie.value}`;
};

const register = async (email: string): Promise<AuthSession> => {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      email,
      password: "password123"
    }
  });

  expect(response.statusCode).toBe(201);
  const body = tokenResponseSchema.parse(response.json<unknown>());
  getRefreshCookie(response);

  return {
    accessToken: body.accessToken
  };
};

const authHeaders = (session: AuthSession): { authorization: string } => ({
  authorization: `Bearer ${session.accessToken}`
});

const createProjectViaApi = async (
  session: AuthSession
): Promise<{ id: string }> => {
  const response = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: authHeaders(session),
    payload: {
      name: "Alerts Project"
    }
  });

  expect(response.statusCode).toBe(201);
  const body = z
    .object({
      project: z.object({
        id: z.string()
      })
    })
    .parse(response.json<unknown>());

  return { id: body.project.id };
};

const createProject = async (): Promise<string> => {
  const user = await prisma.user.create({
    data: {
      email: "alerts@example.com",
      passwordHash: "not-used"
    }
  });

  const project = await prisma.project.create({
    data: {
      name: "Alerts Processor",
      slug: "alerts-processor",
      ownerId: user.id
    }
  });

  return project.id;
};

const makePayload = (message: string): EventPayload => ({
  timestamp: new Date().toISOString(),
  level: "error",
  message,
  exception: {
    type: "Error",
    value: message,
    stacktrace: {
      frames: [
        {
          function: "render",
          filename: "src/app.ts",
          in_app: true
        }
      ]
    }
  }
});

const dispatch = async (
  projectId: string,
  result: AlertProcessEventResult,
  notifier: MockNotifier
): Promise<void> => {
  await processAlertsForEvent(projectId, result, { notifier });
};

beforeEach(async () => {
  app = buildApp({
    ingest: {
      enqueue: () => Promise.resolve("queued-event")
    }
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("alert rule API", () => {
  test("validates targets by channel and supports CRUD", async () => {
    const session = await register("alert-rules@example.com");
    const project = await createProjectViaApi(session);

    const badEmail = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/alert-rules`,
      headers: authHeaders(session),
      payload: {
        name: "Bad email",
        channel: "email",
        target: "not-an-email",
        condition: "new_issue"
      }
    });
    expect(badEmail.statusCode).toBe(400);

    const badSlack = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/alert-rules`,
      headers: authHeaders(session),
      payload: {
        name: "Bad Slack",
        channel: "slack",
        target: "https://example.com/webhook",
        condition: "new_issue"
      }
    });
    expect(badSlack.statusCode).toBe(400);

    const createdResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/alert-rules`,
      headers: authHeaders(session),
      payload: {
        name: "Email alerts",
        channel: "email",
        target: "ops@example.com",
        condition: "event_threshold",
        threshold: 2,
        windowMinutes: 60
      }
    });
    expect(createdResponse.statusCode).toBe(201);
    const created = alertRuleResponseSchema.parse(
      createdResponse.json<unknown>()
    );
    expect(created.alertRule.target).toBe("ops@example.com");

    const listResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/alert-rules`,
      headers: authHeaders(session)
    });
    expect(listResponse.statusCode).toBe(200);
    const listed = listAlertRulesResponseSchema.parse(
      listResponse.json<unknown>()
    );
    expect(listed.alertRules).toHaveLength(1);

    const patchedResponse = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/alert-rules/${created.alertRule.id}`,
      headers: authHeaders(session),
      payload: {
        isActive: false
      }
    });
    expect(patchedResponse.statusCode).toBe(200);
    expect(
      alertRuleResponseSchema.parse(patchedResponse.json<unknown>()).alertRule
        .isActive
    ).toBe(false);

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/projects/${project.id}/alert-rules/${created.alertRule.id}`,
      headers: authHeaders(session)
    });
    expect(deleteResponse.statusCode).toBe(204);
  });

  test("rejects a PATCH that makes a slack target invalid", async () => {
    const session = await register("alert-patch@example.com");
    const project = await createProjectViaApi(session);

    const created = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/alert-rules`,
      headers: authHeaders(session),
      payload: {
        name: "Slack rule",
        channel: "slack",
        target: "https://hooks.slack.com/services/test/ok",
        condition: "new_issue"
      }
    });
    expect(created.statusCode).toBe(201);
    const ruleId = alertRuleResponseSchema.parse(created.json<unknown>())
      .alertRule.id;

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/alert-rules/${ruleId}`,
      headers: authHeaders(session),
      payload: { target: "https://evil.example/webhook" }
    });
    expect(patched.statusCode).toBe(400);
  });

  test("stores cooldown for regression and event_threshold, but drops it for new_issue", async () => {
    const session = await register("alert-cooldown@example.com");
    const project = await createProjectViaApi(session);

    const regression = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/alert-rules`,
      headers: authHeaders(session),
      payload: {
        name: "Regression",
        channel: "email",
        target: "ops@example.com",
        condition: "regression",
        cooldownMinutes: 30
      }
    });
    expect(regression.statusCode).toBe(201);
    expect(
      alertRuleResponseSchema.parse(regression.json<unknown>()).alertRule
        .cooldownMinutes
    ).toBe(30);

    // event_threshold now keeps an explicit cooldown (the re-alert window).
    const threshold = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/alert-rules`,
      headers: authHeaders(session),
      payload: {
        name: "Threshold",
        channel: "email",
        target: "threshold@example.com",
        condition: "event_threshold",
        threshold: 2,
        windowMinutes: 60,
        cooldownMinutes: 30
      }
    });
    expect(threshold.statusCode).toBe(201);
    expect(
      alertRuleResponseSchema.parse(threshold.json<unknown>()).alertRule
        .cooldownMinutes
    ).toBe(30);

    // new_issue fires at most once per issue, so a cooldown is meaningless and dropped.
    const newIssue = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/alert-rules`,
      headers: authHeaders(session),
      payload: {
        name: "New issue",
        channel: "email",
        target: "new@example.com",
        condition: "new_issue",
        cooldownMinutes: 30
      }
    });
    expect(newIssue.statusCode).toBe(201);
    expect(
      alertRuleResponseSchema.parse(newIssue.json<unknown>()).alertRule
        .cooldownMinutes
    ).toBeNull();
  });

  test("enforces a per-project alert rule cap", async () => {
    const session = await register("alert-cap@example.com");
    const project = await createProjectViaApi(session);

    await prisma.alertRule.createMany({
      data: Array.from({ length: 50 }, (_unused, index) => ({
        projectId: project.id,
        name: `Rule ${String(index)}`,
        channel: "email" as AlertChannel,
        target: `ops${String(index)}@example.com`,
        condition: "new_issue" as const
      }))
    });

    const overflow = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/alert-rules`,
      headers: authHeaders(session),
      payload: {
        name: "One too many",
        channel: "email",
        target: "extra@example.com",
        condition: "new_issue"
      }
    });
    expect(overflow.statusCode).toBe(400);
  });
});

describe("alert evaluation and dispatch", () => {
  test("new_issue fires once for the same rule and issue", async () => {
    const projectId = await createProject();
    await prisma.alertRule.create({
      data: {
        projectId,
        name: "New issue",
        channel: "slack",
        target: "https://hooks.slack.com/services/test/new-issue",
        condition: "new_issue"
      }
    });
    const notifier = new MockNotifier();

    const first = await processEvent(projectId, makePayload("New issue boom"));
    await dispatch(projectId, first, notifier);
    expect(notifier.sends).toHaveLength(1);
    expect(notifier.sends[0]?.message.text).toContain("New issue boom");

    const second = await processEvent(projectId, makePayload("New issue boom"));
    await dispatch(projectId, second, notifier);
    expect(notifier.sends).toHaveLength(1);

    const notifications = await prisma.notification.findMany({
      where: { issueId: first.issueId }
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.status).toBe("sent");
  });

  test("regression fires when a resolved issue receives a new event", async () => {
    const projectId = await createProject();
    await prisma.alertRule.create({
      data: {
        projectId,
        name: "Regression",
        channel: "email",
        target: "ops@example.com",
        condition: "regression"
      }
    });
    const notifier = new MockNotifier();

    const first = await processEvent(projectId, makePayload("Regression boom"));
    await prisma.issue.update({
      where: { id: first.issueId },
      data: { status: "resolved" }
    });

    const regressed = await processEvent(projectId, makePayload("Regression boom"));
    expect(regressed.regressed).toBe(true);
    await dispatch(projectId, regressed, notifier);

    const issue = await prisma.issue.findUniqueOrThrow({
      where: { id: first.issueId }
    });
    expect(issue.status).toBe("unresolved");
    expect(notifier.sends).toHaveLength(1);
    expect(notifier.sends[0]?.channel).toBe("email");
  });

  test("regression dedupe uses the rule cooldown", async () => {
    const projectId = await createProject();
    const rule = await prisma.alertRule.create({
      data: {
        projectId,
        name: "Regression",
        channel: "email",
        target: "ops@example.com",
        condition: "regression",
        cooldownMinutes: 1
      }
    });
    const notifier = new MockNotifier();

    const first = await processEvent(projectId, makePayload("Cooldown boom"));
    await prisma.issue.update({
      where: { id: first.issueId },
      data: { status: "resolved" }
    });

    const firstRegression = await processEvent(
      projectId,
      makePayload("Cooldown boom")
    );
    await dispatch(projectId, firstRegression, notifier);
    expect(notifier.sends).toHaveLength(1);

    await prisma.issue.update({
      where: { id: first.issueId },
      data: { status: "resolved" }
    });
    const immediateRegression = await processEvent(
      projectId,
      makePayload("Cooldown boom")
    );
    await dispatch(projectId, immediateRegression, notifier);
    expect(notifier.sends).toHaveLength(1);

    await prisma.notification.updateMany({
      where: {
        alertRuleId: rule.id,
        issueId: first.issueId
      },
      data: {
        sentAt: new Date(Date.now() - 2 * 60 * 1_000)
      }
    });
    await prisma.issue.update({
      where: { id: first.issueId },
      data: { status: "resolved" }
    });
    const delayedRegression = await processEvent(
      projectId,
      makePayload("Cooldown boom")
    );
    await dispatch(projectId, delayedRegression, notifier);

    expect(notifier.sends).toHaveLength(2);
  });

  test("event_threshold fires at threshold and dedupes within the window", async () => {
    const projectId = await createProject();
    await prisma.alertRule.create({
      data: {
        projectId,
        name: "Threshold",
        channel: "slack",
        target: "https://hooks.slack.com/services/test/threshold",
        condition: "event_threshold",
        threshold: 2,
        windowMinutes: 60
      }
    });
    const notifier = new MockNotifier();

    const first = await processEvent(projectId, makePayload("Threshold boom"));
    await dispatch(projectId, first, notifier);
    expect(notifier.sends).toHaveLength(0);

    const second = await processEvent(projectId, makePayload("Threshold boom"));
    await dispatch(projectId, second, notifier);
    expect(notifier.sends).toHaveLength(1);

    const third = await processEvent(projectId, makePayload("Threshold boom"));
    await dispatch(projectId, third, notifier);
    expect(notifier.sends).toHaveLength(1);
  });

  test("event_threshold re-alert is governed by the cooldown, not the window", async () => {
    const projectId = await createProject();
    // Cooldown (1m) is far shorter than the measurement window (60m): a re-alert
    // must be allowed once the cooldown lapses, even though the window still covers
    // the earlier events. Under the old window-based dedupe this would stay silent.
    const rule = await prisma.alertRule.create({
      data: {
        projectId,
        name: "Threshold cooldown",
        channel: "slack",
        target: "https://hooks.slack.com/services/test/cooldown",
        condition: "event_threshold",
        threshold: 2,
        windowMinutes: 60,
        cooldownMinutes: 1
      }
    });
    const notifier = new MockNotifier();

    const first = await processEvent(projectId, makePayload("Cooldown threshold"));
    await dispatch(projectId, first, notifier);
    expect(notifier.sends).toHaveLength(0); // 1 < threshold

    const second = await processEvent(projectId, makePayload("Cooldown threshold"));
    await dispatch(projectId, second, notifier);
    expect(notifier.sends).toHaveLength(1); // crosses threshold → fires

    // Still within the 1m cooldown → suppressed despite count staying ≥ threshold.
    const third = await processEvent(projectId, makePayload("Cooldown threshold"));
    await dispatch(projectId, third, notifier);
    expect(notifier.sends).toHaveLength(1);

    // Age the sent notification past the cooldown; the window (60m) still covers
    // every event, so a re-fire here proves cooldown — not window — gates re-alerts.
    // first/second share a fingerprint → same issue; use first.issueId to match
    // the sibling regression-cooldown test.
    await prisma.notification.updateMany({
      where: { alertRuleId: rule.id, issueId: first.issueId },
      data: { sentAt: new Date(Date.now() - 2 * 60 * 1_000) }
    });
    const fourth = await processEvent(projectId, makePayload("Cooldown threshold"));
    await dispatch(projectId, fourth, notifier);
    expect(notifier.sends).toHaveLength(2);
  });

  test("failed delivery records an audit row and does not throw", async () => {
    const projectId = await createProject();
    await prisma.alertRule.create({
      data: {
        projectId,
        name: "Failing Slack",
        channel: "slack",
        target: "https://hooks.slack.com/services/test/fail",
        condition: "new_issue"
      }
    });
    const notifier = new MockNotifier();
    notifier.shouldFail = true;

    const result = await processEvent(projectId, makePayload("Delivery fails"));
    await expect(dispatch(projectId, result, notifier)).resolves.toBeUndefined();

    const notification = await prisma.notification.findFirstOrThrow({
      where: { issueId: result.issueId }
    });
    expect(notification.status).toBe("failed");
    expect(notification.error).toContain("mock delivery failed");
  });

  test("an ignored issue is not a regression and stays ignored", async () => {
    const projectId = await createProject();
    await prisma.alertRule.create({
      data: {
        projectId,
        name: "Regression",
        channel: "email",
        target: "ops@example.com",
        condition: "regression"
      }
    });
    const notifier = new MockNotifier();

    const first = await processEvent(projectId, makePayload("Ignored boom"));
    await prisma.issue.update({
      where: { id: first.issueId },
      data: { status: "ignored" }
    });

    const next = await processEvent(projectId, makePayload("Ignored boom"));
    expect(next.regressed).toBe(false);
    await dispatch(projectId, next, notifier);

    const issue = await prisma.issue.findUniqueOrThrow({
      where: { id: first.issueId }
    });
    expect(issue.status).toBe("ignored");
    expect(notifier.sends).toHaveLength(0);
  });

  test("strips CRLF from the email subject built from untrusted input", async () => {
    const projectId = await createProject();
    await prisma.alertRule.create({
      data: {
        projectId,
        name: "Email",
        channel: "email",
        target: "ops@example.com",
        condition: "new_issue"
      }
    });
    const notifier = new MockNotifier();

    const payload: EventPayload = {
      timestamp: new Date().toISOString(),
      level: "error",
      message: "boom\r\nBcc: evil@example.com"
    };
    const result = await processEvent(projectId, payload);
    await dispatch(projectId, result, notifier);

    expect(notifier.sends).toHaveLength(1);
    const subject = notifier.sends[0]?.message.subject ?? "";
    expect(subject).not.toContain("\n");
    expect(subject).not.toContain("\r");
  });
});

describe("notifier SSRF guard", () => {
  test("slack delivery rejects a non-hooks.slack target at send time", async () => {
    await expect(
      defaultNotifier.send("slack", "https://evil.example/webhook", {
        subject: "s",
        text: "t"
      })
    ).rejects.toThrow(/hooks\.slack\.com/);
  });
});
