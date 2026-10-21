#!/usr/bin/env node
/**
 * Validate .dev.vars (or env) against the same rules as the Worker.
 * Usage: node scripts/check-worker-config.mjs [.dev.vars]
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const path = process.argv[2] ?? join(root, ".dev.vars");

function parseDotEnv(text) {
  const env = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

const configSchema = z.object({
  LODGIFY_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).optional(),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().min(1),
  WEBHOOK_TOKEN: z.string().min(32),
  LODGIFY_WEBHOOK_SECRET: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().min(16).optional(),
  ),
  ADMIN_TOKEN: z.string().min(32),
  PROPERTY_CONTEXTS_JSON: z
    .string()
    .transform((value, ctx) => {
      try {
        return JSON.parse(value);
      } catch {
        ctx.addIssue({ code: "custom", message: "Invalid property context JSON" });
        return z.NEVER;
      }
    })
    .pipe(z.record(z.string().regex(/^[1-9]\d*$/), z.string().trim().min(1).max(40_000))),
  AUTO_REPLY_ENABLED: z.enum(["true", "false"]).optional(),
});

let env;
try {
  env = parseDotEnv(readFileSync(path, "utf8"));
} catch {
  console.error(`Cannot read ${path} — copy .dev.vars.example to .dev.vars first.`);
  process.exit(1);
}

const parsed = configSchema.safeParse(env);
if (parsed.success) {
  console.log("OK — config matches Worker requirements.");
  const keys = Object.keys(JSON.parse(env.PROPERTY_CONTEXTS_JSON));
  console.log(`Property IDs in manual: ${keys.join(", ")}`);
  process.exit(0);
}

console.error("Config invalid (same checks as production 503):");
for (const issue of parsed.error.issues) {
  console.error(`- ${issue.path.join(".") || "(root)"}: ${issue.message}`);
}
process.exit(1);
