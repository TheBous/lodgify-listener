import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { ProcessDependencies } from "./application/process-guest-message.js";
import type { Triage, TriageContext } from "./domain/triage.js";
import { createApp } from "./server.js";

const triage = (category: Triage["category"], confidence: number): Triage => ({
  category,
  confidence,
  ownerTopic: "other",
  urgent: false,
});

const calls: string[] = [];
const receivedContexts: TriageContext[] = [];
const dependencies: ProcessDependencies = {
  triage: async (message, context) => {
    receivedContexts.push(context);
    return {
      ok: true,
      value: triage(message.message === "owner" ? "needs_owner" : "no_reply", 0.99),
    };
  },
  notifyOwner: async () => {
    calls.push("notified");
    return { ok: true, value: undefined };
  },
  threadHistory: async (threadId) =>
    threadId === "thread-broken"
      ? { ok: false, error: "thread-history-unavailable" }
      : {
          ok: true,
          value: [{ from: "owner", text: "check-in is at 15:00", sentAt: "2026-01-01T10:00:00Z" }],
        },
  propertyContext: "wifi password: test1234",
};

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
assert.deepEqual(calls, ["notified", "notified"]);

assert.equal(receivedContexts.length, 2);
const [withHistory, withoutHistory] = receivedContexts;
assert.ok(withHistory && withoutHistory);
assert.deepEqual(withHistory, {
  propertyContext: "wifi password: test1234",
  history: [{ from: "owner", text: "check-in is at 15:00", sentAt: "2026-01-01T10:00:00Z" }],
});
assert.deepEqual(withoutHistory.history, []);

assert.equal((await fetch(`http://localhost:${port}/nope`, { method: "POST" })).status, 404);

server.close();
console.log("smoke ok");
