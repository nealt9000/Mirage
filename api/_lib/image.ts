// Data-URI helpers for page images: size capping (Vercel's 4.5 MB body
// limit applies to responses and to the reference/scan requests that send
// the image back) and cropping for point resolve. sharp is loaded lazily.

import type { Point } from "../../src/types";
import { cropRect, type CropRect } from "./crop.js";

/** ~2.6 MB binary: leaves room for the image to travel back in a request. */
export const MAX_IMAGE_CHARS = 3_500_000;
const MAX_INPUT_CHARS = 6_000_000;
const DATA_URI_RE = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i;

export function isImageDataUri(v: unknown): v is string {
  return typeof v === "string" && v.length <= MAX_INPUT_CHARS && DATA_URI_RE.test(v);
}

export function decodeDataUri(uri: string): { mime: string; buf: Buffer } | null {
  const m = DATA_URI_RE.exec(uri);
  if (!m) return null;
  return { mime: m[1].toLowerCase(), buf: Buffer.from(m[2], "base64") };
}

async function loadSharp() {
  return (await import("sharp")).default;
}

const toDataUri = (mime: string, buf: Buffer) => `data:${mime};base64,${buf.toString("base64")}`;

export async function shrinkIfLarge(dataUri: string): Promise<string> {
  if (dataUri.length <= MAX_IMAGE_CHARS) return dataUri;
  const decoded = decodeDataUri(dataUri);
  if (!decoded) return dataUri;
  const sharp = await loadSharp();
  let out = await sharp(decoded.buf).jpeg({ quality: 82 }).toBuffer();
  if (Math.ceil(out.length / 3) * 4 > MAX_IMAGE_CHARS - 32) {
    out = await sharp(decoded.buf)
      .resize({ width: 1280, withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();
  }
  return toDataUri("image/jpeg", out);
}

export async function cropAround(
  dataUri: string,
  point: Point
): Promise<{ crop: string; rect: CropRect; width: number; height: number }> {
  const decoded = decodeDataUri(dataUri);
  if (!decoded) throw new Error("not an image data URI");
  const sharp = await loadSharp();
  const { width, height } = await sharp(decoded.buf).metadata();
  if (!width || !height) throw new Error("image has no dimensions");
  const rect = cropRect(point, width, height);
  const out = await sharp(decoded.buf).extract(rect).png().toBuffer();
  return { crop: toDataUri("image/png", out), rect, width, height };
}
