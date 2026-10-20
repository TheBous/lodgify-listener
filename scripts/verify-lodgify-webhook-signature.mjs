#!/usr/bin/env node
/**
 * Check that a Lodgify secret matches ms-signature for a captured raw JSON body.
 *
 * Usage:
 *   LODGIFY_WEBHOOK_SECRET=... node scripts/verify-lodgify-webhook-signature.mjs \
 *     --body /tmp/webhook-body.json \
 *     --signature 'sha256=75CA3771...'
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
let bodyPath = "";
let signature = process.env.MS_SIGNATURE ?? "";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--body") bodyPath = args[++i] ?? "";
  if (args[i] === "--signature") signature = args[++i] ?? "";
}
const secret = process.env.LODGIFY_WEBHOOK_SECRET;
if (!secret?.trim()) {
  console.error("Set LODGIFY_WEBHOOK_SECRET");
  process.exit(1);
}
if (!bodyPath || !signature) {
  console.error(
    "Usage: LODGIFY_WEBHOOK_SECRET=... node scripts/verify-lodgify-webhook-signature.mjs --body file.json --signature 'sha256=...'",
  );
  process.exit(1);
}

const raw = readFileSync(bodyPath, "utf8");
const provided = signature
  .trim()
  .replace(/^sha256=/i, "")
  .toUpperCase();
const expected = createHmac("sha256", secret.trim())
  .update(raw, "utf8")
  .digest("hex")
  .toUpperCase();
const ok =
  provided.length === expected.length &&
  timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
console.log(ok ? "OK signature matches secret" : "FAIL signature does not match secret");
process.exit(ok ? 0 : 1);
