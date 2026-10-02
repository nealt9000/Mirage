// Fallback url/title derivation for when the page model omits or garbles its
// metadata line, plus host/site-key helpers for history entries.

import type { PageRequest } from "./types";

export type MetaLike = { url: string | null; title: string | null };

const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i;

export function slugify(s: string): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug || "page";
}

export function stripProtocol(url: string): string {
  return url.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
}

export function hostOf(url: string): string {
  return stripProtocol(url).split(/[/?#]/)[0].toLowerCase();
}

export function siteKeyOf(url: string): string {
  return hostOf(url).replace(/^www\./, "");
}

export function deriveMeta(req: PageRequest, meta: MetaLike): { url: string; title: string } {
  const url = meta.url ? stripProtocol(meta.url) : "";
  return { url: url || fallbackUrl(req), title: meta.title ?? fallbackTitle(req) };
}

function fallbackUrl(req: PageRequest): string {
  switch (req.mode) {
    case "typed": {
      const typed = stripProtocol(req.input);
      return DOMAIN_RE.test(typed) ? typed : `www.${slugify(typed || "portal")}.com`;
    }
    case "internal":
      return `${hostOf(req.site.url)}/${slugify(req.label)}`;
    case "search":
      return `${hostOf(req.site.url)}/search?q=${encodeURIComponent(req.query.trim())}`;
    case "external":
      return `www.${slugify(req.label)}.com`;
  }
}

function fallbackTitle(req: PageRequest): string {
  switch (req.mode) {
    case "typed":
      return req.input.trim() || "Portal";
    case "internal":
    case "external":
      return req.label;
    case "search":
      return `Search: ${req.query.trim()}`;
  }
}
