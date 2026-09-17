import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

process.env.TYPESAFE_API_KEY ??= "smoke-test";
process.env.LODGIFY_API_KEY ??= "smoke-test";
process.env.TELEGRAM_BOT_TOKEN ??= "smoke-test";
process.env.TELEGRAM_CHAT_ID ??= "smoke-test";

const { createApp } = await import("./server.js");
const { shouldNotifyOwner } = await import("./triage.js");

const triage = (category: string, confidence: number) => ({
  category,
  confidence,
  ownerTopic: "other",
  urgent: false,
});
assert.equal(shouldNotifyOwner(triage("needs_owner", 0.99)), true);
assert.equal(shouldNotifyOwner(triage("answerable", 0.9)), false);
assert.equal(shouldNotifyOwner(triage("answerable", 0.3)), true);
assert.equal(shouldNotifyOwner(triage("no_reply", 0.1)), false);

const server = createApp();
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
assert.equal((await fetch("http://localhost:" + port + "/nope", { method: "POST" })).status, 404);

server.close();
console.log("smoke ok");
