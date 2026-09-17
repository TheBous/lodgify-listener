import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { ProcessDependencies } from "./application/process-guest-message.js";
import { parsePropertySections } from "./domain/property-context.js";
import type { Triage, TriageContext } from "./domain/triage.js";
import { createApp } from "./server.js";

const triage = (
  category: Triage["category"],
  confidence: number,
  answerSection: string | null = null,
): Triage => ({
  category,
  confidence,
  ownerTopic: "other",
  urgent: false,
  answerSection,
});

const calls: string[] = [];
const receivedContexts: TriageContext[] = [];
const PROPERTY_MD = "# Contesto\n## Check-in / Check-out\nCheck-in: dalle 16:00";
const dependencies: ProcessDependencies = {
  triage: async (message, context) => {
    receivedContexts.push(context);
    if (message.message === "owner") return { ok: true, value: triage("needs_owner", 0.99) };
    if (message.message === "draft") {
      return { ok: true, value: triage("answerable", 0.9, "Check-in / Check-out") };
    }
    if (message.message === "answerable-no-section") {
      return { ok: true, value: triage("answerable", 0.9) };
    }
    return { ok: true, value: triage("no_reply", 0.99) };
  },
  notifyOwner: async (text) => {
    calls.push(text);
    return { ok: true, value: undefined };
  },
  threadHistory: async (threadId) =>
    threadId === "thread-broken"
      ? { ok: false, error: "thread-history-unavailable" }
      : {
          ok: true,
          value: [{ from: "owner", text: "check-in is at 15:00", sentAt: "2026-01-01T10:00:00Z" }],
        },
  propertyContext: PROPERTY_MD,
  propertySections: parsePropertySections(PROPERTY_MD),
};

assert.deepEqual(parsePropertySections("# t\n## A\nbody a\n## B\nbody b"), {
  A: "body a",
  B: "body b",
});
assert.deepEqual(parsePropertySections("## Empty\n   \n"), {});

const server = createApp(dependencies);
await new Promise<void>((resolve) => server.listen(0, resolve));
const port = (server.address() as AddressInfo).port;
const url = `http://localhost:${port}/webhook/lodgify`;

const post = (body: unknown, headers?: Record<string, string>) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const guestMessage = (threadUid: string, message: string) => ({
  action: "guest_message_received",
  thread_uid: threadUid,
  inbox_uid: "booking-1",
  guest_name: "Guest",
  message,
});

assert.equal((await post("not json")).status, 400);
assert.equal((await post({ action: "availability_change", property_id: 1 })).status, 200);
assert.equal((await post(guestMessage("thread-1", "owner"))).status, 200);
assert.equal((await post(guestMessage("thread-broken", "owner"))).status, 200);
assert.equal((await post(guestMessage("thread-1", "draft"))).status, 200);
assert.equal((await post(guestMessage("thread-1", "answerable-no-section"))).status, 200);
assert.equal((await post(guestMessage("thread-1", "spam"))).status, 200);

assert.equal(calls.length, 4);
assert.match(calls[0] ?? "", /needs your input/);
assert.match(calls[1] ?? "", /needs your input/);
assert.match(calls[2] ?? "", /RISPOSTA PRONTA/);
assert.match(calls[2] ?? "", /Check-in: dalle 16:00/);
assert.match(calls[3] ?? "", /needs your input/);

assert.equal(receivedContexts.length, 5);
const [withHistory, withoutHistory] = receivedContexts;
assert.ok(withHistory && withoutHistory);
assert.deepEqual(withHistory, {
  propertyContext: PROPERTY_MD,
  propertySections: { "Check-in / Check-out": "Check-in: dalle 16:00" },
  history: [{ from: "owner", text: "check-in is at 15:00", sentAt: "2026-01-01T10:00:00Z" }],
});
assert.deepEqual(withoutHistory.history, []);

assert.equal((await fetch(`http://localhost:${port}/nope`, { method: "POST" })).status, 404);

server.close();
console.log("smoke ok");
