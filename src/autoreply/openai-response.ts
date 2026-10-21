import { z } from "zod";
import { decisionSchema, type ReplyDecision } from "./contracts.js";
import { errorType, logDiagnostic, validationIssues } from "./diagnostics.js";

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

export async function parseOpenAIReply(
  response: Response,
  threadId?: string,
): Promise<ReplyDecision> {
  let rawResponse: unknown;
  try {
    rawResponse = await response.json();
  } catch (error) {
    logDiagnostic("warn", "openai_response_invalid_json", {
      threadId,
      errorType: errorType(error),
    });
    throw new Error("OpenAI returned invalid JSON");
  }
  const raw = rawResponse && typeof rawResponse === "object" ? rawResponse : {};
  const summary = raw as Record<string, unknown>;
  const usage = summary.usage && typeof summary.usage === "object" ? summary.usage : {};
  const tokenUsage = usage as Record<string, unknown>;
  const parsedResponse = responseSchema.safeParse(rawResponse);
  if (!parsedResponse.success) {
    logDiagnostic("warn", "openai_response_schema_invalid", {
      threadId,
      responseStatus: typeof summary.status === "string" ? summary.status : null,
      outputItemCount: Array.isArray(summary.output) ? summary.output.length : null,
      inputTokens: typeof tokenUsage.input_tokens === "number" ? tokenUsage.input_tokens : null,
      outputTokens: typeof tokenUsage.output_tokens === "number" ? tokenUsage.output_tokens : null,
      issues: validationIssues(parsedResponse.error),
    });
    throw new Error("OpenAI response failed schema validation");
  }
  const parsed = parsedResponse.data;
  const content = parsed.output.flatMap((item) => (item.type === "message" ? item.content : []));
  const output = content[0];
  if (content.length !== 1 || output?.type !== "output_text") {
    logDiagnostic("warn", "openai_response_missing_text", {
      threadId,
      responseId: typeof summary.id === "string" ? summary.id.slice(0, 100) : null,
      responseStatus: parsed.status,
      outputItemCount: parsed.output.length,
      contentItemCount: content.length,
      contentTypes: content.map((item) => item.type),
    });
    throw new Error("OpenAI returned no complete reply or refused the request");
  }
  let rawDecision: unknown;
  try {
    rawDecision = JSON.parse(output.text);
  } catch (error) {
    logDiagnostic("warn", "openai_reply_invalid_json", {
      threadId,
      errorType: errorType(error),
      replyLength: output.text.length,
    });
    throw new Error("OpenAI reply was not valid JSON");
  }
  const parsedDecision = decisionSchema.safeParse(rawDecision);
  if (!parsedDecision.success) {
    logDiagnostic("warn", "openai_reply_schema_invalid", {
      threadId,
      issues: validationIssues(parsedDecision.error),
    });
    throw new Error("OpenAI reply failed schema validation");
  }
  const decision = parsedDecision.data;
  logDiagnostic("info", "openai_reply_parsed", {
    threadId,
    responseId: typeof summary.id === "string" ? summary.id.slice(0, 100) : null,
    inputTokens: typeof tokenUsage.input_tokens === "number" ? tokenUsage.input_tokens : null,
    outputTokens: typeof tokenUsage.output_tokens === "number" ? tokenUsage.output_tokens : null,
    escalation: decision.escalation,
    replyLength: decision.reply.length,
  });
  return decision;
}
