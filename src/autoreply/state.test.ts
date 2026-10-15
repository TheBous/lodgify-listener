import assert from "node:assert/strict";
import test from "node:test";
import { bookingId, decisionSchema, emptyState, fingerprint, webhookSchema } from "./contracts.js";
import { event, webhook } from "./fixtures.test.js";
import { enqueue, RECEIPT_RETENTION_MS } from "./state.js";

test("validates real webhook fields and keeps attachment-only messages", () => {
  const payload = { ...webhook(), message: "", has_attachments: true };
  const parsed = webhookSchema.parse(payload);
  assert.equal(parsed.messageId, "1");
  assert.equal(parsed.hasAttachments, true);
  assert.equal(webhookSchema.safeParse({ ...payload, message_id: undefined }).success, false);
  assert.equal(webhookSchema.safeParse({ ...payload, thread_uid: "../other" }).success, false);
  assert.equal(decisionSchema.safeParse({ escalation: "apri", reply: "opening" }).success, false);
  assert.equal(decisionSchema.safeParse({ escalation: "no", reply: "" }).success, false);
});

test("booking IDs select only valid confirmed-booking resource identifiers", () => {
  assert.equal(bookingId(event()), 123);
  for (const id of ["E123", "B0", "B1/messages", "B99999999999999999", "", "123"]) {
    assert.equal(bookingId({ ...event(), bookingId: id }), null);
  }
});

test("normalized event fingerprint survives serialization and identifies changed content", async () => {
  const message = event();
  assert.equal(await fingerprint(message), await fingerprint(structuredClone(message)));
  assert.notEqual(
    await fingerprint(message),
    await fingerprint({ ...message, message: "different" }),
  );
});

test("rejects expired and future events and protects bounded buffer", async () => {
  const state = emptyState();
  const expired = {
    ...event(),
    createdAt: new Date(Date.now() - RECEIPT_RETENTION_MS - 1000).toISOString(),
  };
  assert.equal(await (await enqueue(state, expired)).text(), "expired");
  assert.equal(
    (await enqueue(state, { ...event(), createdAt: new Date(Date.now() + 600_000).toISOString() }))
      .status,
    400,
  );
  for (let id = 0; id < 20; id++)
    assert.equal((await enqueue(state, event(String(id)))).status, 202);
  assert.equal((await enqueue(state, event("overflow"))).status, 429);
  assert.equal(state.pending.length, 20);
});
