import { describe, expect, it } from "vitest";
import { deriveMeta, siteKeyOf, slugify } from "./pageMeta";
import type { PageRequest } from "./types";

const none = { url: null, title: null };
const site = { url: "www.cheese-oracle.net/home", title: "The Cheese Oracle" };
const ref = "data:image/png;base64,AAAA";

describe("slugify", () => {
  it("lowercases and dashes", () => expect(slugify("  Hello, World!  ")).toBe("hello-world"));
  it("falls back to 'page' when nothing is left", () => expect(slugify("🧀🧀")).toBe("page"));
  it("caps at 40 chars without a trailing dash", () => {
    const s = slugify("a".repeat(100));
    expect(s).toHaveLength(40);
    expect(slugify("abcdefghij ".repeat(5)).endsWith("-")).toBe(false);
  });
});

describe("siteKeyOf", () => {
  it("strips protocol, www, path and case", () => {
    expect(siteKeyOf("https://WWW.Cheese-Oracle.net/home?x=1")).toBe("cheese-oracle.net");
  });
});

describe("deriveMeta", () => {
  it("uses the model's metadata when present, minus protocol", () => {
    const req: PageRequest = { mode: "typed", input: "moon pizza" };
    expect(deriveMeta(req, { url: "https://www.moon-pizza.com/", title: "Moon Pizza" }))
      .toEqual({ url: "www.moon-pizza.com/", title: "Moon Pizza" });
  });

  it("typed: keeps a domain-looking input as the url", () => {
    const req: PageRequest = { mode: "typed", input: "Moon-Pizza.com/menu" };
    expect(deriveMeta(req, none)).toEqual({ url: "Moon-Pizza.com/menu", title: "Moon-Pizza.com/menu" });
  });

  it("typed: invents a domain from a phrase", () => {
    const req: PageRequest = { mode: "typed", input: "best pizza on the moon" };
    expect(deriveMeta(req, none)).toEqual({ url: "www.best-pizza-on-the-moon.com", title: "best pizza on the moon" });
  });

  it("typed: empty input becomes the portal", () => {
    expect(deriveMeta({ mode: "typed", input: "" }, none)).toEqual({ url: "www.portal.com", title: "Portal" });
  });

  it("internal: slug of the label under the current site", () => {
    const req: PageRequest = { mode: "internal", site, label: "Aged Prophecies", dest: "x", referenceImage: ref, referenceSig: "s" };
    expect(deriveMeta(req, none)).toEqual({ url: "www.cheese-oracle.net/aged-prophecies", title: "Aged Prophecies" });
  });

  it("external: a fresh domain, not under the current site", () => {
    const req: PageRequest = { mode: "external", label: "Visit our friends at Gravity Outlet!", dest: "x" };
    const meta = deriveMeta(req, none);
    expect(meta.url).toBe("www.visit-our-friends-at-gravity-outlet.com");
    expect(meta.url).not.toContain("cheese-oracle");
  });

  it("search: a query url under the current site", () => {
    const req: PageRequest = { mode: "search", site, label: "Search", query: " blue cheese ", referenceImage: ref, referenceSig: "s" };
    expect(deriveMeta(req, none)).toEqual({
      url: "www.cheese-oracle.net/search?q=blue%20cheese",
      title: "Search: blue cheese",
    });
  });

  it("treats a protocol-only url as missing", () => {
    const req: PageRequest = { mode: "external", label: "Gravity Outlet", dest: "x" };
    expect(deriveMeta(req, { url: "https://", title: null }).url).toBe("www.gravity-outlet.com");
  });
});
