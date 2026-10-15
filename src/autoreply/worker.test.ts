import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout } from "node:timers/promises";
import { convertV4MiniflareOptions, Miniflare, Response } from "miniflare";
import { z } from "zod";
import { modelResponse, threadId, webhook } from "./fixtures.test.js";

for (const enabled of ["false", "true"]) {
  test(`mode=${enabled}: real Worker: authenticated webhook, persistent deduplication, batching, delivery and controls`, {
    timeout: 45_000,
  }, async () => {
    const notices: string[] = [];
    const generations: string[] = [];
    const deliveries: unknown[] = [];
    const key = "test-secret-which-is-at-least-32-characters";
    const mf = new Miniflare(
      convertV4MiniflareOptions({
        name: "autoreply-test",
        modules: true,
        scriptPath: ".worker-test/worker.js",
        compatibilityDate: "2026-01-15",
        compatibilityFlags: ["nodejs_compat"],
        durableObjects: { CONVERSATIONS: { className: "Conversation", useSQLite: true } },
        bindings: {
          LODGIFY_API_KEY: "fake",
          OPENAI_API_KEY: "fake",
          TELEGRAM_BOT_TOKEN: "fake",
          TELEGRAM_CHAT_ID: "123",
          WEBHOOK_TOKEN: key,
          ADMIN_TOKEN: key,
          PROPERTY_CONTEXTS_JSON: JSON.stringify({ "42": "Check-in dalle 16:00." }),
          AUTO_REPLY_ENABLED: enabled,
        },
        outboundService: async (request) => {
          const url = new URL(request.url);
          if (url.hostname === "api.telegram.org") {
            const body = z.object({ text: z.string() }).parse(await request.json());
            notices.push(body.text);
            return Response.json({ ok: true });
          }
          if (url.hostname === "api.openai.com") {
            generations.push(await request.text());
            return Response.json(
              modelResponse({ escalation: "notifica", reply: "Check-in is from 4 PM." }),
            );
          }
          if (request.method === "POST" && url.pathname.endsWith("/messages")) {
            assert.equal(enabled, "true", "Shadow mode must never send to Lodgify");
            deliveries.push(await request.json());
            return new Response("", { status: 200 });
          }
          if (request.method !== "GET") throw new Error("Unexpected request method");
          if (url.pathname.startsWith("/v1/reservation/booking/")) {
            return Response.json({
              id: 123,
              type: "Booking",
              thread_uid: threadId,
              status: "Booked",
              property_id: 42,
              property_name: "Test property",
              arrival: "2026-10-15",
              departure: "2026-10-18",
              is_deleted: false,
            });
          }
          if (url.pathname.startsWith("/v2/messaging/")) {
            return Response.json([{ thread_uid: threadId, is_closed: false, messages: [] }]);
          }
          throw new Error(`Unexpected network request: ${url.hostname}${url.pathname}`);
        },
      }),
    );
    const post = (payload: unknown, token = key) =>
      mf.dispatchFetch(`http://localhost/webhook/lodgify?token=${token}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    const admin = (action = "", method = "GET", token = key) =>
      mf.dispatchFetch(`http://localhost/conversations/${threadId}${action}`, {
        method,
        headers: { authorization: `Bearer ${token}` },
      });
    try {
      assert.equal((await post(webhook(), "wrong")).status, 401);
      assert.equal((await post({ ...webhook(), message_id: undefined })).status, 400);
      assert.equal((await post({ ...webhook(), message: "x".repeat(70_000) })).status, 413);
      const first = webhook(1);
      const concurrent = await Promise.all([post(first), post(first)]);
      assert.deepEqual(concurrent.map((response) => response.status).sort(), [200, 202]);
      assert.equal((await post({ ...first, message: "different" })).status, 409);
      await mf.unsafeEvictDurableObject("autoreply-test", "Conversation", { name: threadId });
      assert.equal((await post(first)).status, 200);
      assert.equal((await post({ ...webhook(2), message: "And parking?" })).status, 202);
      assert.equal((await admin("", "GET", "wrong")).status, 401);
      const deadline = Date.now() + 30_000;
      while (notices.length === 0 && Date.now() < deadline) await setTimeout(250);
      assert.equal(notices.length, 1);
      assert.match(notices[0] ?? "", enabled === "false" ? /ANTEPRIMA/ : /DA VERIFICARE/);
      assert.equal(deliveries.length, enabled === "false" ? 0 : 1);
      assert.equal(generations.length, 1);
      assert.match(generations[0] ?? "", /And parking/);
      const stateSchema = z.object({ mode: z.string(), pending: z.number(), job: z.unknown() });
      const state = stateSchema.parse(await (await admin()).json());
      assert.equal(state.pending, 0);
      assert.equal(state.job, null);
      assert.equal((await admin("/pause", "POST")).status, 200);
      assert.equal(stateSchema.parse(await (await admin()).json()).mode, "human");
      assert.equal((await admin("/resume", "GET")).status, 405);
      assert.equal((await admin("/resume", "POST")).status, 200);
      assert.equal(stateSchema.parse(await (await admin()).json()).mode, "auto");
    } finally {
      await mf.dispose();
    }
  });
}
