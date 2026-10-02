// Prompts and tolerant parsing for the link model. Malformed entries are
// dropped, not fatal. When the array itself is invalid (truncated, or junk
// between entries), each complete {...} entry is parsed on its own.

import type { Box, Link, LinkKind, Point } from "../../src/types";

const KINDS: readonly LinkKind[] = ["link", "button", "input", "image"];

const FIELDS =
  '{"label": visible text or a short description, "kind": "link" | "button" | "input" | "image", ' +
  '"dest": a short description of the page it leads to (for inputs: what it searches), ' +
  '"external": true only if it leads to a different website (ads, sponsors, partner badges, "visit our friends"), ' +
  '"box_2d": [ymin, xmin, ymax, xmax] normalized to 0-1000}';

export const SCAN_PROMPT =
  "This is a screenshot of a web page. List every element a visitor could click or type into: " +
  "navigation items, text links, buttons, tabs, product or article tiles, banner ads, logos that link, " +
  "and text inputs or search boxes.\n" +
  `Respond with only a JSON array, no prose. Each item: ${FIELDS}`;

export function pointPrompt(p: Point): string {
  return (
    "This is a crop of a web page screenshot. Identify the clickable element at point " +
    `(y=${p.y}, x=${p.x}) on a 0-1000 scale of this crop.\n` +
    `Respond with only JSON, no prose: null if nothing clickable is there, otherwise ${FIELDS}. ` +
    "box_2d is relative to this crop."
  );
}

export function visionBody(model: string, text: string, image: string): Record<string, unknown> {
  return {
    model,
    temperature: 0,
    messages: [{ role: "user", content: [{ type: "text", text }, { type: "image_url", image_url: { url: image } }] }],
  };
}

function stripFences(text: string): string {
  return text.replace(/```(?:json)?/gi, "").trim();
}

function tryParse(s: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch {
    return { ok: false };
  }
}

/** Parse the whole text, else the outermost JSON span; null if neither parses. */
export function parseJsonLoose(text: string): unknown {
  const s = stripFences(text);
  const whole = tryParse(s);
  if (whole.ok) return whole.value;

  const start = s.search(/[[{]/);
  if (start < 0) return null;
  const end = Math.max(s.lastIndexOf("]"), s.lastIndexOf("}"));
  if (end > start) {
    const span = tryParse(s.slice(start, end + 1));
    if (span.ok) return span.value;
  }
  return null;
}

/** Every flat {...} object that parses on its own (link entries have no nested braces). */
function parseEachObject(text: string): unknown[] {
  const out: unknown[] = [];
  for (const m of text.matchAll(/\{[^{}]*\}/g)) {
    const parsed = tryParse(m[0]);
    if (parsed.ok) out.push(parsed.value);
  }
  return out;
}

export function toBox(v: unknown): Box | null {
  if (!Array.isArray(v) || v.length !== 4) return null;
  if (!v.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const [ymin, xmin, ymax, xmax] = (v as number[]).map((n) => Math.min(1000, Math.max(0, n)));
  if (ymax <= ymin || xmax <= xmin) return null;
  return [ymin, xmin, ymax, xmax];
}

export function toLink(raw: unknown): Link | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const label = typeof r.label === "string" ? r.label.trim().slice(0, 120) : "";
  const box = toBox(r.box_2d ?? r.box);
  if (!label || !box) return null;
  const kind = KINDS.includes(r.kind as LinkKind) ? (r.kind as LinkKind) : "link";
  const dest = typeof r.dest === "string" && r.dest.trim() ? r.dest.trim().slice(0, 200) : label;
  return { label, kind, dest, external: r.external === true, box };
}

export function parseLinks(text: string): Link[] {
  const data = parseJsonLoose(text);
  const list: unknown[] = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { links?: unknown }).links)
      ? (data as { links: unknown[] }).links
      : parseEachObject(text);
  return list.map(toLink).filter((l): l is Link => l !== null);
}

export function parsePointLink(text: string): Link | null {
  const data = parseJsonLoose(text);
  return toLink(Array.isArray(data) ? data[0] : data);
}

export function toPoint(v: unknown): Point | null {
  if (!v || typeof v !== "object") return null;
  const { x, y } = v as Record<string, unknown>;
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const c = (n: number) => Math.min(1000, Math.max(0, n));
  return { x: c(x), y: c(y) };
}
