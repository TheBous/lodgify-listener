import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { ProcessDependencies } from "./application/process-guest-message.js";
import type { Triage } from "./domain/triage.js";
import { createApp } from "./server.js";

const triage = (category: Triage["category"], confidence: number): Triage => ({
  category,
  confidence,
  ownerTopic: "other",
  urgent: false,
});

const calls: string[] = [];
const dependencies: ProcessDependencies = {
  triage: async (message) => ({
    ok: true,
    value: triage(message.message === "owner" ? "needs_owner" : "no_reply", 0.99),
  }),
  notifyOwner: async () => {
    calls.push("notified");
    return { ok: true, value: undefined };
  },
};

const server = createApp(dependencies);
await new Promise<void>((resolve) => server.listen(0, resolve));
const port = (server.address() as AddressInfo).port;
const url = `http://localhost:${port}/webhook/lodgify`;

assert.equal((await fetch(url, { method: "POST", body: "not json" })).status, 400);
assert.equal(
  (
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "availability_change", property_id: 1 }),
    })
  ).status,
  200,
);
assert.equal(
  (
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "guest_message_received",
        thread_uid: "thread-1",
        inbox_uid: "booking-1",
        guest_name: "Guest",
        message: "owner",
      }),
    })
  ).status,
  200,
);
assert.deepEqual(calls, ["notified"]);
assert.equal((await fetch(`http://localhost:${port}/nope`, { method: "POST" })).status, 404);

server.close();
console.log("smoke ok");
