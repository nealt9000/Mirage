// HMAC signatures for page images. /api/page signs every image it returns;
// /api/links and reference images sent back to /api/page must carry a valid
// signature, so the endpoints only ever process images this server drew.
// Key: MIRAGE_SIGNING_SECRET, else the OpenRouter key (never sent anywhere).

import { createHmac, timingSafeEqual } from "node:crypto";

function signingKey(): string {
  return process.env.MIRAGE_SIGNING_SECRET || process.env.OPENROUTER_API_KEY || "";
}

export function signImage(image: string): string {
  const key = signingKey();
  if (!key) return "";
  return createHmac("sha256", key).update(image).digest("base64url");
}

export function verifyImage(image: string, sig: unknown): boolean {
  if (typeof sig !== "string" || !sig) return false;
  const expected = signImage(image);
  if (!expected) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
