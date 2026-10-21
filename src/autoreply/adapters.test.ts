import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import type { DeliveryJob } from "./contracts.js";
import { context, event, modelResponse } from "./fixtures.test.js";
import { createLodgifyMessaging } from "./lodgify.js";
import { createReplyGenerator } from "./openai.js";

test("Lodgify sends Owner notification with the same persisted idempotency key", async (t) => {
  const bodies: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(url, "https://api.lodgify.com/v1/reservation/booking/123/messages");
    bodies.push(JSON.parse(String(options.body)));
    return new Response("", { status: 200 });
  });
  const job: DeliveryJob = {
    kind: "deliver",
    events: [event()],
    decision: { escalation: "no", reply: "Hello" },
    fingerprint: "history",
    replyId: crypto.randomUUID(),
    submitted: true,
    attempts: 0,
  };
  const { send } = createLodgifyMessaging("test-api-key");
  await send(job);
  await send(job);
  assert.deepEqual(bodies[0], [
    { message: "Hello", type: "Owner", send_notification: true, message_id: job.replyId },
  ]);
  assert.deepEqual(bodies[1], bodies[0]);
});

test("rate limited reads name the endpoint and Retry-After", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("slow down", { status: 429, headers: { "retry-after": "30" } }),
  );
  const { context } = createLodgifyMessaging("test-api-key");
  await assert.rejects(
    context(event()),
    /Lodgify read failed \(429\) (booking|thread) retry-after=30s/,
  );
});

test("Lodgify context accepts the object and local timestamps returned by messaging v2", async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    const parsed = new URL(url);
    calls.push(parsed.pathname);
    if (parsed.pathname === "/v1/reservation/booking/123") {
      return Response.json({
        id: 123,
        type: "Booking",
        thread_uid: event().threadId,
        status: "Booked",
        property_id: 42,
        property_name: "Test property",
        arrival: "2026-10-15",
        departure: "2026-10-18",
        is_deleted: false,
      });
    }
    if (parsed.pathname === `/v2/messaging/${event().threadId}`) {
      return Response.json({
        thread_uid: event().threadId,
        is_closed: false,
        messages: [
          {
            type: "Renter",
            message: "Where can I eat tonight?",
            date_created: "2026-10-21T10:47:53",
            message_id: "2024bf91-27d2-2d0d-e43f-cca2ef41d406",
            message_status: "Unknown",
          },
        ],
      });
    }
    throw new Error(`Unexpected Lodgify request: ${parsed.pathname}`);
  });

  const { context } = createLodgifyMessaging("test-api-key");
  const result = await context(event());

  assert.deepEqual(calls, ["/v1/reservation/booking/123", `/v2/messaging/${event().threadId}`]);
  assert.equal(result.history.length, 1);
  assert.equal(result.history[0]?.text, "Where can I eat tonight?");
  assert.equal(result.outbound[0]?.id, "2024bf91-27d2-2d0d-e43f-cca2ef41d406");
});

test("rate limited send keeps the verify delivery warning", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("", { status: 429 }));
  const { send } = createLodgifyMessaging("test-api-key");
  await assert.rejects(
    send({
      kind: "deliver",
      events: [event()],
      decision: { escalation: "no", reply: "Hello" },
      fingerprint: "history",
      replyId: crypto.randomUUID(),
      submitted: false,
      attempts: 0,
    }),
    /Lodgify send failed \(429\) messages; verify delivery/,
  );
});

test("generator uses only matching property manual and rejects invalid or truncated replies", async (t) => {
  let output: unknown = modelResponse({ escalation: "no", reply: "Welcome — check-in at 4 PM." });
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    const request = z
      .object({
        model: z.literal("gpt-6-luna"),
        store: z.literal(false),
        reasoning: z.object({ effort: z.literal("low") }),
        text: z.object({
          format: z.object({ type: z.literal("json_schema"), strict: z.literal(true) }),
        }),
        input: z.array(z.object({ content: z.string() })),
      })
      .parse(JSON.parse(String(options.body)));
    assert.match(request.input[0]?.content ?? "", /Correct property manual/);
    assert.doesNotMatch(request.input[0]?.content ?? "", /Another property manual/);
    return Response.json(output);
  });
  const generate = createReplyGenerator({
    apiKey: "fake",
    model: "gpt-6-luna",
    propertyContexts: {
      "42": "Correct property manual",
      "43": "Another property manual",
    },
  });
  assert.equal((await generate([event()], context())).reply, "Welcome , check-in at 4 PM.");
  for (const invalid of [
    { status: "incomplete", output: [] },
    modelResponse({ escalation: "apri", reply: "opening" }),
    {
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "refusal", refusal: "Cannot comply" }],
        },
      ],
    },
    { status: "completed", output: [] },
  ]) {
    output = invalid;
    await assert.rejects(generate([event()], context()));
  }
  const missing = createReplyGenerator({
    apiKey: "fake",
    model: "gpt-6-luna",
    propertyContexts: {},
  });
  await assert.rejects(missing([event()], context()), /Missing manual/);
});
