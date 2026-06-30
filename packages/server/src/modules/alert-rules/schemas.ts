import { z } from "zod/v4";

export const alertChannelSchema = z.enum(["email", "slack"]);
export const alertConditionSchema = z.enum([
  "new_issue",
  "regression",
  "event_threshold",
  "event_spike"
]);

export const alertRuleParamsSchema = z.object({
  id: z.string().min(1),
  ruleId: z.string().min(1)
});

const baseAlertRuleInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  channel: alertChannelSchema,
  target: z.string().trim().min(1).max(2_048),
  condition: alertConditionSchema,
  threshold: z.number().int().positive().max(1_000).optional(),
  windowMinutes: z.number().int().positive().max(24 * 60).optional(),
  cooldownMinutes: z.number().int().positive().max(24 * 60).optional(),
  baselineMinutes: z.number().int().positive().max(24 * 60).optional(),
  spikeMultiplier: z.number().positive().min(1).max(100).optional(),
  minEvents: z.number().int().positive().max(1_000).optional(),
  isActive: z.boolean().default(true)
});

const slackWebhookSchema = z
  .url()
  .refine((value) => value.startsWith("https://hooks.slack.com/"), {
    message: "Slack target must be an https://hooks.slack.com/... webhook URL"
  });

const validateAlertRuleShape = (
  input: z.output<typeof baseAlertRuleInputSchema>,
  context: z.RefinementCtx
): void => {
  if (input.channel === "email") {
    const parsed = z.email().safeParse(input.target);
    if (!parsed.success) {
      context.addIssue({
        code: "custom",
        path: ["target"],
        message: "Email alert target must be a valid email address"
      });
    }
  } else {
    const parsed = slackWebhookSchema.safeParse(input.target);
    if (!parsed.success) {
      context.addIssue({
        code: "custom",
        path: ["target"],
        message: "Slack alert target must be an https://hooks.slack.com/... URL"
      });
    }
  }

  if (
    input.condition === "event_threshold" &&
    (input.threshold === undefined || input.windowMinutes === undefined)
  ) {
    context.addIssue({
      code: "custom",
      path: ["threshold"],
      message: "threshold and windowMinutes are required for event_threshold rules"
    });
  }

  if (input.condition === "event_spike") {
    // Flag each missing required field on its own path so the client knows
    // exactly which input is absent (not a single catch-all error).
    const requiredSpikeFields = [
      "windowMinutes",
      "baselineMinutes",
      "spikeMultiplier",
      "minEvents"
    ] as const;
    for (const field of requiredSpikeFields) {
      if (input[field] === undefined) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${field} is required for event_spike rules`
        });
      }
    }

    if (
      input.windowMinutes !== undefined &&
      input.baselineMinutes !== undefined &&
      input.baselineMinutes <= input.windowMinutes
    ) {
      context.addIssue({
        code: "custom",
        path: ["baselineMinutes"],
        message: "baselineMinutes must be greater than windowMinutes"
      });
    }

    if (
      input.spikeMultiplier !== undefined &&
      input.spikeMultiplier < 1
    ) {
      context.addIssue({
        code: "custom",
        path: ["spikeMultiplier"],
        message: "spikeMultiplier must be greater than or equal to 1"
      });
    }
  }
};

export const createAlertRuleSchema = baseAlertRuleInputSchema.superRefine(
  validateAlertRuleShape
);

export const updateAlertRuleSchema = baseAlertRuleInputSchema
  .partial()
  .refine((input) => Object.keys(input).length > 0, {
    message: "At least one field is required"
  });

export const mergedAlertRuleSchema = baseAlertRuleInputSchema.superRefine(
  validateAlertRuleShape
);

export const alertRuleSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  channel: alertChannelSchema,
  target: z.string(),
  condition: alertConditionSchema,
  threshold: z.number().int().nullable(),
  windowMinutes: z.number().int().nullable(),
  cooldownMinutes: z.number().int().nullable(),
  baselineMinutes: z.number().int().nullable(),
  spikeMultiplier: z.number().nullable(),
  minEvents: z.number().int().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const listAlertRulesResponseSchema = z.object({
  alertRules: z.array(alertRuleSchema)
});

export const alertRuleResponseSchema = z.object({
  alertRule: alertRuleSchema
});

export type AlertRuleParams = z.infer<typeof alertRuleParamsSchema>;
export type CreateAlertRuleInput = z.infer<typeof createAlertRuleSchema>;
export type UpdateAlertRuleInput = z.infer<typeof updateAlertRuleSchema>;
