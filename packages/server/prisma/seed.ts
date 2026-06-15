import { randomBytes } from "node:crypto";

import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const passwordHash = await argon2.hash("demo1234");

  const user = await prisma.user.upsert({
    where: { email: "demo@mini-sentry.local" },
    update: {
      passwordHash,
      name: "Demo User"
    },
    create: {
      email: "demo@mini-sentry.local",
      passwordHash,
      name: "Demo User"
    }
  });

  const project = await prisma.project.upsert({
    where: { slug: "demo" },
    update: {
      name: "Demo Project",
      ownerId: user.id,
      platform: "javascript-browser"
    },
    create: {
      name: "Demo Project",
      slug: "demo",
      ownerId: user.id,
      platform: "javascript-browser"
    }
  });

  const existingKey = await prisma.projectKey.findFirst({
    where: {
      projectId: project.id,
      label: "Default DSN"
    },
    orderBy: { createdAt: "asc" }
  });

  const projectKey =
    existingKey ??
    (await prisma.projectKey.create({
      data: {
        projectId: project.id,
        publicKey: randomBytes(16).toString("hex"),
        label: "Default DSN"
      }
    }));

  const existingAlertRule = await prisma.alertRule.findFirst({
    where: {
      projectId: project.id,
      name: "Demo Slack alerts"
    },
    orderBy: { createdAt: "asc" }
  });

  await (existingAlertRule
    ? prisma.alertRule.update({
        where: { id: existingAlertRule.id },
        data: {
          channel: "slack",
          target: "https://hooks.slack.com/services/replace/me",
          condition: "new_issue",
          isActive: true
        }
      })
    : prisma.alertRule.create({
        data: {
          projectId: project.id,
          name: "Demo Slack alerts",
          channel: "slack",
          target: "https://hooks.slack.com/services/replace/me",
          condition: "new_issue",
          isActive: true
        }
      }));

  console.log(`Demo DSN: http://${projectKey.publicKey}@localhost:4000/${project.id}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
