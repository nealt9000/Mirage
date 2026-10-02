// Core types for Mirage's image-first pipeline. Shared by the browser code
// and the api/ functions (type-only imports), so keep this file DOM-free.

/** Gemini box_2d order, normalised 0–1000. */
export type Box = [ymin: number, xmin: number, ymax: number, xmax: number];

export type LinkKind = "link" | "button" | "input" | "image";

export type Link = {
  label: string;
  kind: LinkKind;
  /** Short description of where the link leads (or what an input searches). */
  dest: string;
  /** True when the link leaves the current site (new universe). */
  external: boolean;
  box: Box;
};

/** A position on the page image, normalised 0–1000. */
export type Point = { x: number; y: number };

export type NavMode = "typed" | "internal" | "external" | "search";

export type SiteRef = { url: string; title: string };

export type PageRequest =
  | { mode: "typed"; input: string }
  | { mode: "internal"; site: SiteRef; label: string; dest: string; referenceImage: string }
  | { mode: "external"; label: string; dest: string }
  | { mode: "search"; site: SiteRef; label: string; query: string; referenceImage: string };

export type PromptParts = { text: string; referenceImage?: string };

export type PageResult = {
  url: string | null;
  title: string | null;
  image: string;
  costUsd: number;
  ms: number;
  model: string;
};

export type LinksResult = { links: Link[]; costUsd: number; ms: number; model: string };

export type PointResult = { link: Link | null; costUsd: number; ms: number; model: string };

export type Entry = {
  imageDataUri: string;
  url: string;
  title: string;
  /** null until the link scan arrives (or when it failed / found nothing). */
  links: Link[] | null;
  siteKey: string;
};

export type LinkMode = "scan" | "click-only";

export type AppSettings = {
  pageModel: string;
  linkModel: string;
  linkMode: LinkMode;
};
