// Session history (back/forward over hallucinated pages) and the builders
// that turn chrome actions into PageRequests. In-memory only, by design.

import type { Entry, Link, PageRequest } from "./types";

/** Longest text a visitor can type; matches the server's MAX_USER_TEXT. */
export const MAX_INPUT_CHARS = 200;

export class Session {
  private entries: Entry[] = [];
  private cursor = -1;

  current(): Entry | null {
    return this.entries[this.cursor] ?? null;
  }

  push(entry: Entry): void {
    this.entries = this.entries.slice(0, this.cursor + 1);
    this.entries.push(entry);
    this.cursor = this.entries.length - 1;
  }

  canBack(): boolean {
    return this.cursor > 0;
  }

  canForward(): boolean {
    return this.cursor < this.entries.length - 1;
  }

  back(): Entry | null {
    if (!this.canBack()) return null;
    this.cursor--;
    return this.current();
  }

  forward(): Entry | null {
    if (!this.canForward()) return null;
    this.cursor++;
    return this.current();
  }
}

export function typedRequest(input: string): PageRequest {
  return { mode: "typed", input };
}

export function linkRequest(from: Entry, link: Link): PageRequest {
  if (link.external) return { mode: "external", label: link.label, dest: link.dest };
  return {
    mode: "internal",
    site: { url: from.url, title: from.title },
    label: link.label,
    dest: link.dest,
    referenceImage: from.imageDataUri,
    referenceSig: from.imageSig,
  };
}

export function searchRequest(from: Entry, link: Link, query: string): PageRequest {
  return {
    mode: "search",
    site: { url: from.url, title: from.title },
    label: link.label,
    query,
    referenceImage: from.imageDataUri,
    referenceSig: from.imageSig,
  };
}

/** Minimum time between starting two page generations (each one is billed). */
export const MIN_NAV_GAP_MS = 1500;

/** Identity of a navigation for de-duplication; the reference image doesn't matter. */
export function requestKey(req: PageRequest): string {
  if (req.mode === "internal" || req.mode === "search") {
    const { referenceImage: _image, referenceSig: _sig, ...rest } = req;
    return JSON.stringify(rest);
  }
  return JSON.stringify(req);
}

/**
 * Drops navigations that would only burn money: the same request again while
 * it is still loading, or any request within minGapMs of the last one started.
 */
export class NavThrottle {
  private lastStart = -Infinity;
  private inflightKey: string | null = null;

  constructor(private readonly minGapMs = MIN_NAV_GAP_MS) {}

  tryStart(key: string, now: number): boolean {
    if (key === this.inflightKey) return false;
    if (now - this.lastStart < this.minGapMs) return false;
    this.lastStart = now;
    this.inflightKey = key;
    return true;
  }

  finish(): void {
    this.inflightKey = null;
  }
}
