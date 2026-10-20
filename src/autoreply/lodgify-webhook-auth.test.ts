import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  extractWebhookToken,
  verifyLodgifyWebhookSignature,
  webhookAuthorized,
} from "./lodgify-webhook-auth.js";

test("verifyLodgifyWebhookSignature accepts documented HMAC format", () => {
  const body = '{"action":"guest_message_received","message":"hi"}';
  const secret = "lodgify-endpoint-secret";
  const valid = verifyLodgifyWebhookSignature(secret, body, `sha256=${sign(secret, body)}`);
  assert.equal(valid, true);
  assert.equal(verifyLodgifyWebhookSignature(secret, body, "sha256=deadbeef"), false);
  assert.equal(
    verifyLodgifyWebhookSignature(secret, `${body} `, `sha256=${sign(secret, body)}`),
    false,
  );
});

test("webhookAuthorized prefers shared token but accepts ms-signature", () => {
  const body = '{"ok":true}';
  const secret = "endpoint-secret-from-subscribe";
  const header = `sha256=${sign(secret, body)}`;
  assert.equal(
    webhookAuthorized({
      token: "test-secret-which-is-at-least-32-characters",
      webhookToken: "test-secret-which-is-at-least-32-characters",
      lodgifySecret: secret,
      rawBody: body,
      msSignature: header,
    }),
    true,
  );
  assert.equal(
    webhookAuthorized({
      token: null,
      webhookToken: "test-secret-which-is-at-least-32-characters",
      lodgifySecret: secret,
      rawBody: body,
      msSignature: header,
    }),
    true,
  );
  assert.equal(
    webhookAuthorized({
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

function sign(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message, "utf8").digest("hex").toUpperCase();
}
