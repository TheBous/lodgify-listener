import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProcessGuestMessage } from "../application/process-guest-message.js";
import type { IncomingGuestMessage } from "../domain/guest-message.js";
import type { Result } from "../domain/result.js";

const MAX_BODY_BYTES = 1_000_000;

type BodyError = "body-too-large" | "body-read-failed";
type WebhookError = BodyError | "invalid-json";

export async function handleLodgifyWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  processMessage: ProcessGuestMessage,
): Promise<void> {
  const message = await readWebhook(req);
  if (!message.ok) {
    respond(res, message.error === "body-too-large" ? 413 : 400, message.error);
    return;
  }
  if (message.value === null) {
    respond(res, 200, "ignored");
    return;
  }
  const result = await processMessage(message.value);
  if (!result.ok) {
    console.error(`[${message.value.bookingId}] processing failed:`, result.error);
    respond(res, 500, "processing failed");
    return;
  }
  console.log(`[${message.value.bookingId}] ${result.value.kind}`);
  respond(res, 200, "ok");
}

async function readWebhook(
  req: IncomingMessage,
): Promise<Result<IncomingGuestMessage | null, WebhookError>> {
  const body = await readBody(req);
  if (!body.ok) return body;
  const payload = parsePayload(body.value);
  if (!payload.ok) return payload;
  const message = parseGuestMessage(payload.value);
  return message.ok ? message : { ok: true, value: null };
}

function readBody(req: IncomingMessage): Promise<Result<string, BodyError>> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        resolve({ ok: false, error: "body-too-large" });
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve({ ok: true, value: Buffer.concat(chunks).toString("utf8") }));
    req.on("error", () => resolve({ ok: false, error: "body-read-failed" }));
  });
}

function parsePayload(body: string): Result<unknown, "invalid-json"> {
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    return { ok: false, error: "invalid-json" };
  }
}

export function parseGuestMessage(input: unknown): Result<IncomingGuestMessage, "invalid-webhook"> {
  if (!isRecord(input) || input.action !== "guest_message_received") {
    return { ok: false, error: "invalid-webhook" };
  }
  if (!nonEmptyString(input.thread_uid) || !nonEmptyString(input.inbox_uid)) {
    return { ok: false, error: "invalid-webhook" };
  }
  if (!nonEmptyString(input.guest_name) || typeof input.message !== "string") {
    return { ok: false, error: "invalid-webhook" };
  }
  if (input.subject !== undefined && input.subject !== null && typeof input.subject !== "string") {
    return { ok: false, error: "invalid-webhook" };
  }
  return {
    ok: true,
    value: {
      threadId: input.thread_uid,
      bookingId: input.inbox_uid,
      guestName: input.guest_name,
      subject: input.subject ?? null,
      message: input.message,
    },
  };
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}

function nonEmptyString(input: unknown): input is string {
  return typeof input === "string" && input.length > 0;
}

function respond(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status).end(body);
}
