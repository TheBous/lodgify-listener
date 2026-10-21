import assert from "node:assert/strict";
import test from "node:test";
import type { WorkerEnv } from "./environment.js";
import { webhook } from "./fixtures.test.js";
import { handleWorkerRequest } from "./http.js";

const key = "test-secret-which-is-at-least-32-characters";

function harness(overrides: Record<string, unknown> = {}) {
  const forwarded: unknown[] = [];
  const env = {
    LODGIFY_API_KEY: "fake",
    OPENAI_API_KEY: "fake",
    TELEGRAM_BOT_TOKEN: "fake",
    TELEGRAM_CHAT_ID: "123",
    WEBHOOK_TOKEN: key,
    ADMIN_TOKEN: key,
    PROPERTY_CONTEXTS_JSON: JSON.stringify({ "42": "Check-in dalle 16:00." }),
    ...overrides,
    CONVERSATIONS: {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: async (_url: string, init: { body: string }) => {
          forwarded.push(JSON.parse(init.body));
          return new Response("queued", { status: 202 });
        },
      }),
    },
  } as unknown as WorkerEnv;
  return { env, forwarded };
}

function post(env: WorkerEnv, payload: unknown) {
  return handleWorkerRequest(
    new Request(`https://worker.test/webhook/lodgify?token=${key}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
    env,
  );
}

test("single object payload reaches the conversation unchanged", async () => {
  const { env, forwarded } = harness();
  const payload = webhook();
  const response = await post(env, payload);
  assert.equal(response.status, 202);
  assert.deepEqual(forwarded, [payload]);
});

test("array payload is unwrapped and every event reaches its conversation", async () => {
  const { env, forwarded } = harness();
  const first = webhook(1);
  const second = { ...webhook(2), thread_uid: "22222222-2222-4222-8222-222222222222" };
  const response = await post(env, [first, second]);
  assert.equal(response.status, 202);
  assert.deepEqual(forwarded, [first, second]);
});

test("array carrying only other actions is ignored", async () => {
  const { env, forwarded } = harness();
  const response = await post(env, [{ action: "rate_change", property_id: 744245 }]);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "ignored");
  assert.deepEqual(forwarded, []);
});

test("one invalid element rejects the batch naming field, index and code", async () => {
  const { env, forwarded } = harness();
  const response = await post(env, [
    webhook(1),
    { ...webhook(2), creation_time: "2026-10-21 10:00:00" },
  ]);
  assert.equal(response.status, 400);
  const body = await response.text();
  assert.match(body, /\[1\] creation_time:invalid_format/);
  assert.ok(!body.includes("When can we check in?"), "payload content must not be echoed");
  assert.deepEqual(forwarded, []);
});

test("missing config field is named in the 503 body", async () => {
  const { env } = harness({ TELEGRAM_CHAT_ID: undefined });
  const response = await post(env, webhook());
  assert.equal(response.status, 503);
  assert.match(await response.text(), /worker not configured: TELEGRAM_CHAT_ID/);
});

test("payload without token or signature is rejected", async () => {
  const { env } = harness();
  const response = await handleWorkerRequest(
    new Request("https://worker.test/webhook/lodgify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(webhook()),
    }),
    env,
  );
  assert.equal(response.status, 401);
});

test("conversation errors are surfaced to the caller", async () => {
  const { env } = harness();
  (env.CONVERSATIONS as unknown as { get: () => { fetch: () => Promise<Response> } }).get = () => ({
    fetch: async () => new Response("message ID conflict", { status: 409 }),
  });
  const response = await post(env, webhook());
  assert.equal(response.status, 409);
  assert.equal(await response.text(), "message ID conflict");
});
