import { z } from "zod";
import { decisionSchema, type ReplyDependencies } from "./contracts.js";
import { REPLY_RULES } from "./prompt.js";

const responseSchema = z.object({
  status: z.literal("completed"),
  output: z.array(
    z.discriminatedUnion("type", [
      z.object({ type: z.literal("reasoning") }),
      z.object({
        type: z.literal("message"),
        role: z.literal("assistant"),
        status: z.literal("completed"),
        content: z.array(
          z.discriminatedUnion("type", [
            z.object({ type: z.literal("output_text"), text: z.string() }),
            z.object({ type: z.literal("refusal"), refusal: z.string() }),
          ]),
        ),
      }),
    ]),
  ),
});

export function createReplyGenerator(options: {
  apiKey: string;
  model: string;
  propertyContexts: Record<string, string>;
}): ReplyDependencies["generate"] {
  return async (events, context) => {
    const manual = options.propertyContexts[String(context.booking.propertyId)];
    if (!manual?.trim()) throw new Error("Missing manual for this property");
    const response = await fetch("https://api.openai.com/v1/responses", {
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
    if (!response.ok) throw new Error(`OpenAI reply generation failed (${response.status})`);
    const parsed = responseSchema.parse(await response.json());
    const content = parsed.output.flatMap((item) => (item.type === "message" ? item.content : []));
    const output = content[0];
    if (content.length !== 1 || output?.type !== "output_text") {
      throw new Error("OpenAI returned no complete reply or refused the request");
    }
    const decision = decisionSchema.parse(JSON.parse(output.text));
    if (decision.escalation === "ignore") return decision;
    return { ...decision, reply: decision.reply.replace(/[\u2013\u2014]/g, ",") };
  };
}
