import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { cropAround, decodeDataUri, isImageDataUri, MAX_IMAGE_CHARS, shrinkIfLarge } from "./image";

async function pngDataUri(width: number, height: number, noise = false): Promise<string> {
  const img = sharp({
    create: {
      width, height, channels: 3, background: { r: 200, g: 100, b: 50 },
      ...(noise ? { noise: { type: "gaussian" as const, mean: 128, sigma: 60 } } : {}),
    },
  });
  return `data:image/png;base64,${(await img.png().toBuffer()).toString("base64")}`;
}

describe("data URIs", () => {
  it("recognises image data URIs only", () => {
    expect(isImageDataUri("data:image/png;base64,AAAA")).toBe(true);
    expect(isImageDataUri("data:text/html;base64,AAAA")).toBe(false);
    expect(isImageDataUri("https://example.com/a.png")).toBe(false);
    expect(isImageDataUri(42)).toBe(false);
  });
  it("decodes mime and bytes", () => {
    const d = decodeDataUri("data:image/PNG;base64,AAEC");
    expect(d?.mime).toBe("image/png");
    expect([...d!.buf]).toEqual([0, 1, 2]);
    expect(decodeDataUri("nope")).toBeNull();
  });
});

describe("shrinkIfLarge", () => {
  it("passes small images through untouched", async () => {
    const uri = await pngDataUri(64, 48);
    expect(await shrinkIfLarge(uri)).toBe(uri);
  });
  it("re-encodes a large image under the cap", async () => {
    const uri = await pngDataUri(1600, 1200, true);
    expect(uri.length).toBeGreaterThan(MAX_IMAGE_CHARS);
    const out = await shrinkIfLarge(uri);
    expect(out.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(MAX_IMAGE_CHARS);
  });
});

describe("cropAround", () => {
  it("crops 30% x 20% around the point", async () => {
    const uri = await pngDataUri(1000, 800);
    const { crop, rect, width, height } = await cropAround(uri, { x: 500, y: 500 });
    expect({ width, height }).toEqual({ width: 1000, height: 800 });
    expect(rect).toEqual({ left: 350, top: 320, width: 300, height: 160 });
    const meta = await sharp(decodeDataUri(crop)!.buf).metadata();
    expect([meta.width, meta.height]).toEqual([300, 160]);
  });
});
