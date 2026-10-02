import { describe, expect, it } from "vitest";
import { extractPageParts, pageBody, parseMeta } from "./pageGen";

describe("parseMeta", () => {
  it("parses a clean metadata line", () => {
    expect(parseMeta('{"url": "www.moon-pizza.com", "title": "Moon Pizza"}'))
      .toEqual({ url: "www.moon-pizza.com", title: "Moon Pizza" });
  });
  it("finds the first JSON object amid prose and fences", () => {
    const text = 'Sure!\n```json\n{"url":"a.com/x","title":"X"}\n```\n{"url":"b.com"}';
    expect(parseMeta(text)).toEqual({ url: "a.com/x", title: "X" });
  });
  it("returns nulls when the line is missing", () => {
    expect(parseMeta("Here is your page.")).toEqual({ url: null, title: null });
    expect(parseMeta("")).toEqual({ url: null, title: null });
  });
  it("returns nulls for garbage", () => {
    expect(parseMeta("{not json at all}")).toEqual({ url: null, title: null });
  });
  it("recovers fields from a line with an unterminated string", () => {
    // Real gemini-3.1-flash-lite-image output: the title's closing quote is missing.
    const text = '{"url": "omniverse.qis/portal", "title": "OmniWeb Portal | Axiom 7} {"end_turn": true}';
    expect(parseMeta(text)).toEqual({ url: "omniverse.qis/portal", title: "OmniWeb Portal | Axiom 7" });
  });
  it("keeps valid fields and drops invalid ones", () => {
    expect(parseMeta('{"url": 42, "title": "  Moon  "}')).toEqual({ url: null, title: "Moon" });
    expect(parseMeta('{"url": "   ", "title": ""}')).toEqual({ url: null, title: null });
  });
});

describe("extractPageParts", () => {
  it("pulls text, the first data-URI image, and cost", () => {
    const parts = extractPageParts({
      choices: [{ message: {
        content: '{"url":"a.com"}',
        images: [{ image_url: { url: "https://x/y.png" } }, { image_url: { url: "data:image/png;base64,AAAA" } }],
      } }],
      usage: { cost: 0.034 },
    });
    expect(parts).toEqual({ text: '{"url":"a.com"}', image: "data:image/png;base64,AAAA", costUsd: 0.034 });
  });
  it("reports a missing image as null", () => {
    expect(extractPageParts({ choices: [{ message: { content: "no pic" } }] }).image).toBeNull();
  });
});

describe("pageBody", () => {
  it("requests image+text at 4:3 and attaches the reference image", () => {
    const body = pageBody("m", "draw", "data:image/png;base64,AAAA") as any;
    expect(body.modalities).toEqual(["image", "text"]);
    expect(body.image_config).toEqual({ aspect_ratio: "4:3" });
    expect(body.messages[0].content).toEqual([
      { type: "text", text: "draw" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
    ]);
  });
  it("omits the image part without a reference", () => {
    const body = pageBody("m", "draw") as any;
    expect(body.messages[0].content).toEqual([{ type: "text", text: "draw" }]);
  });
});
