import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_LINK_MODEL, DEFAULT_PAGE_MODEL, pickModel } from "./modelIds";

afterEach(() => { delete process.env.MIRAGE_ALLOWED_MODELS; });

describe("pickModel", () => {
  it("accepts the defaults", () => {
    expect(pickModel(DEFAULT_PAGE_MODEL, DEFAULT_LINK_MODEL)).toBe(DEFAULT_PAGE_MODEL);
    expect(pickModel(DEFAULT_LINK_MODEL, DEFAULT_PAGE_MODEL)).toBe(DEFAULT_LINK_MODEL);
  });
  it("falls back for well-formed ids that are not allowed (no open spend)", () => {
    expect(pickModel("openai/gpt-5-image", DEFAULT_PAGE_MODEL)).toBe(DEFAULT_PAGE_MODEL);
  });
  it("falls back for junk", () => {
    expect(pickModel("../../etc", DEFAULT_PAGE_MODEL)).toBe(DEFAULT_PAGE_MODEL);
    expect(pickModel(undefined, DEFAULT_PAGE_MODEL)).toBe(DEFAULT_PAGE_MODEL);
  });
  it("accepts extra models listed in MIRAGE_ALLOWED_MODELS", () => {
    process.env.MIRAGE_ALLOWED_MODELS = " openai/gpt-5-image , x/y ";
    expect(pickModel("openai/gpt-5-image", DEFAULT_PAGE_MODEL)).toBe("openai/gpt-5-image");
    expect(pickModel("x/y", DEFAULT_PAGE_MODEL)).toBe("x/y");
  });
});
