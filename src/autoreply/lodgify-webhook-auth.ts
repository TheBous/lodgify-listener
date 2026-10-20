import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_HEADER = "ms-signature";

export function verifyLodgifyWebhookSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  if (!signatureHeader?.trim()) return false;
  const provided = parseMsSignature(signatureHeader);
  if (!provided) return false;
  const expected = hmacSha256Hex(secret.trim(), rawBody);
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function webhookAuthorized(options: {
  token: string | null | undefined;
  webhookToken: string;
  lodgifySecret: string | undefined;
  rawBody: string;
  msSignature: string | null;
}): boolean {
  if (authorizedToken(options.token, options.webhookToken)) return true;
  if (!options.lodgifySecret?.trim()) return false;
  return verifyLodgifyWebhookSignature(
    options.lodgifySecret.trim(),
    options.rawBody,
    options.msSignature,
  );
}

export function extractWebhookToken(request: Request, url: URL): string | null {
  return (
    url.searchParams.get("token") ??
    request.headers.get("authorization")?.replace(/^Bearer /i, "") ??
    null
  );
}

export function msSignatureHeader(request: Request): string | null {
  return request.headers.get(SIGNATURE_HEADER);
}

function authorizedToken(actual: string | null | undefined, expected: string): boolean {
  if (!actual) return false;
  const provided = Buffer.from(actual);
  const wanted = Buffer.from(expected);
  return provided.length === wanted.length && timingSafeEqual(provided, wanted);
}

function parseMsSignature(header: string): string | null {
  const match = /^sha256=(.+)$/i.exec(header.trim());
  if (!match?.[1]) return null;
  return match[1].trim().toUpperCase();
}

function hmacSha256Hex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message, "utf8").digest("hex").toUpperCase();
}

/** Safe diagnostics for Cloudflare logs (no secrets or body). */
export function webhookAuthDebug(options: {
  token: string | null | undefined;
  webhookToken: string;
  lodgifySecret: string | undefined;
  msSignature: string | null;
}): string {
  const hasToken = Boolean(options.token?.length);
  const hasSecret = Boolean(options.lodgifySecret?.trim());
  const hasSig = Boolean(options.msSignature?.trim());
  if (hasToken) return "token_mismatch";
  if (!hasSecret && hasSig) return "missing_lodgify_webhook_secret";
  if (hasSecret && hasSig) return "signature_mismatch";
  if (!hasSecret && !hasSig) return "missing_token_and_secret";
  return "unauthorized";
}
