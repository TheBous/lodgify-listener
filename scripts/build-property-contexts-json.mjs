#!/usr/bin/env node
/**
 * Build PROPERTY_CONTEXTS_JSON for Wrangler from property-context.md + host-faq-context.md.
 *
 * Usage: node scripts/build-property-contexts-json.mjs <propertyId> [outFile]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const propertyId = process.argv[2];
const outFile = process.argv[3] ?? "/tmp/lodgify-contexts.json";

if (!propertyId || !/^[1-9]\d*$/.test(propertyId)) {
  console.error("Usage: node scripts/build-property-contexts-json.mjs <propertyId> [outFile]");
  process.exit(1);
}

function readOptional(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function merge(base, appendix) {
  const extra = appendix.trim();
  if (!extra) return base;
  if (!base.trim()) return extra;
  return `${base.trimEnd()}\n\n${extra}\n`;
}

const manual = merge(
  readOptional(join(root, "data/property-context.md")),
  readOptional(join(root, "data/host-faq-context.md")),
);

if (!manual.trim()) {
  console.error("Empty manual: add data/property-context.md and/or data/host-faq-context.md");
  process.exit(1);
}

if (manual.length > 40_000) {
  console.error(`Manual too large for Worker secret (${manual.length} > 40000 chars)`);
  process.exit(1);
}

writeFileSync(outFile, JSON.stringify({ [propertyId]: manual }));
console.log(`Wrote ${outFile} (${manual.length} chars)`);
