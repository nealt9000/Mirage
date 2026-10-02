// Pure geometry for point resolve: which part of the page image to send to
// the link model, and how to map its answer back to full-image coordinates.
// Points and boxes are 0–1000; crop rects are image pixels.

import type { Box, Point } from "../../src/types";

export type CropRect = { left: number; top: number; width: number; height: number };

export const CROP_W = 0.3;
export const CROP_H = 0.2;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A CROP_W × CROP_H window centred on the point, clamped inside the image. */
export function cropRect(point: Point, imgW: number, imgH: number): CropRect {
  const width = Math.max(1, Math.round(imgW * CROP_W));
  const height = Math.max(1, Math.round(imgH * CROP_H));
  const cx = (clamp(point.x, 0, 1000) / 1000) * imgW;
  const cy = (clamp(point.y, 0, 1000) / 1000) * imgH;
  return {
    left: clamp(Math.round(cx - width / 2), 0, imgW - width),
    top: clamp(Math.round(cy - height / 2), 0, imgH - height),
    width,
    height,
  };
}

/** Where the clicked point sits inside the crop, 0–1000 (not always the centre). */
export function pointInCrop(point: Point, crop: CropRect, imgW: number, imgH: number): Point {
  const px = (clamp(point.x, 0, 1000) / 1000) * imgW;
  const py = (clamp(point.y, 0, 1000) / 1000) * imgH;
  return {
    x: Math.round(clamp((px - crop.left) / crop.width, 0, 1) * 1000),
    y: Math.round(clamp((py - crop.top) / crop.height, 0, 1) * 1000),
  };
}

/** A box in crop space (0–1000) → the same box in full-image space (0–1000). */
export function cropBoxToFull(box: Box, crop: CropRect, imgW: number, imgH: number): Box {
  const y = (v: number) => Math.round(((crop.top + (v / 1000) * crop.height) / imgH) * 1000);
  const x = (v: number) => Math.round(((crop.left + (v / 1000) * crop.width) / imgW) * 1000);
  return [y(box[0]), x(box[1]), y(box[2]), x(box[3])];
}
