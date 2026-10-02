import { describe, expect, it } from "vitest";
import { parseJsonLoose, parseLinks, parsePointLink, toBox, toPoint } from "./links";

const item = (over: Record<string, unknown> = {}) => ({
  label: "Shop", kind: "link", dest: "the shop", external: false, box_2d: [10, 20, 30, 40], ...over,
});

describe("parseLinks", () => {
  it("parses a plain array", () => {
    expect(parseLinks(JSON.stringify([item()]))).toEqual([
      { label: "Shop", kind: "link", dest: "the shop", external: false, box: [10, 20, 30, 40] },
    ]);
  });
  it("strips markdown fences", () => {
    expect(parseLinks("```json\n" + JSON.stringify([item()]) + "\n```")).toHaveLength(1);
  });
  it("finds JSON inside prose", () => {
    expect(parseLinks("Here are the links:\n" + JSON.stringify([item(), item()]) + "\nHope that helps!")).toHaveLength(2);
  });
  it("accepts a {links: [...]} wrapper and a 'box' key", () => {
    expect(parseLinks(JSON.stringify({ links: [item({ box_2d: undefined, box: [1, 2, 3, 4] })] }))[0].box).toEqual([1, 2, 3, 4]);
  });
  it("salvages a truncated array", () => {
    const full = JSON.stringify([item({ label: "A" }), item({ label: "B" }), item({ label: "C" })]);
    const truncated = full.slice(0, full.lastIndexOf('{"label":"C"') + 15);
    expect(parseLinks(truncated).map((l) => l.label)).toEqual(["A", "B"]);
  });
  it("keeps every entry when junk sits between them", () => {
    // Real gemini-3-flash-preview output: a stray quote after the 2nd entry.
    const text = "[\n" + JSON.stringify(item({ label: "A" })) + ",\n" + JSON.stringify(item({ label: "B" })) + ', "\n' +
      JSON.stringify(item({ label: "C" })) + ",\n" + JSON.stringify(item({ label: "D" })) + "\n]";
    expect(parseLinks(text).map((l) => l.label)).toEqual(["A", "B", "C", "D"]);
  });
  it("drops malformed entries but keeps the rest", () => {
    const text = JSON.stringify([
      item({ label: "" }),
      item({ box_2d: [1, 2, 3] }),
      item({ box_2d: ["1", "2", "3", "4"] }),
      item({ box_2d: [30, 20, 10, 40] }),
      "nonsense",
      null,
      item({ label: "Keep" }),
    ]);
    expect(parseLinks(text).map((l) => l.label)).toEqual(["Keep"]);
  });
  it("defaults kind, dest and external", () => {
    const [l] = parseLinks(JSON.stringify([{ label: "Go", kind: "portal", external: "yes", box_2d: [0, 0, 10, 10] }]));
    expect(l).toMatchObject({ kind: "link", dest: "Go", external: false });
  });
  it("clamps boxes into 0-1000", () => {
    expect(parseLinks(JSON.stringify([item({ box_2d: [-5, 10, 1200, 900] })]))[0].box).toEqual([0, 10, 1000, 900]);
  });
  it("returns [] for garbage", () => {
    expect(parseLinks("I cannot see any links.")).toEqual([]);
    expect(parseLinks("")).toEqual([]);
  });
});

describe("parsePointLink", () => {
  it("parses a single object", () => {
    expect(parsePointLink(JSON.stringify(item()))?.label).toBe("Shop");
  });
  it("returns null for a JSON null", () => {
    expect(parsePointLink("null")).toBeNull();
    expect(parsePointLink("```json\nnull\n```")).toBeNull();
  });
  it("takes the first element of an array", () => {
    expect(parsePointLink(JSON.stringify([item({ label: "First" }), item()]))?.label).toBe("First");
  });
  it("returns null for garbage", () => {
    expect(parsePointLink("nothing here")).toBeNull();
  });
});

describe("toBox / toPoint / parseJsonLoose", () => {
  it("rejects degenerate boxes", () => {
    expect(toBox([10, 10, 10, 20])).toBeNull();
    expect(toBox([0, 0, Number.NaN, 5])).toBeNull();
  });
  it("validates and clamps points", () => {
    expect(toPoint({ x: 1200, y: -3 })).toEqual({ x: 1000, y: 0 });
    expect(toPoint({ x: "1", y: 2 })).toBeNull();
    expect(toPoint(null)).toBeNull();
  });
  it("parses null literally", () => {
    expect(parseJsonLoose("null")).toBeNull();
  });
});
