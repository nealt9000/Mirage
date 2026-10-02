// Validates the structured navigation request the browser sends to
// /api/page. Strings are trimmed and capped; anything malformed → null (400).
// The reference image's signature is checked by the handler, not here.

import type { PageRequest, SiteRef } from "../../src/types";
import { isImageDataUri } from "./image.js";
import { MAX_USER_TEXT } from "./pageContract.js";

const MAX_SITE_CHARS = 200;

function text(v: unknown, max = MAX_USER_TEXT): string | null {
  return typeof v === "string" ? v.trim().slice(0, max) : null;
}

function siteRef(v: unknown): SiteRef | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const url = text(r.url, MAX_SITE_CHARS);
  const title = text(r.title, MAX_SITE_CHARS);
  return url !== null && title !== null ? { url, title } : null;
}

export function parsePageRequest(v: unknown): PageRequest | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  switch (r.mode) {
    case "typed": {
      const input = text(r.input);
      return input === null ? null : { mode: "typed", input };
    }
    case "external": {
      const label = text(r.label);
      const dest = text(r.dest);
      return label && dest !== null ? { mode: "external", label, dest } : null;
    }
    case "internal":
    case "search": {
      const site = siteRef(r.site);
      const label = text(r.label);
      if (!site || !label || !isImageDataUri(r.referenceImage) || typeof r.referenceSig !== "string") return null;
      const base = { site, label, referenceImage: r.referenceImage, referenceSig: r.referenceSig };
      if (r.mode === "internal") {
        const dest = text(r.dest);
        return dest === null ? null : { mode: "internal", ...base, dest };
      }
      const query = text(r.query);
      return query ? { mode: "search", ...base, query } : null;
    }
    default:
      return null;
  }
}
