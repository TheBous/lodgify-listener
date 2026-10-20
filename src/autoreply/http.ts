import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { webhookSchema } from "./contracts.js";
import { parseWorkerConfig, type WorkerEnv } from "./environment.js";
import {
  extractWebhookToken,
  msSignatureHeader,
  webhookAuthorized,
} from "./lodgify-webhook-auth.js";

export async function handleWorkerRequest(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  const admin = /^\/conversations\/([^/]+)(?:\/(pause|resume|retry-notification))?$/.exec(
    url.pathname,
  );
  if (!admin && url.pathname !== "/webhook/lodgify")
    return new Response("not found", { status: 404 });
  if (!parseWorkerConfig(env).success)
    return new Response("worker not configured", { status: 503 });
  if (admin) return handleAdmin(request, env, admin);
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
  const body = await readRawBody(request);
  if (!body.ok) return new Response(body.error, { status: body.status });
  const config = parseWorkerConfig(env);
  if (!config.success) return new Response("worker not configured", { status: 503 });
  const allowed = await webhookAuthorized({
    token: extractWebhookToken(request, url),
    webhookToken: config.data.WEBHOOK_TOKEN,
    lodgifySecret: config.data.LODGIFY_WEBHOOK_SECRET,
    rawBody: body.raw,
    msSignature: msSignatureHeader(request),
  });
  if (!allowed) return new Response("unauthorized", { status: 401 });
  return handleWebhookBody(body.raw, body.value, env);
}

async function handleWebhookBody(
  rawBody: string,
  parsed: unknown,
  env: WorkerEnv,
): Promise<Response> {
  const action = z.object({ action: z.string() }).safeParse(parsed);
  if (action.success && action.data.action !== "guest_message_received")
    return new Response("ignored");
  const event = webhookSchema.safeParse(parsed);
  if (!event.success) return new Response("invalid webhook", { status: 400 });
  return env.CONVERSATIONS.get(env.CONVERSATIONS.idFromName(event.data.threadId)).fetch(
    "https://conversation/event",
    { method: "POST", body: rawBody },
  );
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
