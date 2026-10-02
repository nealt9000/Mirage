import { describe, expect, it } from "vitest";
import { cropBoxToFull, cropRect, pointInCrop } from "./crop";

describe("cropRect", () => {
  it("centres a 30% x 20% window on the point", () => {
    expect(cropRect({ x: 500, y: 500 }, 1000, 1000)).toEqual({ left: 350, top: 400, width: 300, height: 200 });
  });
  it("clamps at the top-left corner", () => {
    expect(cropRect({ x: 0, y: 0 }, 1000, 1000)).toEqual({ left: 0, top: 0, width: 300, height: 200 });
  });
  it("clamps at the bottom-right corner", () => {
    expect(cropRect({ x: 1000, y: 1000 }, 1000, 1000)).toEqual({ left: 700, top: 800, width: 300, height: 200 });
  });
  it("clamps out-of-range points", () => {
    expect(cropRect({ x: -50, y: 5000 }, 1000, 1000)).toEqual({ left: 0, top: 800, width: 300, height: 200 });
  });
});

describe("pointInCrop", () => {
  it("is the centre for an unclamped crop", () => {
    const p = { x: 500, y: 500 };
    expect(pointInCrop(p, cropRect(p, 1000, 1000), 1000, 1000)).toEqual({ x: 500, y: 500 });
  });
  it("reports the true location when the crop was clamped", () => {
    const tl = { x: 0, y: 0 };
    expect(pointInCrop(tl, cropRect(tl, 1000, 1000), 1000, 1000)).toEqual({ x: 0, y: 0 });
    const br = { x: 1000, y: 1000 };
    expect(pointInCrop(br, cropRect(br, 1000, 1000), 1000, 1000)).toEqual({ x: 1000, y: 1000 });
  });
});

describe("cropBoxToFull", () => {
  const crop = { left: 350, top: 400, width: 300, height: 200 };
  it("maps the whole crop to its full-image box", () => {
    expect(cropBoxToFull([0, 0, 1000, 1000], crop, 1000, 1000)).toEqual([400, 350, 600, 650]);
  });
  it("maps the crop centre to the full-image point", () => {
    expect(cropBoxToFull([500, 500, 500, 500], crop, 1000, 1000)).toEqual([500, 500, 500, 500]);
  });
});
