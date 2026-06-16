import type { AlertChannel } from "@prisma/client";
import nodemailer from "nodemailer";

import { env } from "../config/env.js";

export interface NotificationMessage {
  subject: string;
  text: string;
}

export interface Notifier {
  send(
    channel: AlertChannel,
    target: string,
    message: NotificationMessage
  ): Promise<void>;
}

const hasSmtpCredentials = (): boolean =>
  Boolean(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASSWORD);

const SLACK_WEBHOOK_PREFIX = "https://hooks.slack.com/";
const SLACK_SEND_TIMEOUT_MS = 10_000;

const isLocalSmtpHost = (host: string | undefined): boolean =>
  host === "localhost" || host === "127.0.0.1" || host === "::1";

const createEmailTransport = (): nodemailer.Transporter => {
  if (!hasSmtpCredentials()) {
    return nodemailer.createTransport({
      jsonTransport: true
    });
  }

  if (!env.SMTP_FROM) {
    throw new Error("SMTP_FROM is required when SMTP credentials are configured");
  }

  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    // Enforce STARTTLS for non-local relays to prevent a downgrade attack.
    ...(isLocalSmtpHost(env.SMTP_HOST) ? {} : { requireTLS: true }),
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASSWORD
    }
  });
};

class RegistryNotifier implements Notifier {
  private readonly emailTransport = createEmailTransport();

  public async send(
    channel: AlertChannel,
    target: string,
    message: NotificationMessage
  ): Promise<void> {
    if (channel === "email") {
      await this.sendEmail(target, message);
      return;
    }

    await this.sendSlack(target, message);
  }

  private async sendEmail(
    target: string,
    message: NotificationMessage
  ): Promise<void> {
    const info: unknown = await this.emailTransport.sendMail({
      from: env.SMTP_FROM,
      to: target,
      subject: message.subject,
      text: message.text
    });

    if (!hasSmtpCredentials()) {
      const payload =
        typeof info === "object" && info !== null && "message" in info
          ? info.message
          : info;
      console.info("Email notification jsonTransport payload", payload);
    }
  }

  private async sendSlack(
    target: string,
    message: NotificationMessage
  ): Promise<void> {
    // Defence-in-depth against SSRF: re-validate at send time (independent of
    // write-time validation), refuse redirects, and bound the request time so a
    // slow/hung endpoint can't exhaust worker concurrency slots.
    if (!target.startsWith(SLACK_WEBHOOK_PREFIX)) {
      throw new Error("Slack webhook target must be an https://hooks.slack.com/ URL");
    }

    const response = await fetch(target, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(SLACK_SEND_TIMEOUT_MS),
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        text: message.text
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Slack webhook failed with ${String(response.status)}: ${body}`);
    }
  }
}

export const defaultNotifier: Notifier = new RegistryNotifier();
