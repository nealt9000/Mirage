import { describe, expect, it } from "vitest";
import { buildPagePrompt, CONTRACT, MAX_USER_TEXT } from "./pageContract";

const site = { url: "www.cheese-oracle.net/home", title: "The Cheese Oracle" };
const ref = "data:image/png;base64,AAAA";

describe("buildPagePrompt", () => {
  it("typed: includes the contract and typed text, no reference image", () => {
    const p = buildPagePrompt({ mode: "typed", input: "moon-pizza.com" });
    expect(p.text).toContain(CONTRACT);
    expect(p.text).toContain('"moon-pizza.com"');
    expect(p.text).not.toContain("address bar."); // invites the model to draw browser chrome
    expect(p.referenceImage).toBeUndefined();
  });

  it("typed: empty input asks for a web portal homepage", () => {
    const p = buildPagePrompt({ mode: "typed", input: "   " });
    expect(p.text).toContain("web portal homepage");
    expect(p.text).not.toMatch(/browsers? (open|window)/);
    expect(p.referenceImage).toBeUndefined();
  });

  it("internal: includes site, label, dest and passes the reference image", () => {
    const p = buildPagePrompt({
      mode: "internal", site, label: "Aged Prophecies", dest: "archive of cheese predictions", referenceImage: ref,
    });
    expect(p.text).toContain("The Cheese Oracle");
    expect(p.text).toContain("www.cheese-oracle.net/home");
    expect(p.text).toContain("Aged Prophecies");
    expect(p.text).toContain("archive of cheese predictions");
    expect(p.text).toContain("same website");
    expect(p.referenceImage).toBe(ref);
  });

  it("external: includes label and dest but no site and no reference image", () => {
    const p = buildPagePrompt({ mode: "external", label: "Gravity Outlet", dest: "discount gravity store" });
    expect(p.text).toContain("Gravity Outlet");
    expect(p.text).toContain("discount gravity store");
    expect(p.text).toContain("different website");
    expect(p.text).not.toContain("same website");
    expect(p.referenceImage).toBeUndefined();
  });

  it("search: includes site, input label, query and passes the reference image", () => {
    const p = buildPagePrompt({ mode: "search", site, label: "Search prophecies", query: "brie futures", referenceImage: ref });
    expect(p.text).toContain("The Cheese Oracle");
    expect(p.text).toContain("Search prophecies");
    expect(p.text).toContain("brie futures");
    expect(p.text).toContain("results page");
    expect(p.referenceImage).toBe(ref);
  });

  it("asks for the one-line metadata JSON", () => {
    expect(CONTRACT).toContain('{"url"');
    expect(CONTRACT).toContain("no browser frame");
    expect(CONTRACT).toContain("edge to edge");
    expect(CONTRACT).toContain("no window");
    expect(CONTRACT).not.toContain("screenshot of a website"); // reads as "photo of a browser"
    expect(CONTRACT).toContain("exactly one image");
  });

  it("truncates very long user text", () => {
    const p = buildPagePrompt({ mode: "typed", input: "x".repeat(5000) });
    expect(p.text).toContain("x".repeat(MAX_USER_TEXT));
    expect(p.text).not.toContain("x".repeat(MAX_USER_TEXT + 1));
  });

  it("quotes user text safely", () => {
    const p = buildPagePrompt({ mode: "typed", input: 'say "hi"' });
    expect(p.text).toContain('"say \\"hi\\""');
  });
});
