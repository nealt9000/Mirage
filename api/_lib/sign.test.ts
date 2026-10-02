import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signImage, verifyImage } from "./sign";

const IMG = "data:image/png;base64,iVBORw0KGgo=";

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
  delete process.env.MIRAGE_SIGNING_SECRET;
});
afterEach(() => { delete process.env.MIRAGE_SIGNING_SECRET; });

describe("image signatures", () => {
  it("verifies its own signature", () => {
    expect(verifyImage(IMG, signImage(IMG))).toBe(true);
  });
  it("rejects a signature for a different image", () => {
    expect(verifyImage(IMG + "A", signImage(IMG))).toBe(false);
  });
  it("rejects missing or junk signatures", () => {
    for (const s of [undefined, null, "", "abc", 42]) expect(verifyImage(IMG, s)).toBe(false);
  });
  it("prefers MIRAGE_SIGNING_SECRET over the API key", () => {
    const withApiKey = signImage(IMG);
    process.env.MIRAGE_SIGNING_SECRET = "another-secret";
    expect(signImage(IMG)).not.toBe(withApiKey);
    expect(verifyImage(IMG, withApiKey)).toBe(false);
  });
  it("never verifies when no key is configured", () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(signImage(IMG)).toBe("");
    expect(verifyImage(IMG, "")).toBe(false);
  });
});
