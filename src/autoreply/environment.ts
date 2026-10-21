import { z } from "zod";
import type { ReplyDependencies } from "./contracts.js";
import { errorType, logDiagnostic, logProviderRequest } from "./diagnostics.js";
import { createLodgifyMessaging } from "./lodgify.js";
import { createReplyGenerator } from "./openai.js";

export interface WorkerEnv {
  CONVERSATIONS: DurableObjectNamespace;
  LODGIFY_API_KEY: string;
  OPENAI_API_KEY: string;
  OPENAI_MODEL?: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  WEBHOOK_TOKEN: string;
  /** Secret returned once from POST /webhooks/v1/subscribe; verifies ms-signature from Lodgify. */
  LODGIFY_WEBHOOK_SECRET?: string;
  ADMIN_TOKEN: string;
  PROPERTY_CONTEXTS_JSON: string;
  AUTO_REPLY_ENABLED?: string;
}

const configSchema = z.object({
  LODGIFY_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).default("gpt-6-luna"),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().min(1),
  WEBHOOK_TOKEN: z.string().min(32),
  LODGIFY_WEBHOOK_SECRET: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().min(16).optional(),
  ),
  ADMIN_TOKEN: z.string().min(32),
  PROPERTY_CONTEXTS_JSON: z
    .string()
    .transform((value, ctx) => {
      try {
        return JSON.parse(value);
      } catch {
        ctx.addIssue({ code: "custom", message: "Invalid property context JSON" });
        return z.NEVER;
      }
    })
    .pipe(z.record(z.string().regex(/^[1-9]\d*$/), z.string().trim().min(1).max(40_000))),
  AUTO_REPLY_ENABLED: z.enum(["true", "false"]).default("false"),
});

export function parseWorkerConfig(env: WorkerEnv) {
  return configSchema.safeParse(env);
}

/** Field paths only — safe for Cloudflare logs. */
export function formatConfigIssues(error: z.ZodError): string {
  return error.issues.map((issue) => issue.path.join(".") || issue.message).join(", ");
}

export function createReplyDependencies(env: WorkerEnv): ReplyDependencies {
  const config = configSchema.parse(env);
  const chatIds = config.TELEGRAM_CHAT_ID.split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return {
    ...createLodgifyMessaging(config.LODGIFY_API_KEY),
    generate: createReplyGenerator({
      apiKey: config.OPENAI_API_KEY,
      model: config.OPENAI_MODEL,
      propertyContexts: config.PROPERTY_CONTEXTS_JSON,
    }),
    notify: async (text, threadId) => {
      // Telegram has no idempotency key: a retry after a timeout may duplicate an alert.
      const results = await Promise.allSettled(
        chatIds.map(async (chatId, recipientIndex) => {
          const startedAt = Date.now();
          let response: Response;
          try {
            response = await fetch(
              `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`,
              {
                method: "POST",
                signal: AbortSignal.timeout(4000),
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4096) }),
              },
            );
          } catch (error) {
            logProviderRequest({
              provider: "telegram",
              operation: "notification.send",
              method: "POST",
              durationMs: Date.now() - startedAt,
              status: null,
              threadId,
              recipientIndex,
              outcome: "network_error",
              errorType: errorType(error),
            });
            throw new Error(`Telegram notification network failure (${errorType(error)})`);
          }
          let responseBody: unknown;
          try {
            responseBody = await response.json();
          } catch (error) {
            logProviderRequest({
              provider: "telegram",
              operation: "notification.send",
              method: "POST",
              durationMs: Date.now() - startedAt,
              status: response.status,
              response,
              threadId,
              recipientIndex,
              outcome: "invalid_response",
              errorType: errorType(error),
            });
            throw new Error("Telegram returned invalid JSON");
          }
          const body = z
            .object({ ok: z.boolean().optional(), error_code: z.number().optional() })
            .passthrough()
            .safeParse(responseBody);
          const success = response.ok && body.success && body.data.ok === true;
          logProviderRequest({
            provider: "telegram",
            operation: "notification.send",
            method: "POST",
            durationMs: Date.now() - startedAt,
            status: response.status,
            response,
            threadId,
            recipientIndex,
            outcome: success
              ? "success"
              : !response.ok
                ? "http_error"
                : body.success
                  ? "provider_error"
                  : "invalid_response",
            ...(body.success && body.data.error_code !== undefined
              ? { providerErrorCode: body.data.error_code }
              : {}),
          });
          if (!success) throw new Error("Telegram delivery failed");
        }),
      );
      const delivered = results.filter((result) => result.status === "fulfilled").length;
      logDiagnostic(
        delivered === results.length ? "info" : "warn",
        "telegram_notification_summary",
        {
          recipientCount: results.length,
          deliveredCount: delivered,
          failedCount: results.length - delivered,
          ...(threadId ? { threadId } : {}),
        },
      );
      if (results.length === 0 || results.some((result) => result.status === "rejected")) {
        throw new Error("Telegram delivery failed for one or more recipients");
      }
    },
  };
}
