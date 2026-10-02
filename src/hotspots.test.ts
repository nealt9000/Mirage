import { describe, expect, it } from "vitest";
import { boxToRect, containRect, hitTest, pixelToPoint } from "./hotspots";
import type { Link } from "./types";

const link = (label: string, box: Link["box"]): Link => ({ label, kind: "link", dest: label, external: false, box });

describe("containRect", () => {
  it("letterboxes a wide container", () => {
    const r = containRect(1000, 500, 400, 300);
    expect(r.width).toBeCloseTo(666.667, 2);
    expect(r.height).toBeCloseTo(500);
    expect(r.left).toBeCloseTo(166.667, 2);
    expect(r.top).toBe(0);
  });
  it("letterboxes a tall container", () => {
    expect(containRect(400, 900, 400, 300)).toEqual({ left: 0, top: 300, width: 400, height: 300 });
  });
  it("falls back to the full box before the image has loaded", () => {
    expect(containRect(800, 600, 0, 0)).toEqual({ left: 0, top: 0, width: 800, height: 600 });
  });
});

describe("boxToRect", () => {
  it("scales 0-1000 [ymin,xmin,ymax,xmax] to pixels", () => {
    expect(boxToRect([100, 200, 300, 600], 800, 600)).toEqual({ left: 160, top: 60, width: 320, height: 120 });
  });
});

describe("pixelToPoint", () => {
  it("scales pixels to 0-1000", () => {
    expect(pixelToPoint(400, 300, 800, 600)).toEqual({ x: 500, y: 500 });
  });
  it("clamps outside the area", () => {
    expect(pixelToPoint(-10, 700, 800, 600)).toEqual({ x: 0, y: 1000 });
  });
  it("handles an empty area", () => {
    expect(pixelToPoint(5, 5, 0, 0)).toEqual({ x: 0, y: 0 });
  });
});

describe("hitTest", () => {
  const page = link("page", [0, 0, 1000, 1000]);
  const button = link("button", [400, 400, 600, 600]);
  it("prefers the smallest containing box", () => {
    expect(hitTest([page, button], { x: 500, y: 500 })).toBe(button);
    expect(hitTest([button, page], { x: 500, y: 500 })).toBe(button);
  });
  it("falls back to a larger box outside the small one", () => {
    expect(hitTest([page, button], { x: 100, y: 100 })).toBe(page);
  });
  it("treats edges as inside", () => {
    expect(hitTest([button], { x: 400, y: 600 })).toBe(button);
  });
  it("returns null when nothing is hit", () => {
    expect(hitTest([button], { x: 100, y: 100 })).toBeNull();
    expect(hitTest([], { x: 1, y: 1 })).toBeNull();
  });
});
