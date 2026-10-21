import type { ReplyDependencies } from "./contracts.js";
import { errorType, logDiagnostic, logProviderRequest } from "./diagnostics.js";
import { parseOpenAIReply } from "./openai-response.js";
import { REPLY_RULES } from "./prompt.js";

export function createReplyGenerator(options: {
  apiKey: string;
  model: string;
  propertyContexts: Record<string, string>;
}): ReplyDependencies["generate"] {
  return async (events, context) => {
    const manual = options.propertyContexts[String(context.booking.propertyId)];
    const threadId = events[0]?.threadId;
    if (!manual?.trim()) {
      logDiagnostic("warn", "guest_reply_suppressed", {
        threadId,
        reason: "property_manual_missing",
      });
      throw new Error("Missing manual for this property");
    }
    logDiagnostic("info", "openai_request_started", {
      threadId,
      model: options.model,
      eventCount: events.length,
      historyMessageCount: context.history.length,
      manualLength: manual.length,
      guestMessageCharacters: events.reduce((total, event) => total + event.message.length, 0),
      maxOutputTokens: 2000,
      store: false,
    });
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        signal: AbortSignal.timeout(8000),
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model: options.model,
          store: false,
          reasoning: { effort: "low" },
          max_output_tokens: 2000,
          instructions: REPLY_RULES,
          text: {
            format: {
              type: "json_schema",
              name: "guest_reply",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  reply: { type: "string" },
                  escalation: { type: "string", enum: ["no", "notifica", "umano", "ignore"] },
                },
                required: ["reply", "escalation"],
                additionalProperties: false,
              },
            },
          },
          input: [
            {
              role: "user",
              content: JSON.stringify({
                now: new Intl.DateTimeFormat("it-IT", {
                  timeZone: "Europe/Rome",
                  dateStyle: "full",
                  timeStyle: "short",
                }).format(new Date()),
                manual,
                booking: context.booking,
                history: context.history,
                new_messages: events.map((event) => ({
                  guest: event.guestName,
                  sentAt: event.createdAt,
                  text: event.message || "[Attachment without text]",
                })),
              }),
            },
          ],
        }),
      });
    } catch (error) {
      logProviderRequest({
        provider: "openai",
        operation: "reply.generate",
        method: "POST",
        durationMs: Date.now() - startedAt,
        status: null,
        threadId,
        outcome: "network_error",
        errorType: errorType(error),
      });
      throw new Error(`OpenAI reply generation network failure (${errorType(error)})`);
    }
    logProviderRequest({
      provider: "openai",
      operation: "reply.generate",
      method: "POST",
      durationMs: Date.now() - startedAt,
      status: response.status,
      response,
      threadId,
      outcome: response.ok ? "success" : "http_error",
    });
    if (!response.ok) throw new Error(`OpenAI reply generation failed (${response.status})`);
    const decision = await parseOpenAIReply(response, threadId);
    if (decision.escalation === "ignore") return decision;
    return { ...decision, reply: decision.reply.replace(/[\u2013\u2014]/g, ",") };
  };
}
