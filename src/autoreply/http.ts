import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { type GuestEvent, webhookSchema } from "./contracts.js";
import { logDiagnostic } from "./diagnostics.js";
import { formatConfigIssues, parseWorkerConfig, type WorkerEnv } from "./environment.js";
import {
  extractWebhookToken,
  msSignatureHeader,
  webhookAuthDebug,
  webhookAuthorized,
} from "./lodgify-webhook-auth.js";
import { schemaIssues } from "./webhook-validation.js";

export async function handleWorkerRequest(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  const admin = /^\/conversations\/([^/]+)(?:\/(pause|resume|retry-notification))?$/.exec(
    url.pathname,
  );
  if (!admin && url.pathname !== "/webhook/lodgify")
    return new Response("not found", { status: 404 });
  const bootConfig = parseWorkerConfig(env);
  if (!bootConfig.success) {
    // Field paths only — same contract as formatConfigIssues for Cloudflare logs.
    const issues = formatConfigIssues(bootConfig.error);
    console.warn("[worker] 503 config:", issues);
    return new Response(`worker not configured: ${issues}`, { status: 503 });
  }
  if (admin) return handleAdmin(request, env, admin);
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
  const body = await readRawBody(request);
  if (!body.ok) {
    console.warn(`[webhook] ${body.status} body: ${body.error}`);
    return new Response(body.error, { status: body.status });
  }
  const config = parseWorkerConfig(env);
  if (!config.success) return new Response("worker not configured", { status: 503 });
  const token = extractWebhookToken(request, url);
  const msSignature = msSignatureHeader(request);
  const allowed = webhookAuthorized({
    token,
    webhookToken: config.data.WEBHOOK_TOKEN,
    lodgifySecret: config.data.LODGIFY_WEBHOOK_SECRET,
    rawBody: body.raw,
    msSignature,
  });
  if (!allowed) {
    console.warn(
      `[webhook] 401 ${webhookAuthDebug({
        token,
        webhookToken: config.data.WEBHOOK_TOKEN,
        lodgifySecret: config.data.LODGIFY_WEBHOOK_SECRET,
        msSignature,
      })}`,
    );
    return new Response("unauthorized", { status: 401 });
  }
  return handleWebhookBody(body.raw, body.value, env);
}

async function handleWebhookBody(
  rawBody: string,
  parsed: unknown,
  env: WorkerEnv,
): Promise<Response> {
  // Lodgify delivers a JSON array at the root while its docs show a single object.
  const isArray = Array.isArray(parsed);
  const elements: unknown[] = isArray ? parsed : [parsed];
  if (isArray) {
    console.warn(
      `[webhook] array payload: length=${elements.length} actions=${elements.map(elementAction).join("|")}`,
    );
  }
  const issues: string[] = [];
  const accepted: { event: GuestEvent; element: unknown; index: number }[] = [];
  elements.forEach((element, index) => {
    const action = z.object({ action: z.string() }).safeParse(element);
    if (action.success && action.data.action !== "guest_message_received") return;
    const event = webhookSchema.safeParse(element);
    if (event.success) {
      accepted.push({ event: event.data, element, index });
      return;
    }
    const detail = schemaIssues(event.error, element);
    issues.push(elements.length > 1 ? `[${index}] ${detail}` : detail);
  });
  if (issues.length > 0) {
    const detail = issues.join(", ");
    console.warn("[webhook] 400 invalid webhook:", detail);
    return new Response(`invalid webhook: ${detail}`, { status: 400 });
  }
  if (accepted.length === 0) return new Response("ignored");

  let first: Response | undefined;
  for (const { event, element, index } of accepted) {
    logDiagnostic("info", "lodgify_webhook_event_forwarding", {
      threadId: event.threadId,
      eventIndex: index,
      batchSize: elements.length,
      messageCreatedAt: event.createdAt,
      messageLength: event.message.length,
      hasAttachments: event.hasAttachments,
      bookingReferencePresent: Boolean(event.bookingId),
    });
    const response = await env.CONVERSATIONS.get(
      env.CONVERSATIONS.idFromName(event.threadId),
    ).fetch("https://conversation/event", {
      method: "POST",
      // Signature already verified against the raw body; the conversation takes one event.
      body: isArray ? JSON.stringify(element) : rawBody,
    });
    logDiagnostic(response.status >= 400 ? "warn" : "info", "lodgify_webhook_event_forwarded", {
      threadId: event.threadId,
      eventIndex: index,
      batchSize: elements.length,
      responseStatus: response.status,
    });
    if (!response.ok) {
      console.warn(`[webhook] ${response.status} conversation:`, await response.clone().text());
      return response;
    }
    first ??= response;
  }
  return first as Response;
}

function elementAction(element: unknown): string {
  if (element && typeof element === "object" && !Array.isArray(element)) {
    const action = (element as { action?: unknown }).action;
    if (typeof action === "string") return action;
  }
  return typeof element;
}

async function handleAdmin(
  request: Request,
  env: WorkerEnv,
  match: RegExpExecArray,
): Promise<Response> {
  if (!authorized(request.headers.get("authorization")?.replace(/^Bearer /, ""), env.ADMIN_TOKEN)) {
    return new Response("unauthorized", { status: 401 });
  }
  const threadId = z.uuid().safeParse(match[1]);
  if (!threadId.success) return new Response("invalid thread ID", { status: 400 });
  const action = match[2];
  const method = action ? "POST" : "GET";
  if (request.method !== method) return new Response("method not allowed", { status: 405 });
  return env.CONVERSATIONS.get(env.CONVERSATIONS.idFromName(threadId.data)).fetch(
    `https://conversation/${action ?? "status"}`,
    { method },
  );
}

function authorized(actual: string | null | undefined, expected: string): boolean {
  if (!actual) return false;
  const provided = Buffer.from(actual);
  const wanted = Buffer.from(expected);
  return provided.length === wanted.length && timingSafeEqual(provided, wanted);
}

async function readRawBody(
  request: Request,
): Promise<
  { ok: true; raw: string; value: unknown } | { ok: false; error: string; status: number }
> {
  if (!request.body) return { ok: false, error: "empty body", status: 400 };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 64_000) {
        await reader.cancel();
        return { ok: false, error: "body too large", status: 413 };
      }
      chunks.push(chunk.value);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    return { ok: true, raw, value: JSON.parse(raw) };
  } catch {
    return { ok: false, error: "invalid body", status: 400 };
  }
}
