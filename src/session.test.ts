import { describe, expect, it } from "vitest";
import { linkRequest, searchRequest, Session, typedRequest } from "./session";
import type { Entry, Link } from "./types";

const entry = (url: string): Entry => ({ imageDataUri: `data:image/png;base64,${url}`, imageSig: `sig-${url}`, url, title: url.toUpperCase(), links: null, siteKey: url });
const link = (over: Partial<Link> = {}): Link => ({ label: "Shop", kind: "link", dest: "the shop", external: false, box: [0, 0, 10, 10], ...over });

describe("Session", () => {
  it("starts empty", () => {
    const s = new Session();
    expect(s.current()).toBeNull();
    expect(s.canBack()).toBe(false);
    expect(s.canForward()).toBe(false);
    expect(s.back()).toBeNull();
  });

  it("moves back and forward without losing entries", () => {
    const s = new Session();
    const [a, b, c] = [entry("a"), entry("b"), entry("c")];
    s.push(a); s.push(b); s.push(c);
    expect(s.back()).toBe(b);
    expect(s.back()).toBe(a);
    expect(s.canBack()).toBe(false);
    expect(s.forward()).toBe(b);
    expect(s.current()).toBe(b);
  });

  it("drops forward history on push", () => {
    const s = new Session();
    s.push(entry("a")); s.push(entry("b"));
    s.back();
    const d = entry("d");
    s.push(d);
    expect(s.current()).toBe(d);
    expect(s.canForward()).toBe(false);
    expect(s.back()?.url).toBe("a");
  });
});

describe("request builders", () => {
  it("typed", () => {
    expect(typedRequest("moon.com")).toEqual({ mode: "typed", input: "moon.com" });
  });
  it("internal link carries site and reference image", () => {
    const from = entry("cheese.net");
    expect(linkRequest(from, link())).toEqual({
      mode: "internal", site: { url: "cheese.net", title: "CHEESE.NET" }, label: "Shop", dest: "the shop", referenceImage: from.imageDataUri, referenceSig: from.imageSig,
    });
  });
  it("external link carries only label and dest", () => {
    expect(linkRequest(entry("cheese.net"), link({ external: true }))).toEqual({ mode: "external", label: "Shop", dest: "the shop" });
  });
  it("search carries site, input label, query and reference image", () => {
    const from = entry("cheese.net");
    expect(searchRequest(from, link({ kind: "input", label: "Search" }), "brie")).toEqual({
      mode: "search", site: { url: "cheese.net", title: "CHEESE.NET" }, label: "Search", query: "brie", referenceImage: from.imageDataUri, referenceSig: from.imageSig,
    });
  });
});
