import { timingSafeEqual } from "node:crypto";

const SIGNATURE_HEADER = "ms-signature";

export async function verifyLodgifyWebhookSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  if (!signatureHeader?.trim()) return false;
  const provided = parseMsSignature(signatureHeader);
  if (!provided) return false;
  const expected = await hmacSha256Hex(secret, rawBody);
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
}): Promise<boolean> {
  if (authorizedToken(options.token, options.webhookToken)) {
    return Promise.resolve(true);
  }
  if (!options.lodgifySecret?.trim()) return Promise.resolve(false);
  return verifyLodgifyWebhookSignature(options.lodgifySecret, options.rawBody, options.msSignature);
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

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
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
