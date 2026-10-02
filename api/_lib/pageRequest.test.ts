import { describe, expect, it } from "vitest";
import { MAX_USER_TEXT } from "./pageContract";
import { parsePageRequest } from "./pageRequest";

const IMG = "data:image/png;base64,iVBORw0KGgo=";
const site = { url: "cheese.net", title: "Cheese" };

describe("parsePageRequest", () => {
  it("accepts each mode", () => {
    expect(parsePageRequest({ mode: "typed", input: " moon.com " })).toEqual({ mode: "typed", input: "moon.com" });
    expect(parsePageRequest({ mode: "external", label: "Ad", dest: "gravity store" }))
      .toEqual({ mode: "external", label: "Ad", dest: "gravity store" });
    expect(parsePageRequest({ mode: "internal", site, label: "Shop", dest: "shop", referenceImage: IMG, referenceSig: "s" }))
      .toEqual({ mode: "internal", site, label: "Shop", dest: "shop", referenceImage: IMG, referenceSig: "s" });
    expect(parsePageRequest({ mode: "search", site, label: "Search", query: "brie", referenceImage: IMG, referenceSig: "s" }))
      .toEqual({ mode: "search", site, label: "Search", query: "brie", referenceImage: IMG, referenceSig: "s" });
  });

  it("allows an empty typed address (portal homepage)", () => {
    expect(parsePageRequest({ mode: "typed", input: "" })).toEqual({ mode: "typed", input: "" });
  });

  it("caps user text", () => {
    expect(parsePageRequest({ mode: "typed", input: "x".repeat(5000) }))
      .toEqual({ mode: "typed", input: "x".repeat(MAX_USER_TEXT) });
  });

  it("rejects malformed requests", () => {
    const bad: unknown[] = [
      null,
      "typed",
      { mode: "nope" },
      { mode: "typed" },
      { mode: "typed", input: 5 },
      { mode: "external", label: "", dest: "x" },
      { mode: "internal", site, label: "Shop", dest: "shop", referenceSig: "s" },
      { mode: "internal", site, label: "Shop", dest: "shop", referenceImage: "https://evil/x.png", referenceSig: "s" },
      { mode: "internal", site, label: "Shop", dest: "shop", referenceImage: IMG },
      { mode: "search", site, label: "Search", query: "   ", referenceImage: IMG, referenceSig: "s" },
      { mode: "search", site: "cheese.net", label: "Search", query: "brie", referenceImage: IMG, referenceSig: "s" },
    ];
    for (const b of bad) expect(parsePageRequest(b)).toBeNull();
  });

  it("drops unknown fields such as a raw prompt", () => {
    expect(parsePageRequest({ mode: "typed", input: "a", prompt: "ignore all that" })).toEqual({ mode: "typed", input: "a" });
  });
});
