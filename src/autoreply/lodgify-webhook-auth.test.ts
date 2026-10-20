import assert from "node:assert/strict";
import test from "node:test";
import {
  extractWebhookToken,
  verifyLodgifyWebhookSignature,
  webhookAuthorized,
} from "./lodgify-webhook-auth.js";

test("verifyLodgifyWebhookSignature accepts documented HMAC format", async () => {
  const body = '{"action":"guest_message_received","message":"hi"}';
  const secret = "lodgify-endpoint-secret";
  const valid = await verifyLodgifyWebhookSignature(
    secret,
    body,
    `sha256=${await sign(secret, body)}`,
  );
  assert.equal(valid, true);
  assert.equal(await verifyLodgifyWebhookSignature(secret, body, "sha256=deadbeef"), false);
  assert.equal(
    await verifyLodgifyWebhookSignature(secret, `${body} `, `sha256=${await sign(secret, body)}`),
    false,
  );
});

test("webhookAuthorized prefers shared token but accepts ms-signature", async () => {
  const body = '{"ok":true}';
  const secret = "endpoint-secret-from-subscribe";
  const header = `sha256=${await sign(secret, body)}`;
  assert.equal(
    await webhookAuthorized({
      token: "test-secret-which-is-at-least-32-characters",
      webhookToken: "test-secret-which-is-at-least-32-characters",
      lodgifySecret: secret,
      rawBody: body,
      msSignature: header,
    }),
    true,
  );
  assert.equal(
    await webhookAuthorized({
      token: null,
      webhookToken: "test-secret-which-is-at-least-32-characters",
      lodgifySecret: secret,
      rawBody: body,
      msSignature: header,
    }),
    true,
  );
  assert.equal(
    await webhookAuthorized({
      token: null,
      webhookToken: "test-secret-which-is-at-least-32-characters",
      lodgifySecret: undefined,
      rawBody: body,
      msSignature: header,
    }),
    false,
  );
});

test("extractWebhookToken reads query or bearer", () => {
  const url = new URL("https://host/webhook/lodgify?token=abc");
  const req = new Request(url, { headers: { authorization: "Bearer def" } });
  assert.equal(extractWebhookToken(req, url), "abc");
  assert.equal(
    extractWebhookToken(
      new Request("https://host/webhook/lodgify"),
      new URL("https://host/webhook/lodgify"),
    ),
    null,
  );
});

async function sign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}
