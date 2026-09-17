import { createServer, type IncomingMessage, type Server } from "node:http";
import { notifyOwner } from "./telegram.js";
import { shouldNotifyOwner, triage } from "./triage.js";

const MAX_BODY_BYTES = 1_000_000;

interface GuestMessagePayload {
  action: string;
  thread_uid: string;
  inbox_uid: string;
  guest_name: string;
  subject: string | null;
  message: string;
}

function isGuestMessage(payload: unknown): payload is GuestMessagePayload {
  if (typeof payload !== "object" || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return (
    p.action === "guest_message_received" &&
    typeof p.thread_uid === "string" &&
    typeof p.inbox_uid === "string" &&
    typeof p.guest_name === "string" &&
    typeof p.message === "string"
  );
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function ownerMessage(p: GuestMessagePayload, t: Awaited<ReturnType<typeof triage>>): string {
  const lines = [
    t.urgent ? "URGENT - guest needs your input" : "Guest needs your input",
    `Booking: ${p.inbox_uid}`,
    `Guest: ${p.guest_name}`,
    `Topic: ${t.ownerTopic}`,
  ];
  if (p.subject) lines.push(`Subject: ${p.subject}`);
  lines.push("", p.message.slice(0, 3500), "", `Thread: ${p.thread_uid}`);
  return lines.join("\n");
}

export function createApp(): Server {
  // ponytail: no webhook auth - Lodgify documents no signature; add a secret path or IP allowlist before exposing publicly
  return createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/webhook/lodgify") {
      res.writeHead(404).end();
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      res.writeHead(400).end("invalid body");
      return;
    }
    if (!isGuestMessage(payload)) {
      res.writeHead(200).end("ignored");
      return;
    }
    try {
      const t = await triage(payload);
      console.log(
        `[${payload.inbox_uid}] category=${t.category} confidence=${t.confidence.toFixed(2)} urgent=${t.urgent}`,
      );
      if (shouldNotifyOwner(t)) {
        await notifyOwner(ownerMessage(payload, t));
        console.log(`[${payload.inbox_uid}] owner notified on Telegram`);
      }
      res.writeHead(200).end("ok");
    } catch (err) {
      console.error(`[${payload.inbox_uid}] triage failed:`, err);
      res.writeHead(500).end("triage failed");
    }
  });
}
