# Image-First Mirage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the HTML-generation pipeline with one where every page is a single hallucinated website image (Gemini Flash-Lite Image), and an invisible hotspot layer (from Gemini Flash bounding boxes) makes its links and search boxes work.

**Architecture:** The browser builds a prompt for one of four navigation modes and POSTs it to `/api/page`. That Vercel Function (Node runtime) calls OpenRouter and returns `{url, title, image, costUsd, ms, model}`. The image is shown at once. `/api/links` then maps clickable regions in the background, or resolves a single click point if the map hasn't arrived yet. `src/hotspots.ts` overlays those regions, and `src/session.ts` keeps an in-memory back/forward stack.

**Tech Stack:** Vite 5 + TypeScript (strict) SPA, 98.css chrome, Vercel Functions (Node runtime, Web `Request`/`Response` handlers), OpenRouter `/chat/completions`, `sharp` (server-side re-encode and crop), Vitest 3.

**Spec:** `docs/superpowers/specs/2026-10-02-image-first-mirage-design.md`

## Global Constraints

- Page model default: `google/gemini-3.1-flash-lite-image` via OpenRouter, `modalities: ["image","text"]`, `image_config: { aspect_ratio: "4:3" }`.
- Link model default: `google/gemini-3-flash-preview` via OpenRouter, `temperature: 0`.
- Boxes are Gemini `box_2d` format: `[ymin, xmin, ymax, xmax]`, normalised 0–1000.
- Retry policy (server-side): retry `429`, `502`, `503`, `504`; `MAX_RETRIES = 2`; waits capped at `MAX_RETRY_MS = 5000`; 429 uses `Retry-After`, 5xx uses linear backoff.
- No image after the first call → exactly one retry with suffix `"Respond with the metadata line and an image only."`, then `{ error: "faded" }`.
- `OPENROUTER_API_KEY` stays server-side. Upstream error detail is never sent to the browser.
- Responses must stay under Vercel's 4.5 MB body limit (images are re-encoded to JPEG above the cap).
- Point resolve crops ~30% × 20% of the image around the click.
- Nothing is persisted except dev settings in `localStorage`. Session history, run log and images are in memory only.
- No eras, years, archetypes or year UI anywhere.
- Chrome copy: error `"The mirage faded."`; tuning lines include `"Receiving signal from a neighbouring universe…"` and `"Tuned to dimension #4,817"`.
- Functions use the default Node runtime (no `runtime: "edge"`).
- Gates: `npm run build` (tsc for `src` + tsc for `api` + vite build) and `npm test` (Vitest) must both pass at the end of every task.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Deliberate deviations from the spec (flag in review, don't "fix")

1. `/api/links` returns `{ links, costUsd, ms, model }` and point resolve returns `{ link, costUsd, ms, model }`, not a bare `Link[]` / `Link`. This feeds the dev-panel cost log.
2. The hotspot layer does not create one `<a>` per link. A single layer element hit-tests clicks and hover with the pure `hitTest()`, so overlapping boxes resolve the same way (the smallest box wins). A dotted hover box shows the hovered link. Only `kind: "input"` links become real `<input>` elements.
3. The image cap is 3,500,000 data-URI characters (~2.6 MB binary), not "about 4 MB". This leaves room for the same image to be sent back as a reference/scan request body, which has the same 4.5 MB limit.
4. Dev settings move to `localStorage` key `mirage.settings.v2`, because the old v1 shape is incompatible.
5. A scan that returns zero links is stored as `links: null` (unmapped), so clicks fall back to point resolve instead of the page going dead.

## Review Focus

1. **Navigating again mid-load** (click a second link or press Go while a page is still generating) → only the newest page ever appears, and an aborted request is never reported as "The mirage faded." Pinned by `src/openrouter.test.ts` "propagates AbortError" (Task 7), plus the `inflight !== ac` guards in Task 9.
2. **Upstream failure with a juicy error body** (401 bad key, provider stack trace) → the browser gets `{error:"faded"}` and none of the upstream text. Pinned by `api/_lib/page.handler.test.ts` "never leaks upstream detail" (Task 4).
3. **Oversized page image** (Gemini PNG whose data URI exceeds the cap) → it is re-encoded to JPEG and ends up ≤ `MAX_IMAGE_CHARS`, so the response *and* the later reference/scan request fit under 4.5 MB. Pinned by `api/_lib/image.test.ts` "re-encodes a large image under the cap" (Task 4).
4. **Truncated or prose-wrapped link JSON** (scan model stops mid-array, or writes "Here are the links:" first) → the valid entries are kept, not thrown away. Pinned by `api/_lib/links.test.ts` "salvages a truncated array" and "finds JSON inside prose" (Task 5).
5. **Clicks at the image edges/corners in point-resolve mode** → the crop is clamped inside the image, and the model is told where the click really is inside the crop (not "the centre"). Pinned by `api/_lib/crop.test.ts` corner cases (Task 5).

---

## File Structure

**Server (`api/`)**: Vercel ignores `_`-prefixed directories for routing, so `api/_lib/` holds shared code and tests. Never put a `*.test.ts` directly in `api/`, because it would become a route.

| File | Responsibility |
|---|---|
| `api/page.ts` (create) | `POST` handler: validate input, call page model, retry once if imageless, shrink image, respond |
| `api/links.ts` (create) | `POST` handler: full scan, or point resolve via crop |
| `api/models.ts` (rewrite) | `GET` proxy to OpenRouter model catalog (Node runtime) |
| `api/_lib/openrouter.ts` | `postChat()` with retry policy; `messageText()`, `completionCost()` |
| `api/_lib/http.ts` | `json()` response helper |
| `api/_lib/modelIds.ts` | default model ids, `isModelId()` |
| `api/_lib/pageGen.ts` | page request body, `STRICT_SUFFIX`, `parseMeta()`, `extractPageParts()` |
| `api/_lib/image.ts` | `isImageDataUri()`, `decodeDataUri()`, `shrinkIfLarge()`, `cropAround()` (sharp, lazy-loaded) |
| `api/_lib/crop.ts` | pure crop geometry: `cropRect()`, `pointInCrop()`, `cropBoxToFull()` |
| `api/_lib/links.ts` | scan/point prompts, `visionBody()`, `parseLinks()`, `parsePointLink()`, `toPoint()` |
| deleted | `api/chat.ts`, `api/image.ts`, `api/image-gemini.ts` |

**Client (`src/`)**

| File | Responsibility |
|---|---|
| `src/types.ts` (rewrite) | shared DOM-free types (also imported type-only by `api/`) |
| `src/pageContract.ts` (create) | `CONTRACT`, `buildPagePrompt()` |
| `src/pageMeta.ts` (create) | fallback url/title derivation, `slugify()`, `siteKeyOf()` |
| `src/openrouter.ts` (create) | `fetchPage()`, `fetchLinks()`, `resolvePoint()`, `listModels()`, `FadedError`, `isAbortError()` |
| `src/session.ts` (create) | `Session` history stack; `typedRequest()`, `linkRequest()`, `searchRequest()` |
| `src/hotspots.ts` (create) | pure geometry + `HotspotLayer` DOM class |
| `src/loading.ts` (create) | `LoadingView` (haze / tuning / elapsed), `tuningLine()`, `usesHaze()` |
| `src/modelStats.ts` (rewrite) | in-memory run log: `recordRun()`, `recentRuns()`, `totalCost()` |
| `src/devPanel.ts` (rewrite) | settings (page model, link model, link mode) + live run log |
| `src/main.ts` (rewrite) | wiring chrome ↔ session ↔ API |
| `src/style.css` (rewrite) | chrome + loading effects |
| `index.html` (rewrite) | chrome shell with `.page > img + .hotspots` |
| deleted | `src/hallucinate.ts`, `render.ts`, `classify.ts`, `handoff.ts`, `homepageContract.ts`, `agent.ts`, `systemPrompts.ts`, `ollama.ts` |

**Tooling:** `vitest.config.ts`, `tsconfig.api.json` (create); `tsconfig.json`, `package.json`, `vite.config.ts`, `vercel.json`, `.env.example` (modify).

---

### Task 1: Test tooling, shared types, and prompt builders

**Files:**
- Modify: `package.json` (scripts, devDeps), `tsconfig.json`
- Create: `vitest.config.ts`, `src/pageContract.ts`, `src/pageContract.test.ts`
- Modify: `src/types.ts` (append new types; old types stay until Task 9)

**Interfaces:**
- Consumes: nothing.
- Produces (in `src/types.ts`):
  ```ts
  export type Box = [ymin: number, xmin: number, ymax: number, xmax: number];
  export type LinkKind = "link" | "button" | "input" | "image";
  export type Link = { label: string; kind: LinkKind; dest: string; external: boolean; box: Box };
  export type Point = { x: number; y: number };
  export type NavMode = "typed" | "internal" | "external" | "search";
  export type SiteRef = { url: string; title: string };
  export type PageRequest = /* union, see Step 3 */;
  export type PromptParts = { text: string; referenceImage?: string };
  export type PageResult = { url: string | null; title: string | null; image: string; costUsd: number; ms: number; model: string };
  export type LinksResult = { links: Link[]; costUsd: number; ms: number; model: string };
  export type PointResult = { link: Link | null; costUsd: number; ms: number; model: string };
  export type Entry = { imageDataUri: string; url: string; title: string; links: Link[] | null; siteKey: string };
  ```
- Produces (in `src/pageContract.ts`): `CONTRACT: string`, `MAX_USER_TEXT = 300`, `buildPagePrompt(req: PageRequest): PromptParts`.

- [ ] **Step 1: Install Vitest and Node types**

```bash
npm install -D vitest@^3 @types/node
```

- [ ] **Step 2: Add scripts, the Vitest config, and keep Node globals out of browser code**

In `package.json` `"scripts"`, add `"test": "vitest run"`. Leave `build` alone for now; Task 3 changes it.

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so tests don't load the dev API middleware.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "api/**/*.test.ts"],
    environment: "node",
  },
});
```

In `tsconfig.json` `compilerOptions`, add `"types": []`. This stops `@types/node` from leaking `process`/`Buffer` globals into browser code. Explicit `import ... from "vitest"` still works.

- [ ] **Step 3: Append the new shared types to `src/types.ts`**

Add this block at the end of the file. Do not touch the old types yet; Task 9 removes them.

```ts
// ---------------------------------------------------------------------------
// Image-first pipeline. Shared with api/ via type-only imports: keep DOM-free.
// ---------------------------------------------------------------------------

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
```

- [ ] **Step 4: Write the failing prompt-builder tests**

Create `src/pageContract.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildPagePrompt, CONTRACT, MAX_USER_TEXT } from "./pageContract";

const site = { url: "www.cheese-oracle.net/home", title: "The Cheese Oracle" };
const ref = "data:image/png;base64,AAAA";

describe("buildPagePrompt", () => {
  it("typed: includes the contract and typed text, no reference image", () => {
    const p = buildPagePrompt({ mode: "typed", input: "moon-pizza.com" });
    expect(p.text).toContain(CONTRACT);
    expect(p.text).toContain('"moon-pizza.com"');
    expect(p.referenceImage).toBeUndefined();
  });

  it("typed: empty input asks for a web portal homepage", () => {
    const p = buildPagePrompt({ mode: "typed", input: "   " });
    expect(p.text).toContain("web portal homepage");
    expect(p.referenceImage).toBeUndefined();
  });

  it("internal: includes site, label, dest and passes the reference image", () => {
    const p = buildPagePrompt({
      mode: "internal", site, label: "Aged Prophecies", dest: "archive of cheese predictions", referenceImage: ref,
    });
    expect(p.text).toContain("The Cheese Oracle");
    expect(p.text).toContain("www.cheese-oracle.net/home");
    expect(p.text).toContain("Aged Prophecies");
    expect(p.text).toContain("archive of cheese predictions");
    expect(p.text).toContain("same website");
    expect(p.referenceImage).toBe(ref);
  });

  it("external: includes label and dest but no site and no reference image", () => {
    const p = buildPagePrompt({ mode: "external", label: "Gravity Outlet", dest: "discount gravity store" });
    expect(p.text).toContain("Gravity Outlet");
    expect(p.text).toContain("discount gravity store");
    expect(p.text).toContain("different website");
    expect(p.text).not.toContain("same website");
    expect(p.referenceImage).toBeUndefined();
  });

  it("search: includes site, input label, query and passes the reference image", () => {
    const p = buildPagePrompt({ mode: "search", site, label: "Search prophecies", query: "brie futures", referenceImage: ref });
    expect(p.text).toContain("The Cheese Oracle");
    expect(p.text).toContain("Search prophecies");
    expect(p.text).toContain("brie futures");
    expect(p.text).toContain("results page");
    expect(p.referenceImage).toBe(ref);
  });

  it("asks for the one-line metadata JSON", () => {
    expect(CONTRACT).toContain('{"url"');
    expect(CONTRACT).toContain("no browser frame");
  });

  it("truncates very long user text", () => {
    const p = buildPagePrompt({ mode: "typed", input: "x".repeat(5000) });
    expect(p.text).toContain("x".repeat(MAX_USER_TEXT));
    expect(p.text).not.toContain("x".repeat(MAX_USER_TEXT + 1));
  });

  it("quotes user text safely", () => {
    const p = buildPagePrompt({ mode: "typed", input: 'say "hi"' });
    expect(p.text).toContain('"say \\"hi\\""');
  });
});
```

- [ ] **Step 5: Run the tests and confirm they fail**

Run: `npm test`
Expected: FAIL, because `./pageContract` cannot be resolved.

- [ ] **Step 6: Implement `src/pageContract.ts`**

```ts
// Prompt contract and per-mode prompt builders for the page image model.
// Pure functions: /api/page only forwards { prompt, referenceImage }.

import type { PageRequest, PromptParts } from "./types";

export const MAX_USER_TEXT = 300;

export const CONTRACT = [
  "Generate a full-page desktop screenshot of a website from a parallel universe.",
  "The content is confidently absurd and plays it completely straight: no winks, no acknowledged jokes, no disclaimers inside the page.",
  "Text must be crisp and legible: headlines, navigation, product names and body copy.",
  "Flat screenshot of the page only: no browser frame, no address bar, no OS taskbar, no device mockup.",
  "Never use real brand names or logos; invent parodies instead.",
  "No defamation of real people and no genuinely harmful content.",
  'Before the image, output exactly one line of JSON: {"url": "<page address without protocol>", "title": "<page title>"}.',
].join("\n");

/** Trim, cap and JSON-quote user-controlled text before it enters a prompt. */
function quote(s: string): string {
  return JSON.stringify(s.trim().slice(0, MAX_USER_TEXT));
}

export function buildPagePrompt(req: PageRequest): PromptParts {
  switch (req.mode) {
    case "typed": {
      const task = req.input.trim()
        ? `The user typed ${quote(req.input)} into the address bar. Show the page that loads.`
        : "Show a web portal homepage: the page this universe's browsers open by default.";
      return { text: `${CONTRACT}\n\n${task}` };
    }
    case "internal":
      return {
        text:
          `${CONTRACT}\n\nThe attached image is the current page of ${quote(req.site.title)} (${quote(req.site.url)}). ` +
          `The user clicked ${quote(req.label)}, which leads to: ${quote(req.dest)}. ` +
          "Show that next page of the same website. Keep its logo, navigation, footer, colours and layout style; replace the main content.",
        referenceImage: req.referenceImage,
      };
    case "external":
      return {
        text:
          `${CONTRACT}\n\nThe user followed a link labelled ${quote(req.label)} (${quote(req.dest)}) to a different website. ` +
          "Show that website's page, with its own branding.",
      };
    case "search":
      return {
        text:
          `${CONTRACT}\n\nThe attached image is ${quote(req.site.title)} (${quote(req.site.url)}). ` +
          `The user typed ${quote(req.query)} into the ${quote(req.label)} box and pressed Enter. ` +
          "Show the results page on the same website, keeping its logo, navigation and footer.",
        referenceImage: req.referenceImage,
      };
  }
}
```

- [ ] **Step 7: Run the tests and the build**

Run: `npm test && npm run build`
Expected: 8 tests PASS. Build succeeds (the old app is untouched).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src/types.ts src/pageContract.ts src/pageContract.test.ts
git commit -m "feat: add Vitest, image-pipeline types and page prompt builders

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Fallback url/title derivation

**Files:**
- Create: `src/pageMeta.ts`, `src/pageMeta.test.ts`

**Interfaces:**
- Consumes: `PageRequest` from `src/types.ts`.
- Produces:
  ```ts
  export type MetaLike = { url: string | null; title: string | null };
  export function slugify(s: string): string;            // [a-z0-9-], ≤40 chars, "page" if empty
  export function stripProtocol(url: string): string;
  export function hostOf(url: string): string;           // lowercased host, no protocol/path
  export function siteKeyOf(url: string): string;        // hostOf without leading "www."
  export function deriveMeta(req: PageRequest, meta: MetaLike): { url: string; title: string };
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/pageMeta.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveMeta, siteKeyOf, slugify } from "./pageMeta";
import type { PageRequest } from "./types";

const none = { url: null, title: null };
const site = { url: "www.cheese-oracle.net/home", title: "The Cheese Oracle" };
const ref = "data:image/png;base64,AAAA";

describe("slugify", () => {
  it("lowercases and dashes", () => expect(slugify("  Hello, World!  ")).toBe("hello-world"));
  it("falls back to 'page' when nothing is left", () => expect(slugify("🧀🧀")).toBe("page"));
  it("caps at 40 chars without a trailing dash", () => {
    const s = slugify("a".repeat(100));
    expect(s).toHaveLength(40);
    expect(slugify("abcdefghij ".repeat(5)).endsWith("-")).toBe(false);
  });
});

describe("siteKeyOf", () => {
  it("strips protocol, www, path and case", () => {
    expect(siteKeyOf("https://WWW.Cheese-Oracle.net/home?x=1")).toBe("cheese-oracle.net");
  });
});

describe("deriveMeta", () => {
  it("uses the model's metadata when present, minus protocol", () => {
    const req: PageRequest = { mode: "typed", input: "moon pizza" };
    expect(deriveMeta(req, { url: "https://www.moon-pizza.com/", title: "Moon Pizza" }))
      .toEqual({ url: "www.moon-pizza.com/", title: "Moon Pizza" });
  });

  it("typed: keeps a domain-looking input as the url", () => {
    const req: PageRequest = { mode: "typed", input: "Moon-Pizza.com/menu" };
    expect(deriveMeta(req, none)).toEqual({ url: "Moon-Pizza.com/menu", title: "Moon-Pizza.com/menu" });
  });

  it("typed: invents a domain from a phrase", () => {
    const req: PageRequest = { mode: "typed", input: "best pizza on the moon" };
    expect(deriveMeta(req, none)).toEqual({ url: "www.best-pizza-on-the-moon.com", title: "best pizza on the moon" });
  });

  it("typed: empty input becomes the portal", () => {
    expect(deriveMeta({ mode: "typed", input: "" }, none)).toEqual({ url: "www.portal.com", title: "Portal" });
  });

  it("internal: slug of the label under the current site", () => {
    const req: PageRequest = { mode: "internal", site, label: "Aged Prophecies", dest: "x", referenceImage: ref };
    expect(deriveMeta(req, none)).toEqual({ url: "www.cheese-oracle.net/aged-prophecies", title: "Aged Prophecies" });
  });

  it("external: a fresh domain, not under the current site", () => {
    const req: PageRequest = { mode: "external", label: "Visit our friends at Gravity Outlet!", dest: "x" };
    const meta = deriveMeta(req, none);
    expect(meta.url).toBe("www.visit-our-friends-at-gravity-outlet.com");
    expect(meta.url).not.toContain("cheese-oracle");
  });

  it("search: a query url under the current site", () => {
    const req: PageRequest = { mode: "search", site, label: "Search", query: " blue cheese ", referenceImage: ref };
    expect(deriveMeta(req, none)).toEqual({
      url: "www.cheese-oracle.net/search?q=blue%20cheese",
      title: "Search: blue cheese",
    });
  });

  it("treats a protocol-only url as missing", () => {
    const req: PageRequest = { mode: "external", label: "Gravity Outlet", dest: "x" };
    expect(deriveMeta(req, { url: "https://", title: null }).url).toBe("www.gravity-outlet.com");
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/pageMeta.test.ts`
Expected: FAIL, because `./pageMeta` cannot be resolved.

- [ ] **Step 3: Implement `src/pageMeta.ts`**

```ts
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
```

- [ ] **Step 4: Run the tests and the build**

Run: `npm test && npm run build`
Expected: all PASS, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/pageMeta.ts src/pageMeta.test.ts
git commit -m "feat: derive fallback page url/title per navigation mode

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Server-side OpenRouter client with retry policy

**Files:**
- Create: `tsconfig.api.json`, `api/_lib/openrouter.ts`, `api/_lib/openrouter.test.ts`, `api/_lib/http.ts`, `api/_lib/modelIds.ts`
- Modify: `package.json` (`build` script)

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  // api/_lib/openrouter.ts
  export const MAX_RETRIES = 2;
  export const MAX_RETRY_MS = 5000;
  export class UpstreamError extends Error { status: number }
  export type ContentPart = { type?: string; text?: string };
  export type ChatCompletion = {
    choices?: { message?: { content?: string | ContentPart[] | null; images?: { image_url?: { url?: string } }[] } }[];
    usage?: { cost?: number };
  };
  export type PostChatDeps = { sleep?: (ms: number) => Promise<void>; signal?: AbortSignal };
  export function retryDelayMs(status: number, attempt: number, retryAfter: string | null): number;
  export function postChat(body: Record<string, unknown>, deps?: PostChatDeps): Promise<ChatCompletion>;
  export function messageText(c: ChatCompletion): string;
  export function completionCost(c: ChatCompletion): number;
  // api/_lib/http.ts
  export function json(body: unknown, status?: number): Response;
  // api/_lib/modelIds.ts
  export const DEFAULT_PAGE_MODEL = "google/gemini-3.1-flash-lite-image";
  export const DEFAULT_LINK_MODEL = "google/gemini-3-flash-preview";
  export function isModelId(v: unknown): v is string;
  ```

- [ ] **Step 1: Add the API typecheck config and wire it into the build**

Create `tsconfig.api.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "allowImportingTsExtensions": true
  },
  "include": ["api"],
  "exclude": ["api/chat.ts", "api/image.ts", "api/image-gemini.ts"]
}
```

The `exclude` covers legacy edge handlers that Task 9 deletes; Task 9 also removes this line.

In `package.json`, change `"build"` to:

```json
"build": "tsc && tsc -p tsconfig.api.json && vite build",
```

- [ ] **Step 2: Write the failing tests**

Create `api/_lib/openrouter.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  completionCost, MAX_RETRY_MS, messageText, postChat, retryDelayMs, UpstreamError,
} from "./openrouter";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const fail = (status: number) => new Response("upstream sad", { status });
const noSleep = () => vi.fn().mockResolvedValue(undefined);

beforeEach(() => { process.env.OPENROUTER_API_KEY = "test-key"; });
afterEach(() => { vi.unstubAllGlobals(); });

describe("retryDelayMs", () => {
  it("honours Retry-After on 429, capped", () => {
    expect(retryDelayMs(429, 0, "2")).toBe(2000);
    expect(retryDelayMs(429, 0, "60")).toBe(MAX_RETRY_MS);
    expect(retryDelayMs(429, 0, null)).toBe(5000);
  });
  it("uses linear backoff for 5xx, capped", () => {
    expect(retryDelayMs(502, 0, null)).toBe(2000);
    expect(retryDelayMs(503, 1, null)).toBe(4000);
    expect(retryDelayMs(504, 5, null)).toBe(MAX_RETRY_MS);
  });
});

describe("postChat", () => {
  it("retries a 502 and returns the next completion", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fail(502))
      .mockResolvedValueOnce(ok({ choices: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const sleep = noSleep();
    await expect(postChat({ model: "m" }, { sleep })).resolves.toEqual({ choices: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("gives up after MAX_RETRIES retries", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(fail(503)));
    vi.stubGlobal("fetch", fetchMock);
    await expect(postChat({ model: "m" }, { sleep: noSleep() })).rejects.toBeInstanceOf(UpstreamError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry other errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fail(400));
    vi.stubGlobal("fetch", fetchMock);
    await expect(postChat({ model: "m" }, { sleep: noSleep() })).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends the bearer key and asks for usage accounting", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({}));
    vi.stubGlobal("fetch", fetchMock);
    await postChat({ model: "m" });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer test-key");
    expect(JSON.parse(init.body)).toMatchObject({ model: "m", usage: { include: true } });
  });

  it("throws without an API key", async () => {
    delete process.env.OPENROUTER_API_KEY;
    vi.stubGlobal("fetch", vi.fn());
    await expect(postChat({ model: "m" })).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe("messageText / completionCost", () => {
  it("reads string content", () => {
    expect(messageText({ choices: [{ message: { content: "hi" } }] })).toBe("hi");
  });
  it("joins array content parts", () => {
    expect(messageText({ choices: [{ message: { content: [{ type: "text", text: "a" }, { type: "image" }, { text: "b" }] } }] })).toBe("ab");
  });
  it("returns empty text for missing content", () => {
    expect(messageText({})).toBe("");
  });
  it("reads cost, defaulting to 0", () => {
    expect(completionCost({ usage: { cost: 0.034 } })).toBe(0.034);
    expect(completionCost({})).toBe(0);
  });
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `npx vitest run api/_lib/openrouter.test.ts`
Expected: FAIL, because `./openrouter` cannot be resolved.

- [ ] **Step 4: Implement `api/_lib/openrouter.ts`, `http.ts`, `modelIds.ts`**

`api/_lib/openrouter.ts`:

```ts
// Server-side OpenRouter client. Retries 429/502/503/504 up to MAX_RETRIES
// times (429 honours Retry-After, 5xx backs off linearly), each wait capped
// at MAX_RETRY_MS. Callers never forward UpstreamError text to the browser.

export const MAX_RETRIES = 2;
export const MAX_RETRY_MS = 5000;

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const RETRY_STATUSES = new Set([429, 502, 503, 504]);

export class UpstreamError extends Error {
  constructor(public readonly status: number, detail: string) {
    super(`OpenRouter ${status}: ${detail.slice(0, 500)}`);
    this.name = "UpstreamError";
  }
}

export type ContentPart = { type?: string; text?: string };

export type ChatCompletion = {
  choices?: {
    message?: {
      content?: string | ContentPart[] | null;
      images?: { image_url?: { url?: string } }[];
    };
  }[];
  usage?: { cost?: number };
};

export type PostChatDeps = {
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function retryDelayMs(status: number, attempt: number, retryAfter: string | null): number {
  if (status === 429) {
    const n = Number.parseInt(retryAfter ?? "", 10);
    const sec = Number.isFinite(n) && n > 0 ? n : 5;
    return Math.min(sec * 1000, MAX_RETRY_MS);
  }
  return Math.min(2000 * (attempt + 1), MAX_RETRY_MS);
}

export async function postChat(
  body: Record<string, unknown>,
  deps: PostChatDeps = {}
): Promise<ChatCompletion> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new UpstreamError(500, "OPENROUTER_API_KEY not configured");
  const sleep = deps.sleep ?? defaultSleep;

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://mirage-web.app",
        "X-OpenRouter-Title": "Mirage",
      },
      body: JSON.stringify({ ...body, usage: { include: true } }),
      signal: deps.signal,
    });
    if (res.ok) return (await res.json()) as ChatCompletion;

    const detail = await res.text().catch(() => "");
    if (RETRY_STATUSES.has(res.status) && attempt < MAX_RETRIES) {
      await sleep(retryDelayMs(res.status, attempt, res.headers.get("Retry-After")));
      continue;
    }
    throw new UpstreamError(res.status, detail);
  }
}

export function messageText(c: ChatCompletion): string {
  const content = c.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p.text === "string" ? p.text : "")).join("");
  }
  return "";
}

export function completionCost(c: ChatCompletion): number {
  const cost = c.usage?.cost;
  return typeof cost === "number" && Number.isFinite(cost) ? cost : 0;
}
```

`api/_lib/http.ts`:

```ts
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
```

`api/_lib/modelIds.ts`:

```ts
// Default models and a shape check for client-chosen model ids (dev panel).

export const DEFAULT_PAGE_MODEL = "google/gemini-3.1-flash-lite-image";
export const DEFAULT_LINK_MODEL = "google/gemini-3-flash-preview";

const MODEL_ID_RE = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9.:_-]*$/i;

export function isModelId(v: unknown): v is string {
  return typeof v === "string" && v.length <= 100 && MODEL_ID_RE.test(v);
}
```

- [ ] **Step 5: Run the tests and the build**

Run: `npm test && npm run build`
Expected: all PASS. Build runs both `tsc` passes and succeeds.

- [ ] **Step 6: Commit**

```bash
git add tsconfig.api.json package.json api/_lib
git commit -m "feat(api): server-side OpenRouter client with retry policy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `/api/page`: page generation endpoint

**Files:**
- Modify: `package.json` (add `sharp` dependency)
- Create: `api/_lib/pageGen.ts`, `api/_lib/pageGen.test.ts`, `api/_lib/image.ts`, `api/_lib/image.test.ts`, `api/_lib/crop.ts` (only `CropRect` + `cropRect`, so `image.ts` compiles; Task 5 adds the rest and its tests), `api/page.ts`, `api/_lib/page.handler.test.ts`

**Interfaces:**
- Consumes: `postChat`, `messageText`, `completionCost`, `UpstreamError`, `ChatCompletion` (Task 3); `json` (Task 3); `DEFAULT_PAGE_MODEL`, `isModelId` (Task 3); `PageResult`, `Point` from `src/types.ts`.
- Produces:
  ```ts
  // api/_lib/pageGen.ts
  export const STRICT_SUFFIX = "\n\nRespond with the metadata line and an image only.";
  export const MAX_PROMPT_CHARS = 4000;
  export function pageBody(model: string, prompt: string, referenceImage?: string): Record<string, unknown>;
  export function parseMeta(text: string): { url: string | null; title: string | null };
  export function extractPageParts(c: ChatCompletion): { text: string; image: string | null; costUsd: number };
  // api/_lib/image.ts
  export const MAX_IMAGE_CHARS = 3_500_000;
  export function isImageDataUri(v: unknown): v is string;
  export function decodeDataUri(uri: string): { mime: string; buf: Buffer } | null;
  export function shrinkIfLarge(dataUri: string): Promise<string>;
  export function cropAround(dataUri: string, point: Point): Promise<{ crop: string; rect: CropRect; width: number; height: number }>;
  // api/_lib/crop.ts (this task: type + cropRect only)
  export type CropRect = { left: number; top: number; width: number; height: number };
  export function cropRect(point: Point, imgW: number, imgH: number): CropRect;
  // api/page.ts
  export async function POST(req: Request): Promise<Response>;
  //  200 → PageResult; 400 → {error:"bad-request"}; 502 → {error:"faded", costUsd, ms}
  ```

- [ ] **Step 1: Install sharp**

```bash
npm install sharp
```

- [ ] **Step 2: Write the failing parser tests**

Create `api/_lib/pageGen.test.ts`:

```ts
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
```

Create `api/_lib/image.test.ts`:

```ts
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { cropAround, decodeDataUri, isImageDataUri, MAX_IMAGE_CHARS, shrinkIfLarge } from "./image";

async function pngDataUri(width: number, height: number, noise = false): Promise<string> {
  const img = sharp({
    create: {
      width, height, channels: 3, background: { r: 200, g: 100, b: 50 },
      ...(noise ? { noise: { type: "gaussian" as const, mean: 128, sigma: 60 } } : {}),
    },
  });
  return `data:image/png;base64,${(await img.png().toBuffer()).toString("base64")}`;
}

describe("data URIs", () => {
  it("recognises image data URIs only", () => {
    expect(isImageDataUri("data:image/png;base64,AAAA")).toBe(true);
    expect(isImageDataUri("data:text/html;base64,AAAA")).toBe(false);
    expect(isImageDataUri("https://example.com/a.png")).toBe(false);
    expect(isImageDataUri(42)).toBe(false);
  });
  it("decodes mime and bytes", () => {
    const d = decodeDataUri("data:image/PNG;base64,AAEC");
    expect(d?.mime).toBe("image/png");
    expect([...d!.buf]).toEqual([0, 1, 2]);
    expect(decodeDataUri("nope")).toBeNull();
  });
});

describe("shrinkIfLarge", () => {
  it("passes small images through untouched", async () => {
    const uri = await pngDataUri(64, 48);
    expect(await shrinkIfLarge(uri)).toBe(uri);
  });
  it("re-encodes a large image under the cap", async () => {
    const uri = await pngDataUri(1600, 1200, true);
    expect(uri.length).toBeGreaterThan(MAX_IMAGE_CHARS);
    const out = await shrinkIfLarge(uri);
    expect(out.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(MAX_IMAGE_CHARS);
  });
});

describe("cropAround", () => {
  it("crops 30% x 20% around the point", async () => {
    const uri = await pngDataUri(1000, 800);
    const { crop, rect, width, height } = await cropAround(uri, { x: 500, y: 500 });
    expect({ width, height }).toEqual({ width: 1000, height: 800 });
    expect(rect).toEqual({ left: 350, top: 320, width: 300, height: 160 });
    const meta = await sharp(decodeDataUri(crop)!.buf).metadata();
    expect([meta.width, meta.height]).toEqual([300, 160]);
  });
});
```

- [ ] **Step 3: Write the failing handler tests**

Create `api/_lib/page.handler.test.ts`. It lives in `_lib` so Vercel doesn't route it.

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../page";
import { STRICT_SUFFIX } from "./pageGen";
import { DEFAULT_PAGE_MODEL } from "./modelIds";

const IMG = "data:image/png;base64,iVBORw0KGgo=";

const completion = (content: string, image?: string, cost = 0.034) => new Response(JSON.stringify({
  choices: [{ message: { content, images: image ? [{ type: "image_url", image_url: { url: image } }] : [] } }],
  usage: { cost },
}), { status: 200 });

const request = (body: unknown) =>
  new Request("http://localhost/api/page", { method: "POST", body: JSON.stringify(body) });

const sentBody = (fetchMock: ReturnType<typeof vi.fn>, call: number) =>
  JSON.parse(fetchMock.mock.calls[call][1].body);

beforeEach(() => { process.env.OPENROUTER_API_KEY = "test-key"; });
afterEach(() => { vi.unstubAllGlobals(); });

describe("POST /api/page", () => {
  it("returns url, title, image, cost and model", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(completion('{"url":"www.x.com","title":"X"}', IMG)));
    const res = await POST(request({ prompt: "draw" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ url: "www.x.com", title: "X", image: IMG, costUsd: 0.034, model: DEFAULT_PAGE_MODEL });
    expect(typeof body.ms).toBe("number");
  });

  it("returns null metadata when the line is missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(completion("", IMG)));
    const body = await (await POST(request({ prompt: "draw" }))).json();
    expect(body).toMatchObject({ url: null, title: null, image: IMG });
  });

  it("retries once with the strict suffix when no image comes back", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(completion("I'd rather describe it.", undefined, 0.01))
      .mockResolvedValueOnce(completion('{"url":"a.com","title":"A"}', IMG, 0.03));
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(request({ prompt: "draw" }));
    expect(res.status).toBe(200);
    expect(sentBody(fetchMock, 1).messages[0].content[0].text).toBe("draw" + STRICT_SUFFIX);
    expect((await res.json()).costUsd).toBeCloseTo(0.04);
  });

  it("fades after two imageless responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(completion("no"))));
    const res = await POST(request({ prompt: "draw" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "faded" });
  });

  it("never leaks upstream detail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response('{"error":{"message":"secret stack trace at redis.js:42"}}', { status: 401 })
    ));
    const res = await POST(request({ prompt: "draw" }));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain("secret");
    expect(text).not.toContain("redis");
  });

  it("rejects a missing prompt", async () => {
    vi.stubGlobal("fetch", vi.fn());
    expect((await POST(request({}))).status).toBe(400);
    expect((await POST(new Request("http://localhost/api/page", { method: "POST", body: "not json" }))).status).toBe(400);
  });

  it("drops a non-image reference and an invalid model id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion("", IMG));
    vi.stubGlobal("fetch", fetchMock);
    await POST(request({ prompt: "draw", referenceImage: "https://evil/x.png", model: "../../etc" }));
    const sent = sentBody(fetchMock, 0);
    expect(sent.model).toBe(DEFAULT_PAGE_MODEL);
    expect(sent.messages[0].content).toHaveLength(1);
  });

  it("forwards a valid model id and reference image", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion("", IMG));
    vi.stubGlobal("fetch", fetchMock);
    await POST(request({ prompt: "draw", referenceImage: IMG, model: "google/gemini-3.1-flash-image" }));
    const sent = sentBody(fetchMock, 0);
    expect(sent.model).toBe("google/gemini-3.1-flash-image");
    expect(sent.messages[0].content[1]).toEqual({ type: "image_url", image_url: { url: IMG } });
  });
});
```

- [ ] **Step 4: Run the tests and confirm they fail**

Run: `npx vitest run api/_lib`
Expected: FAIL. `./pageGen`, `./image` and `../page` cannot be resolved; the openrouter tests still pass.

- [ ] **Step 5: Implement `api/_lib/pageGen.ts`**

```ts
// Request body and response parsing for the page image model.

import { completionCost, messageText, type ChatCompletion } from "./openrouter";

export const STRICT_SUFFIX = "\n\nRespond with the metadata line and an image only.";
export const MAX_PROMPT_CHARS = 4000;

export function pageBody(model: string, prompt: string, referenceImage?: string): Record<string, unknown> {
  const content: unknown[] = [{ type: "text", text: prompt }];
  if (referenceImage) content.push({ type: "image_url", image_url: { url: referenceImage } });
  return {
    model,
    modalities: ["image", "text"],
    image_config: { aspect_ratio: "4:3" },
    messages: [{ role: "user", content }],
  };
}

/** First `{...}` object in the text → url/title; anything unusable → null. */
export function parseMeta(text: string): { url: string | null; title: string | null } {
  const none = { url: null, title: null };
  const match = text.match(/\{[^{}]*\}/);
  if (!match) return none;
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    return { url: cleanString(obj.url), title: cleanString(obj.title) };
  } catch {
    return none;
  }
}

function cleanString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, 200);
  return s || null;
}

export function extractPageParts(c: ChatCompletion): { text: string; image: string | null; costUsd: number } {
  const images = c.choices?.[0]?.message?.images ?? [];
  const image = images
    .map((i) => i.image_url?.url)
    .find((u): u is string => typeof u === "string" && u.startsWith("data:image/")) ?? null;
  return { text: messageText(c), image, costUsd: completionCost(c) };
}
```

- [ ] **Step 6: Implement `api/_lib/crop.ts` (minimal) and `api/_lib/image.ts`**

`api/_lib/crop.ts` (Task 5 extends this file):

```ts
// Pure geometry for point resolve: which part of the page image to send to
// the link model, and how to map its answer back to full-image coordinates.
// Points and boxes are 0–1000; crop rects are image pixels.

import type { Point } from "../../src/types";

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
```

`api/_lib/image.ts`:

```ts
// Data-URI helpers for page images: size capping (Vercel's 4.5 MB body
// limit applies to responses and to the reference/scan requests that send
// the image back) and cropping for point resolve. sharp is loaded lazily.

import type { Point } from "../../src/types";
import { cropRect, type CropRect } from "./crop";

/** ~2.6 MB binary: leaves room for the image to travel back in a request. */
export const MAX_IMAGE_CHARS = 3_500_000;
const MAX_INPUT_CHARS = 6_000_000;
const DATA_URI_RE = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i;

export function isImageDataUri(v: unknown): v is string {
  return typeof v === "string" && v.length <= MAX_INPUT_CHARS && DATA_URI_RE.test(v);
}

export function decodeDataUri(uri: string): { mime: string; buf: Buffer } | null {
  const m = DATA_URI_RE.exec(uri);
  if (!m) return null;
  return { mime: m[1].toLowerCase(), buf: Buffer.from(m[2], "base64") };
}

async function loadSharp() {
  return (await import("sharp")).default;
}

const toDataUri = (mime: string, buf: Buffer) => `data:${mime};base64,${buf.toString("base64")}`;

export async function shrinkIfLarge(dataUri: string): Promise<string> {
  if (dataUri.length <= MAX_IMAGE_CHARS) return dataUri;
  const decoded = decodeDataUri(dataUri);
  if (!decoded) return dataUri;
  const sharp = await loadSharp();
  let out = await sharp(decoded.buf).jpeg({ quality: 82 }).toBuffer();
  if (Math.ceil(out.length / 3) * 4 > MAX_IMAGE_CHARS - 32) {
    out = await sharp(decoded.buf)
      .resize({ width: 1280, withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();
  }
  return toDataUri("image/jpeg", out);
}

export async function cropAround(
  dataUri: string,
  point: Point
): Promise<{ crop: string; rect: CropRect; width: number; height: number }> {
  const decoded = decodeDataUri(dataUri);
  if (!decoded) throw new Error("not an image data URI");
  const sharp = await loadSharp();
  const { width, height } = await sharp(decoded.buf).metadata();
  if (!width || !height) throw new Error("image has no dimensions");
  const rect = cropRect(point, width, height);
  const out = await sharp(decoded.buf).extract(rect).png().toBuffer();
  return { crop: toDataUri("image/png", out), rect, width, height };
}
```

- [ ] **Step 7: Implement `api/page.ts`**

```ts
// POST /api/page — { prompt, referenceImage?, model? } → PageResult.
// One retry with STRICT_SUFFIX when the model answers without an image;
// after that, { error: "faded" }. Upstream detail is logged, never returned.

import type { PageResult } from "../src/types";
import { json } from "./_lib/http";
import { isImageDataUri, shrinkIfLarge } from "./_lib/image";
import { DEFAULT_PAGE_MODEL, isModelId } from "./_lib/modelIds";
import { postChat } from "./_lib/openrouter";
import { extractPageParts, MAX_PROMPT_CHARS, pageBody, parseMeta, STRICT_SUFFIX } from "./_lib/pageGen";

export async function POST(req: Request): Promise<Response> {
  const t0 = Date.now();
  let input: { prompt?: unknown; referenceImage?: unknown; model?: unknown };
  try {
    input = await req.json();
  } catch {
    return json({ error: "bad-request" }, 400);
  }
  if (!input || typeof input.prompt !== "string" || !input.prompt.trim()) {
    return json({ error: "bad-request" }, 400);
  }
  const prompt = input.prompt.slice(0, MAX_PROMPT_CHARS);
  const referenceImage = isImageDataUri(input.referenceImage) ? input.referenceImage : undefined;
  const model = isModelId(input.model) ? input.model : DEFAULT_PAGE_MODEL;

  let costUsd = 0;
  try {
    for (const suffix of ["", STRICT_SUFFIX]) {
      const completion = await postChat(pageBody(model, prompt + suffix, referenceImage), { signal: req.signal });
      const parts = extractPageParts(completion);
      costUsd += parts.costUsd;
      if (!parts.image) continue;
      const result: PageResult = {
        ...parseMeta(parts.text),
        image: await shrinkIfLarge(parts.image),
        costUsd,
        ms: Date.now() - t0,
        model,
      };
      return json(result);
    }
  } catch (e) {
    console.error("[api/page]", e);
  }
  return json({ error: "faded", costUsd, ms: Date.now() - t0 }, 502);
}
```

- [ ] **Step 8: Run the tests and the build**

Run: `npm test && npm run build`
Expected: all PASS (the large-image test takes about a second), build succeeds.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json api/page.ts api/_lib
git commit -m "feat(api): /api/page image generation endpoint

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `/api/links`: link scan and point resolve

**Files:**
- Modify: `api/_lib/crop.ts` (add `pointInCrop`, `cropBoxToFull`)
- Create: `api/_lib/crop.test.ts`, `api/_lib/links.ts`, `api/_lib/links.test.ts`, `api/links.ts`, `api/_lib/links.handler.test.ts`

**Interfaces:**
- Consumes: `postChat`, `messageText`, `completionCost` (Task 3); `json`, `DEFAULT_LINK_MODEL`, `isModelId` (Task 3); `isImageDataUri`, `cropAround` (Task 4); `cropRect`, `CropRect` (Task 4); `Box`, `Link`, `LinkKind`, `Point`, `LinksResult`, `PointResult` from `src/types.ts`.
- Produces:
  ```ts
  // api/_lib/crop.ts (added)
  export function pointInCrop(point: Point, crop: CropRect, imgW: number, imgH: number): Point;
  export function cropBoxToFull(box: Box, crop: CropRect, imgW: number, imgH: number): Box;
  // api/_lib/links.ts
  export const SCAN_PROMPT: string;
  export function pointPrompt(p: Point): string;
  export function visionBody(model: string, text: string, image: string): Record<string, unknown>;
  export function parseJsonLoose(text: string): unknown;
  export function toBox(v: unknown): Box | null;
  export function toLink(raw: unknown): Link | null;
  export function parseLinks(text: string): Link[];
  export function parsePointLink(text: string): Link | null;
  export function toPoint(v: unknown): Point | null;
  // api/links.ts
  export async function POST(req: Request): Promise<Response>;
  //  {image, model?} → 200 LinksResult; {image, point, model?} → 200 PointResult;
  //  400 {error:"bad-request"}; 502 {error:"links-unavailable"}
  ```

- [ ] **Step 1: Write the failing crop geometry tests**

Create `api/_lib/crop.test.ts`:

```ts
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
```

- [ ] **Step 2: Write the failing parser tests**

Create `api/_lib/links.test.ts`:

```ts
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
```

- [ ] **Step 3: Write the failing handler tests**

Create `api/_lib/links.handler.test.ts`:

```ts
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../links";
import { DEFAULT_LINK_MODEL } from "./modelIds";

const reply = (content: string, cost = 0.004) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { cost } }), { status: 200 });

const request = (body: unknown) =>
  new Request("http://localhost/api/links", { method: "POST", body: JSON.stringify(body) });

let IMG = "";
beforeEach(async () => {
  process.env.OPENROUTER_API_KEY = "test-key";
  const png = await sharp({ create: { width: 1000, height: 1000, channels: 3, background: "#fff" } }).png().toBuffer();
  IMG = `data:image/png;base64,${png.toString("base64")}`;
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("POST /api/links", () => {
  it("scan: returns parsed links with cost and model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply('```json\n[{"label":"Shop","kind":"link","dest":"shop","external":false,"box_2d":[1,2,3,4]}]\n```'));
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(request({ image: IMG }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ links: [{ label: "Shop", box: [1, 2, 3, 4] }], costUsd: 0.004, model: DEFAULT_LINK_MODEL });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.temperature).toBe(0);
    expect(sent.messages[0].content[1].image_url.url).toBe(IMG);
  });

  it("point: sends the crop with the in-crop point and maps the box back", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply('{"label":"Buy","kind":"button","dest":"cart","external":false,"box_2d":[0,0,1000,1000]}'));
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(request({ image: IMG, point: { x: 500, y: 500 } }));
    const body = await res.json();
    expect(body.link).toMatchObject({ label: "Buy", box: [400, 350, 600, 650] });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.messages[0].content[0].text).toContain("(y=500, x=500)");
    expect(sent.messages[0].content[1].image_url.url).not.toBe(IMG);
  });

  it("point: returns link null when nothing is clickable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply("null")));
    const body = await (await POST(request({ image: IMG, point: { x: 10, y: 10 } }))).json();
    expect(body.link).toBeNull();
  });

  it("rejects a missing image or a bad point", async () => {
    vi.stubGlobal("fetch", vi.fn());
    expect((await POST(request({ image: "https://x/y.png" }))).status).toBe(400);
    expect((await POST(request({ image: IMG, point: { x: "a" } }))).status).toBe(400);
  });

  it("hides upstream failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("secret", { status: 401 })));
    const res = await POST(request({ image: IMG }));
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("secret");
  });
});
```

- [ ] **Step 4: Run the tests and confirm they fail**

Run: `npx vitest run api/_lib`
Expected: FAIL. `pointInCrop`/`cropBoxToFull` are not exported, and `./links` and `../links` cannot be resolved.

- [ ] **Step 5: Extend `api/_lib/crop.ts`**

Change the import line to `import type { Box, Point } from "../../src/types";` and append:

```ts
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
```

- [ ] **Step 6: Implement `api/_lib/links.ts`**

```ts
// Prompts and tolerant parsing for the link model. Malformed entries are
// dropped, not fatal; a truncated array keeps its complete prefix.

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

/** Parse the whole text, else the outermost JSON span, else salvage a truncated array. */
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
  if (s[start] === "[") {
    let close = s.lastIndexOf("}");
    for (let tries = 0; close > start && tries < 50; tries++) {
      const salvaged = tryParse(s.slice(start, close + 1) + "]");
      if (salvaged.ok) return salvaged.value;
      close = s.lastIndexOf("}", close - 1);
    }
  }
  return null;
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
      : [];
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
```

- [ ] **Step 7: Implement `api/links.ts`**

```ts
// POST /api/links
//   { image, model? }         → full scan:     LinksResult
//   { image, point, model? }  → point resolve: PointResult (crop around the click)

import type { LinksResult, PointResult } from "../src/types";
import { cropBoxToFull, pointInCrop } from "./_lib/crop";
import { json } from "./_lib/http";
import { cropAround, isImageDataUri } from "./_lib/image";
import { parseLinks, parsePointLink, pointPrompt, SCAN_PROMPT, toPoint, visionBody } from "./_lib/links";
import { DEFAULT_LINK_MODEL, isModelId } from "./_lib/modelIds";
import { completionCost, messageText, postChat } from "./_lib/openrouter";

export async function POST(req: Request): Promise<Response> {
  const t0 = Date.now();
  let input: { image?: unknown; point?: unknown; model?: unknown };
  try {
    input = await req.json();
  } catch {
    return json({ error: "bad-request" }, 400);
  }
  if (!input || !isImageDataUri(input.image)) return json({ error: "bad-request" }, 400);
  const image = input.image;
  const model = isModelId(input.model) ? input.model : DEFAULT_LINK_MODEL;
  const point = input.point === undefined ? undefined : toPoint(input.point);
  if (point === null) return json({ error: "bad-request" }, 400);

  try {
    if (point) {
      const { crop, rect, width, height } = await cropAround(image, point);
      const local = pointInCrop(point, rect, width, height);
      const completion = await postChat(visionBody(model, pointPrompt(local), crop), { signal: req.signal });
      const raw = parsePointLink(messageText(completion));
      const result: PointResult = {
        link: raw ? { ...raw, box: cropBoxToFull(raw.box, rect, width, height) } : null,
        costUsd: completionCost(completion),
        ms: Date.now() - t0,
        model,
      };
      return json(result);
    }
    const completion = await postChat(visionBody(model, SCAN_PROMPT, image), { signal: req.signal });
    const result: LinksResult = {
      links: parseLinks(messageText(completion)),
      costUsd: completionCost(completion),
      ms: Date.now() - t0,
      model,
    };
    return json(result);
  } catch (e) {
    console.error("[api/links]", e);
    return json({ error: "links-unavailable" }, 502);
  }
}
```

- [ ] **Step 8: Run the tests and the build**

Run: `npm test && npm run build`
Expected: all PASS, build succeeds.

- [ ] **Step 9: Commit**

```bash
git add api/links.ts api/_lib
git commit -m "feat(api): /api/links scan and point-resolve endpoint

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Dev server, Node runtime, and model catalog route

**Files:**
- Modify: `vite.config.ts` (full rewrite), `vercel.json`, `api/models.ts` (full rewrite)

**Interfaces:**
- Consumes: `POST` from `api/page.ts` and `api/links.ts`.
- Produces: `GET` in `api/models.ts` (OpenRouter catalog JSON, `{ data: [{ id, name, architecture: { input_modalities, output_modalities } }] }`). In dev, `npm run dev` serves `/api/page`, `/api/links` and `/api/models`.

Note: the old UI calls `/api/chat`, which no longer exists in dev after this task. That's expected; Task 9 replaces the UI.

- [ ] **Step 1: Rewrite `api/models.ts`**

```ts
// GET /api/models — thin proxy to the OpenRouter model catalog (dev panel pickers).

export async function GET(): Promise<Response> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return new Response("OPENROUTER_API_KEY not configured", { status: 500 });
  const upstream = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
```

- [ ] **Step 2: Switch Vercel to the default Node runtime**

Replace `vercel.json` with:

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "installCommand": "npm install"
}
```

- [ ] **Step 3: Rewrite `vite.config.ts`**

```ts
import type { IncomingMessage } from "node:http";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { POST as linksPost } from "./api/links";
import { GET as modelsGet } from "./api/models";
import { POST as pagePost } from "./api/page";

type Handler = (req: Request) => Promise<Response>;

// Dev-only: serve the api/ functions from the Vite server so `npm run dev`
// behaves like Vercel. Handlers are Web-standard (Request → Response).
const ROUTES: Record<string, Partial<Record<string, Handler>>> = {
  "/api/page": { POST: pagePost },
  "/api/links": { POST: linksPost },
  "/api/models": { GET: modelsGet },
};

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function apiDevServer(): Plugin {
  return {
    name: "api-dev-server",
    config(_config, { mode }) {
      const env = loadEnv(mode, process.cwd(), "");
      if (env.OPENROUTER_API_KEY && !process.env.OPENROUTER_API_KEY) {
        process.env.OPENROUTER_API_KEY = env.OPENROUTER_API_KEY;
      }
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const route = ROUTES[(req.url ?? "").split("?")[0]];
        if (!route) return next();
        const handler = route[req.method ?? "GET"];
        if (!handler) {
          res.statusCode = 405;
          res.end();
          return;
        }
        try {
          const hasBody = req.method !== "GET" && req.method !== "HEAD";
          const ac = new AbortController();
          res.on("close", () => {
            if (!res.writableEnded) ac.abort();
          });
          const response = await handler(
            new Request(`http://localhost${req.url}`, {
              method: req.method,
              headers: { "content-type": req.headers["content-type"] ?? "application/json" },
              body: hasBody ? await readBody(req) : undefined,
              signal: ac.signal,
            })
          );
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (e) {
          console.error("[api-dev-server]", e);
          if (!res.headersSent) res.statusCode = 500;
          res.end();
        }
      });
    },
  };
}

export default defineConfig({
  server: {
    port: 5173,
    host: "127.0.0.1",
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
  plugins: [apiDevServer()],
});
```

- [ ] **Step 4: Run the build and the tests**

Run: `npm test && npm run build`
Expected: all PASS, build succeeds.

- [ ] **Step 5: Smoke-test the endpoints against the real API (costs about $0.05)**

Needs `OPENROUTER_API_KEY` in `.env.local`. Start the dev server in a second terminal with `npm run dev`, then:

```bash
T=$(mktemp -d)
curl -s -X POST http://127.0.0.1:5173/api/page -H 'content-type: application/json' \
  -d '{"prompt":"Generate a full-page desktop screenshot of a parody web portal from a parallel universe, no browser frame. Before the image output one line of JSON: {\"url\": \"...\", \"title\": \"...\"}."}' \
  -o "$T/page.json"
node -e 'const r=require(process.argv[1]); console.log(r.error ?? [r.url, r.title, r.costUsd, r.ms, r.model, r.image.slice(0,30), r.image.length])' "$T/page.json"
node -e 'const r=require(process.argv[1]); process.stdout.write(JSON.stringify({image:r.image}))' "$T/page.json" > "$T/scan.json"
curl -s -X POST http://127.0.0.1:5173/api/links -H 'content-type: application/json' --data-binary @"$T/scan.json" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);console.log(r.error ?? [r.links.length+" links", r.costUsd, r.ms, JSON.stringify(r.links[0])])})'
curl -s http://127.0.0.1:5173/api/models | head -c 200; echo
```

Expected:
- The page line shows a url, a title, a cost of about 0.034, ms in the thousands, `data:image/...`, and a length ≤ 3500000.
- The links line shows more than 5 links and one link object with a `box`.
- The models line starts with `{"data":[`.

If any line prints `faded` / `links-unavailable`, read the dev-server terminal for the `[api/page]` / `[api/links]` log line before changing code.

- [ ] **Step 6: Commit**

```bash
git add vite.config.ts vercel.json api/models.ts
git commit -m "feat(dev): serve api functions from Vite; move to Node runtime

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Client API wrappers and session history

**Files:**
- Create: `src/openrouter.ts`, `src/openrouter.test.ts`, `src/session.ts`, `src/session.test.ts`

**Interfaces:**
- Consumes: types from `src/types.ts` (Task 1).
- Produces:
  ```ts
  // src/openrouter.ts
  export class FadedError extends Error {}
  export function isAbortError(e: unknown): boolean;
  export function fetchPage(body: { prompt: string; referenceImage?: string; model: string }, signal?: AbortSignal): Promise<PageResult>;
  export function fetchLinks(image: string, model: string, signal?: AbortSignal): Promise<LinksResult>;
  export function resolvePoint(image: string, point: Point, model: string, signal?: AbortSignal): Promise<PointResult>;
  export type CatalogModel = { id: string; inputModalities: string[]; outputModalities: string[] };
  export function listModels(): Promise<CatalogModel[]>;   // [] on any failure
  // src/session.ts
  export class Session { current(): Entry | null; push(e: Entry): void; back(): Entry | null; forward(): Entry | null; canBack(): boolean; canForward(): boolean }
  export function typedRequest(input: string): PageRequest;
  export function linkRequest(from: Entry, link: Link): PageRequest;      // internal or external
  export function searchRequest(from: Entry, link: Link, query: string): PageRequest;
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/openrouter.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { FadedError, fetchLinks, fetchPage, isAbortError, listModels, resolvePoint } from "./openrouter";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
afterEach(() => { vi.unstubAllGlobals(); });

describe("fetchPage", () => {
  it("POSTs JSON to /api/page and returns the result", async () => {
    const result = { url: "a.com", title: "A", image: "data:image/png;base64,AA", costUsd: 0.03, ms: 5000, model: "m" };
    const fetchMock = vi.fn().mockResolvedValue(ok(result));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchPage({ prompt: "p", model: "m" })).resolves.toEqual(result);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/page");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ prompt: "p", model: "m" });
  });

  it("turns a non-OK response into FadedError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error":"faded"}', { status: 502 })));
    await expect(fetchPage({ prompt: "p", model: "m" })).rejects.toBeInstanceOf(FadedError);
  });

  it("turns a network failure into FadedError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(fetchPage({ prompt: "p", model: "m" })).rejects.toBeInstanceOf(FadedError);
  });

  it("propagates AbortError (navigating away is not a fade)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError")));
    const err = await fetchPage({ prompt: "p", model: "m" }).catch((e) => e);
    expect(err).not.toBeInstanceOf(FadedError);
    expect(isAbortError(err)).toBe(true);
  });
});

describe("fetchLinks / resolvePoint", () => {
  it("send image (and point) to /api/links", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(ok({ links: [], link: null, costUsd: 0, ms: 1, model: "m" })));
    vi.stubGlobal("fetch", fetchMock);
    await fetchLinks("data:image/png;base64,AA", "m");
    await resolvePoint("data:image/png;base64,AA", { x: 1, y: 2 }, "m");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/links");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ image: "data:image/png;base64,AA", model: "m" });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ image: "data:image/png;base64,AA", point: { x: 1, y: 2 }, model: "m" });
  });
});

describe("listModels", () => {
  it("maps modalities", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ data: [
      { id: "g/img", architecture: { input_modalities: ["text", "image"], output_modalities: ["image", "text"] } },
      { id: "x/bare" },
    ] })));
    expect(await listModels()).toEqual([
      { id: "g/img", inputModalities: ["text", "image"], outputModalities: ["image", "text"] },
      { id: "x/bare", inputModalities: [], outputModalities: [] },
    ]);
  });
  it("returns [] on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    expect(await listModels()).toEqual([]);
  });
});
```

Create `src/session.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { linkRequest, searchRequest, Session, typedRequest } from "./session";
import type { Entry, Link } from "./types";

const entry = (url: string): Entry => ({ imageDataUri: `data:image/png;base64,${url}`, url, title: url.toUpperCase(), links: null, siteKey: url });
const link = (over: Partial<Link> = {}): Link => ({ label: "Shop", kind: "link", dest: "the shop", external: false, box: [0, 0, 10, 10], ...over });

describe("Session", () => {
  it("starts empty", () => {
    const s = new Session();
    expect(s.current()).toBeNull();
    expect(s.canBack()).toBe(false);
    expect(s.canForward()).toBe(false);
    expect(s.back()).toBeNull();
  });

  it("moves back and forward without losing entries", () => {
    const s = new Session();
    const [a, b, c] = [entry("a"), entry("b"), entry("c")];
    s.push(a); s.push(b); s.push(c);
    expect(s.back()).toBe(b);
    expect(s.back()).toBe(a);
    expect(s.canBack()).toBe(false);
    expect(s.forward()).toBe(b);
    expect(s.current()).toBe(b);
  });

  it("drops forward history on push", () => {
    const s = new Session();
    s.push(entry("a")); s.push(entry("b"));
    s.back();
    const d = entry("d");
    s.push(d);
    expect(s.current()).toBe(d);
    expect(s.canForward()).toBe(false);
    expect(s.back()?.url).toBe("a");
  });
});

describe("request builders", () => {
  it("typed", () => {
    expect(typedRequest("moon.com")).toEqual({ mode: "typed", input: "moon.com" });
  });
  it("internal link carries site and reference image", () => {
    const from = entry("cheese.net");
    expect(linkRequest(from, link())).toEqual({
      mode: "internal", site: { url: "cheese.net", title: "CHEESE.NET" }, label: "Shop", dest: "the shop", referenceImage: from.imageDataUri,
    });
  });
  it("external link carries only label and dest", () => {
    expect(linkRequest(entry("cheese.net"), link({ external: true }))).toEqual({ mode: "external", label: "Shop", dest: "the shop" });
  });
  it("search carries site, input label, query and reference image", () => {
    const from = entry("cheese.net");
    expect(searchRequest(from, link({ kind: "input", label: "Search" }), "brie")).toEqual({
      mode: "search", site: { url: "cheese.net", title: "CHEESE.NET" }, label: "Search", query: "brie", referenceImage: from.imageDataUri,
    });
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src`
Expected: FAIL, because `./openrouter` and `./session` cannot be resolved.

- [ ] **Step 3: Implement `src/openrouter.ts`**

```ts
// Browser-side wrappers for the same-origin api/ functions. Any failure other
// than an abort becomes FadedError; upstream detail never reaches the UI.

import type { LinksResult, PageResult, Point, PointResult } from "./types";

export class FadedError extends Error {
  constructor() {
    super("The mirage faded.");
    this.name = "FadedError";
  }
}

export function isAbortError(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError";
}

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw new FadedError();
    return (await res.json()) as T;
  } catch (e) {
    if (isAbortError(e) || e instanceof FadedError) throw e;
    throw new FadedError();
  }
}

export function fetchPage(
  body: { prompt: string; referenceImage?: string; model: string },
  signal?: AbortSignal
): Promise<PageResult> {
  return postJson<PageResult>("/api/page", body, signal);
}

export function fetchLinks(image: string, model: string, signal?: AbortSignal): Promise<LinksResult> {
  return postJson<LinksResult>("/api/links", { image, model }, signal);
}

export function resolvePoint(image: string, point: Point, model: string, signal?: AbortSignal): Promise<PointResult> {
  return postJson<PointResult>("/api/links", { image, point, model }, signal);
}

export type CatalogModel = { id: string; inputModalities: string[]; outputModalities: string[] };

export async function listModels(): Promise<CatalogModel[]> {
  try {
    const res = await fetch("/api/models");
    if (!res.ok) return [];
    const data = (await res.json()) as {
      data?: { id: string; architecture?: { input_modalities?: string[]; output_modalities?: string[] } }[];
    };
    return (data.data ?? []).map((m) => ({
      id: m.id,
      inputModalities: m.architecture?.input_modalities ?? [],
      outputModalities: m.architecture?.output_modalities ?? [],
    }));
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Implement `src/session.ts`**

```ts
// Session history (back/forward over hallucinated pages) and the builders
// that turn chrome actions into PageRequests. In-memory only, by design.

import type { Entry, Link, PageRequest } from "./types";

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
  };
}

export function searchRequest(from: Entry, link: Link, query: string): PageRequest {
  return {
    mode: "search",
    site: { url: from.url, title: from.title },
    label: link.label,
    query,
    referenceImage: from.imageDataUri,
  };
}
```

- [ ] **Step 5: Run the tests and the build**

Run: `npm test && npm run build`
Expected: all PASS, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/openrouter.ts src/openrouter.test.ts src/session.ts src/session.test.ts
git commit -m "feat: client API wrappers and session history

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Hotspot layer

**Files:**
- Create: `src/hotspots.ts`, `src/hotspots.test.ts`

**Interfaces:**
- Consumes: `Box`, `Link`, `Point` from `src/types.ts`.
- Produces:
  ```ts
  export type Rect = { left: number; top: number; width: number; height: number };
  export function containRect(boxW: number, boxH: number, natW: number, natH: number): Rect;
  export function boxToRect(box: Box, areaW: number, areaH: number): Rect;
  export function pixelToPoint(x: number, y: number, areaW: number, areaH: number): Point;
  export function hitTest(links: readonly Link[], p: Point): Link | null;   // smallest containing box, edges inclusive
  export type HotspotHandlers = {
    onFollow: (link: Link) => void;
    onSearch: (link: Link, query: string) => void;
    onResolve: (point: Point) => void;
    onHover: (link: Link | null) => void;
  };
  export class HotspotLayer {
    constructor(page: HTMLElement, img: HTMLImageElement, layer: HTMLElement, handlers: HotspotHandlers);
    setLinks(links: Link[] | null): void;
    showInput(link: Link): void;   // add + focus a transient input (point-resolved search box)
  }
  ```
  DOM contract (used by Task 9's HTML/CSS): the `img` has `object-fit: contain` and fills `page`. `layer` is absolutely positioned and gets the `.is-unmapped` / `.is-over-link` classes. Inputs get `.fd-hotspot-input`, and the hover outline gets `.fd-hotspot-hover`.

- [ ] **Step 1: Write the failing tests for the pure functions**

Create `src/hotspots.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/hotspots.test.ts`
Expected: FAIL, because `./hotspots` cannot be resolved.

- [ ] **Step 3: Implement `src/hotspots.ts`**

```ts
// Invisible link layer over the page image. Boxes arrive in Gemini's 0–1000
// [ymin, xmin, ymax, xmax] space; the pure helpers map them to pixels and
// hit-test pointer positions. Clicks and hover both go through hitTest so
// overlapping boxes resolve one way (smallest wins). Only text inputs are
// real elements, so visitors can type into the page's search boxes.

import type { Box, Link, Point } from "./types";

export type Rect = { left: number; top: number; width: number; height: number };

/** Where an object-fit: contain image actually renders inside its box. */
export function containRect(boxW: number, boxH: number, natW: number, natH: number): Rect {
  if (natW <= 0 || natH <= 0 || boxW <= 0 || boxH <= 0) {
    return { left: 0, top: 0, width: Math.max(0, boxW), height: Math.max(0, boxH) };
  }
  const scale = Math.min(boxW / natW, boxH / natH);
  const width = natW * scale;
  const height = natH * scale;
  return { left: (boxW - width) / 2, top: (boxH - height) / 2, width, height };
}

export function boxToRect(box: Box, areaW: number, areaH: number): Rect {
  const [ymin, xmin, ymax, xmax] = box;
  return {
    left: (xmin / 1000) * areaW,
    top: (ymin / 1000) * areaH,
    width: ((xmax - xmin) / 1000) * areaW,
    height: ((ymax - ymin) / 1000) * areaH,
  };
}

export function pixelToPoint(x: number, y: number, areaW: number, areaH: number): Point {
  if (areaW <= 0 || areaH <= 0) return { x: 0, y: 0 };
  const clamp = (v: number) => Math.min(1000, Math.max(0, v));
  return { x: clamp((x / areaW) * 1000), y: clamp((y / areaH) * 1000) };
}

export function hitTest(links: readonly Link[], p: Point): Link | null {
  let best: Link | null = null;
  let bestArea = Infinity;
  for (const link of links) {
    const [ymin, xmin, ymax, xmax] = link.box;
    if (p.x < xmin || p.x > xmax || p.y < ymin || p.y > ymax) continue;
    const area = (xmax - xmin) * (ymax - ymin);
    if (area < bestArea) {
      best = link;
      bestArea = area;
    }
  }
  return best;
}

export type HotspotHandlers = {
  onFollow: (link: Link) => void;
  onSearch: (link: Link, query: string) => void;
  onResolve: (point: Point) => void;
  onHover: (link: Link | null) => void;
};

function place(el: HTMLElement, r: Rect): void {
  el.style.left = `${r.left}px`;
  el.style.top = `${r.top}px`;
  el.style.width = `${r.width}px`;
  el.style.height = `${r.height}px`;
}

export class HotspotLayer {
  private links: Link[] | null = null;
  private extraInputs: Link[] = [];
  private readonly inputs = new Map<Link, HTMLInputElement>();
  private hovered: Link | null = null;
  private readonly hoverBox: HTMLDivElement;

  constructor(
    private readonly page: HTMLElement,
    private readonly img: HTMLImageElement,
    private readonly layer: HTMLElement,
    private readonly handlers: HotspotHandlers
  ) {
    this.hoverBox = document.createElement("div");
    this.hoverBox.className = "fd-hotspot-hover";
    this.hoverBox.hidden = true;
    new ResizeObserver(() => this.layout()).observe(page);
    img.addEventListener("load", () => this.layout());
    layer.addEventListener("mousemove", (e) => this.onMove(e));
    layer.addEventListener("mouseleave", () => this.setHover(null));
    layer.addEventListener("click", (e) => this.onClick(e));
  }

  /** null = not mapped yet: empty-area clicks trigger point resolve. */
  setLinks(links: Link[] | null): void {
    this.links = links;
    this.extraInputs = [];
    this.hovered = null;
    this.handlers.onHover(null);
    this.layer.classList.remove("is-over-link");
    this.layer.classList.toggle("is-unmapped", links === null);
    this.render();
  }

  showInput(link: Link): void {
    this.extraInputs.push(link);
    this.render();
    this.inputs.get(link)?.focus();
  }

  private render(): void {
    this.inputs.clear();
    this.hoverBox.hidden = true;
    this.layer.replaceChildren(this.hoverBox);
    const inputs = [...(this.links ?? []).filter((l) => l.kind === "input"), ...this.extraInputs];
    for (const link of inputs) {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "fd-hotspot-input";
      input.title = link.dest;
      input.setAttribute("aria-label", link.label);
      input.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const query = input.value.trim();
        if (query) this.handlers.onSearch(link, query);
      });
      this.inputs.set(link, input);
      this.layer.appendChild(input);
    }
    this.layout();
  }

  private layout(): void {
    const area = containRect(this.page.clientWidth, this.page.clientHeight, this.img.naturalWidth, this.img.naturalHeight);
    place(this.layer, area);
    for (const [link, input] of this.inputs) place(input, boxToRect(link.box, area.width, area.height));
    if (this.hovered) place(this.hoverBox, boxToRect(this.hovered.box, area.width, area.height));
  }

  private pointFor(e: MouseEvent): Point {
    const r = this.layer.getBoundingClientRect();
    return pixelToPoint(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
  }

  private onMove(e: MouseEvent): void {
    if (e.target instanceof HTMLInputElement) return;
    this.setHover(this.links ? hitTest(this.links, this.pointFor(e)) : null);
  }

  private setHover(link: Link | null): void {
    if (link === this.hovered) return;
    this.hovered = link;
    this.hoverBox.hidden = !link;
    this.layer.classList.toggle("is-over-link", link !== null);
    this.layout();
    this.handlers.onHover(link);
  }

  private onClick(e: MouseEvent): void {
    if (e.target instanceof HTMLInputElement) return;
    e.preventDefault();
    const point = this.pointFor(e);
    if (this.links === null) {
      this.handlers.onResolve(point);
      return;
    }
    const hit = hitTest(this.links, point);
    if (!hit) return;
    if (hit.kind === "input") {
      this.inputs.get(hit)?.focus();
      return;
    }
    this.handlers.onFollow(hit);
  }
}
```

- [ ] **Step 4: Run the tests and the build**

Run: `npm test && npm run build`
Expected: all PASS, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/hotspots.ts src/hotspots.test.ts
git commit -m "feat: hotspot layer with pure box scaling and hit-testing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Swap the browser to the image pipeline

This task replaces the UI wholesale. The old modules are interlocked, so the build only goes green again once all the steps are done. Commit once at the end.

**Files:**
- Create: `src/loading.ts`, `src/loading.test.ts`, `src/modelStats.test.ts`
- Rewrite: `src/modelStats.ts`, `src/devPanel.ts`, `src/main.ts`, `src/types.ts`, `src/style.css`, `index.html`, `.env.example`
- Modify: `tsconfig.api.json` (drop `exclude`), `package.json` (remove dompurify)
- Delete: `src/hallucinate.ts`, `src/render.ts`, `src/classify.ts`, `src/handoff.ts`, `src/homepageContract.ts`, `src/agent.ts`, `src/systemPrompts.ts`, `src/ollama.ts`, `api/chat.ts`, `api/image.ts`, `api/image-gemini.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–8. Exact names: `buildPagePrompt`; `deriveMeta`, `siteKeyOf`; `fetchPage`, `fetchLinks`, `resolvePoint`, `listModels`, `isAbortError`, `CatalogModel`; `Session`, `typedRequest`, `linkRequest`, `searchRequest`; `HotspotLayer`.
- Produces:
  ```ts
  // src/types.ts (added)
  export type LinkMode = "scan" | "click-only";
  export type AppSettings = { pageModel: string; linkModel: string; linkMode: LinkMode };
  // src/modelStats.ts
  export type RunKind = "page" | "links" | "point";
  export type RunRecord = { at: number; kind: RunKind; model: string; ms: number; costUsd: number; ok: boolean };
  export const MAX_RUNS = 200;
  export function recordRun(r: Omit<RunRecord, "at">): void;
  export function recentRuns(limit?: number): RunRecord[];   // newest first
  export function totalCost(): number;                       // whole session, survives the MAX_RUNS cap
  export function clearRuns(): void;
  export function onRunsChanged(cb: () => void): () => void;
  // src/loading.ts
  export const TUNING_LINES: readonly string[];
  export function tuningLine(i: number, dimension: number): string;
  export function usesHaze(mode: NavMode, hasPage: boolean): boolean;
  export class LoadingView { start(mode: NavMode, dimension: number, hasPage: boolean): void; arrive(): void; stop(): void }
  // src/devPanel.ts
  export const DEFAULT_SETTINGS: AppSettings;
  export function loadSettings(): AppSettings;
  export function saveSettings(s: AppSettings): void;
  export function setupDevPanel(onChange: (s: AppSettings) => void): { toggle: () => void };
  ```

- [ ] **Step 1: Write the failing tests for the run log and loading helpers**

Create `src/modelStats.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearRuns, MAX_RUNS, onRunsChanged, recentRuns, recordRun, totalCost } from "./modelStats";

const run = (costUsd: number, kind: "page" | "links" | "point" = "page") =>
  ({ kind, model: "m", ms: 1000, costUsd, ok: true });

beforeEach(() => clearRuns());

describe("modelStats", () => {
  it("records runs newest first with a timestamp", () => {
    recordRun(run(0.03, "page"));
    recordRun(run(0.004, "links"));
    const [latest, first] = recentRuns();
    expect(latest.kind).toBe("links");
    expect(first.kind).toBe("page");
    expect(typeof latest.at).toBe("number");
  });

  it("limits recentRuns", () => {
    for (let i = 0; i < 30; i++) recordRun(run(0));
    expect(recentRuns(5)).toHaveLength(5);
  });

  it("keeps the session total even past the cap", () => {
    for (let i = 0; i < MAX_RUNS + 10; i++) recordRun(run(0.01));
    expect(recentRuns(MAX_RUNS + 50)).toHaveLength(MAX_RUNS);
    expect(totalCost()).toBeCloseTo((MAX_RUNS + 10) * 0.01);
  });

  it("notifies listeners and resets on clear", () => {
    const cb = vi.fn();
    const off = onRunsChanged(cb);
    recordRun(run(0.02));
    clearRuns();
    expect(cb).toHaveBeenCalledTimes(2);
    expect(totalCost()).toBe(0);
    off();
    recordRun(run(0.02));
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
```

Create `src/loading.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TUNING_LINES, tuningLine, usesHaze } from "./loading";

describe("tuningLine", () => {
  it("rotates through the lines", () => {
    expect(tuningLine(0, 4817)).toBe("Receiving signal from a neighbouring universe…");
    expect(tuningLine(TUNING_LINES.length, 4817)).toBe(tuningLine(0, 4817));
  });
  it("formats the dimension number", () => {
    expect(tuningLine(1, 4817)).toBe("Tuned to dimension #4,817");
  });
});

describe("usesHaze", () => {
  it("hazes same-site navigation over an existing page", () => {
    expect(usesHaze("internal", true)).toBe(true);
    expect(usesHaze("search", true)).toBe(true);
  });
  it("tunes for new universes or when there is no page yet", () => {
    expect(usesHaze("typed", true)).toBe(false);
    expect(usesHaze("external", true)).toBe(false);
    expect(usesHaze("internal", false)).toBe(false);
  });
});
```

Run: `npx vitest run src/modelStats.test.ts src/loading.test.ts`
Expected: FAIL (`recordRun`/`./loading` don't exist yet).

- [ ] **Step 2: Rewrite `src/modelStats.ts`**

```ts
// In-memory log of model calls (page, link scan, point resolve) for the dev
// panel: cost and latency per request. Session-only by design.

export type RunKind = "page" | "links" | "point";

export type RunRecord = {
  at: number;
  kind: RunKind;
  model: string;
  ms: number;
  costUsd: number;
  ok: boolean;
};

export const MAX_RUNS = 200;

let runs: RunRecord[] = [];
let total = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const cb of listeners) cb();
}

export function recordRun(r: Omit<RunRecord, "at">): void {
  runs.push({ ...r, at: Date.now() });
  if (runs.length > MAX_RUNS) runs = runs.slice(-MAX_RUNS);
  total += r.costUsd;
  notify();
}

export function recentRuns(limit = 20): RunRecord[] {
  return runs.slice(-limit).reverse();
}

export function totalCost(): number {
  return total;
}

export function clearRuns(): void {
  runs = [];
  total = 0;
  notify();
}

export function onRunsChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
```

- [ ] **Step 3: Create `src/loading.ts`**

```ts
// Diegetic loading states (CSS-driven): heat haze over the current page for
// same-site navigation, a static "tuning" screen for new universes, and an
// elapsed-seconds readout in the status bar.

import type { NavMode } from "./types";

export const TUNING_LINES: readonly string[] = [
  "Receiving signal from a neighbouring universe…",
  "Tuned to dimension #{dim}",
  "Locking onto carrier wave…",
  "Resolving alternate DNS…",
  "Translating quantum packets…",
];

export function tuningLine(i: number, dimension: number): string {
  return TUNING_LINES[i % TUNING_LINES.length].replace("{dim}", dimension.toLocaleString("en-US"));
}

export function usesHaze(mode: NavMode, hasPage: boolean): boolean {
  return hasPage && (mode === "internal" || mode === "search");
}

type LoadingEls = { page: HTMLElement; tuning: HTMLElement; tuningText: HTMLElement; status: HTMLElement };

export class LoadingView {
  private timers: number[] = [];

  constructor(private readonly els: LoadingEls) {}

  start(mode: NavMode, dimension: number, hasPage: boolean): void {
    this.stop();
    const t0 = performance.now();
    const haze = usesHaze(mode, hasPage);
    const verb = haze ? "Shimmering" : "Tuning in";
    const tick = () => {
      this.els.status.textContent = `${verb}… ${Math.floor((performance.now() - t0) / 1000)}s`;
    };
    tick();
    this.timers.push(window.setInterval(tick, 250));

    if (haze) {
      this.els.page.classList.add("is-hazy");
      return;
    }
    let line = 0;
    this.els.tuningText.textContent = tuningLine(line, dimension);
    this.els.tuning.hidden = false;
    this.timers.push(window.setInterval(() => {
      this.els.tuningText.textContent = tuningLine(++line, dimension);
    }, 1600));
  }

  /** New image is in place: stop loading and fade it in from noise. */
  arrive(): void {
    this.stop();
    const { page } = this.els;
    void page.offsetWidth; // restart the CSS animation
    page.classList.add("is-arriving");
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.els.page.classList.remove("is-hazy", "is-arriving");
    this.els.tuning.hidden = true;
  }
}
```

- [ ] **Step 4: Rewrite `src/types.ts`**

Replace the whole file. This removes `Role`, `ChatMessage`, `SitemapEntry`, `Page`, `Handoff`, `AgentStatus`, `Agent`, `VisualArchetype`, `ClassifyResult`, `ModelSafetyParams`, `PageStreamChunk` and the old `AppSettings`, and adds `LinkMode` and the new `AppSettings`:

```ts
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
```

- [ ] **Step 5: Rewrite `src/devPanel.ts`**

```ts
// Hidden dev panel (Ctrl+Shift+D or the ⚙ Dev button): page/link model
// selection, link mode, and a live per-request log of cost and latency.
// Settings persist to localStorage; the run log is in-memory only.

import { listModels } from "./openrouter";
import { clearRuns, onRunsChanged, recentRuns, totalCost, type RunRecord } from "./modelStats";
import type { AppSettings, LinkMode } from "./types";

const STORAGE_KEY = "mirage.settings.v2";

export const DEFAULT_SETTINGS: AppSettings = {
  pageModel: "google/gemini-3.1-flash-lite-image",
  linkModel: "google/gemini-3-flash-preview",
  linkMode: "scan",
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const p = (raw ? JSON.parse(raw) : {}) as Partial<AppSettings>;
    return {
      pageModel: typeof p.pageModel === "string" && p.pageModel ? p.pageModel : DEFAULT_SETTINGS.pageModel,
      linkModel: typeof p.linkModel === "string" && p.linkModel ? p.linkModel : DEFAULT_SETTINGS.linkModel,
      linkMode: p.linkMode === "click-only" ? "click-only" : "scan",
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // storage unavailable: settings last for this tab only
  }
}

function fillSelect(sel: HTMLSelectElement, ids: string[], current: string): void {
  const all = ids.includes(current) ? ids : [current, ...ids];
  sel.replaceChildren(...all.map((id) => new Option(id, id, false, id === current)));
}

function rowFor(r: RunRecord): HTMLTableRowElement {
  const tr = document.createElement("tr");
  if (!r.ok) tr.className = "fd-run-failed";
  const cells = [r.kind, r.model.split("/").pop() ?? r.model, (r.ms / 1000).toFixed(1), r.costUsd.toFixed(4)];
  for (const text of cells) {
    const td = document.createElement("td");
    td.textContent = text;
    tr.appendChild(td);
  }
  return tr;
}

export function setupDevPanel(onChange: (s: AppSettings) => void): { toggle: () => void } {
  let settings = loadSettings();

  const win = document.createElement("div");
  win.className = "window fd-devpanel";
  win.hidden = true;
  win.innerHTML = `
    <div class="title-bar">
      <div class="title-bar-text">Dimensional Tuning Panel</div>
      <div class="title-bar-controls"><button aria-label="Close" data-close></button></div>
    </div>
    <div class="window-body">
      <fieldset>
        <legend>Models</legend>
        <div class="field-row-stacked">
          <label for="fd-page-model">Page model (image output)</label>
          <select id="fd-page-model"></select>
        </div>
        <div class="field-row-stacked">
          <label for="fd-link-model">Link model (image input)</label>
          <select id="fd-link-model"></select>
        </div>
      </fieldset>
      <fieldset>
        <legend>Link mode</legend>
        <div class="field-row">
          <input type="radio" id="fd-mode-scan" name="fd-link-mode" value="scan">
          <label for="fd-mode-scan">scan: map links after each page (hover + inputs)</label>
        </div>
        <div class="field-row">
          <input type="radio" id="fd-mode-click" name="fd-link-mode" value="click-only">
          <label for="fd-mode-click">click-only: resolve each click on demand</label>
        </div>
      </fieldset>
      <fieldset>
        <legend>Run log</legend>
        <p id="fd-run-total"></p>
        <table class="fd-runlog">
          <thead><tr><th>kind</th><th>model</th><th>s</th><th>$</th></tr></thead>
          <tbody id="fd-run-rows"></tbody>
        </table>
        <div class="field-row"><button id="fd-run-clear">Clear</button></div>
      </fieldset>
    </div>`;
  document.body.appendChild(win);

  const q = <T extends Element>(sel: string) => win.querySelector(sel) as T;
  const pageSel = q<HTMLSelectElement>("#fd-page-model");
  const linkSel = q<HTMLSelectElement>("#fd-link-model");

  fillSelect(pageSel, [], settings.pageModel);
  fillSelect(linkSel, [], settings.linkModel);
  void listModels().then((models) => {
    fillSelect(pageSel, models.filter((m) => m.outputModalities.includes("image")).map((m) => m.id), settings.pageModel);
    fillSelect(linkSel, models.filter((m) => m.inputModalities.includes("image")).map((m) => m.id), settings.linkModel);
  });
  q<HTMLInputElement>(settings.linkMode === "scan" ? "#fd-mode-scan" : "#fd-mode-click").checked = true;

  const commit = (patch: Partial<AppSettings>) => {
    settings = { ...settings, ...patch };
    saveSettings(settings);
    onChange(settings);
  };
  pageSel.addEventListener("change", () => commit({ pageModel: pageSel.value }));
  linkSel.addEventListener("change", () => commit({ linkModel: linkSel.value }));
  win.querySelectorAll<HTMLInputElement>('input[name="fd-link-mode"]').forEach((radio) => {
    radio.addEventListener("change", () => commit({ linkMode: radio.value as LinkMode }));
  });

  const renderLog = () => {
    q<HTMLElement>("#fd-run-total").textContent = `Session total: $${totalCost().toFixed(4)}`;
    q<HTMLElement>("#fd-run-rows").replaceChildren(...recentRuns(20).map(rowFor));
  };
  onRunsChanged(renderLog);
  renderLog();
  q<HTMLButtonElement>("#fd-run-clear").addEventListener("click", clearRuns);

  const toggle = () => {
    win.hidden = !win.hidden;
  };
  q<HTMLButtonElement>("[data-close]").addEventListener("click", () => {
    win.hidden = true;
  });
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "d") {
      e.preventDefault();
      toggle();
    }
  });
  return { toggle };
}
```

- [ ] **Step 6: Rewrite `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Mirage</title>
    <link rel="stylesheet" href="https://unpkg.com/98.css@0.1.0" />
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' fill='%23c0c0c0'/%3E%3Crect x='2' y='2' width='12' height='2' fill='%23ffffff'/%3E%3Crect x='2' y='12' width='12' height='2' fill='%23808080'/%3E%3Crect x='2' y='2' width='2' height='12' fill='%23ffffff'/%3E%3Crect x='12' y='2' width='2' height='12' fill='%23808080'/%3E%3Crect x='4' y='4' width='8' height='8' fill='%23000080'/%3E%3Ctext x='8' y='10' font-size='6' fill='%23ffff00' text-anchor='middle' font-family='monospace'%3EF%3C/text%3E%3C/svg%3E" />
  </head>
  <body>
    <div id="app">
      <div class="window fd-window" style="width: 100%; height: 100vh; display: flex; flex-direction: column;">
        <div class="title-bar">
          <div class="title-bar-text">
            <span id="fd-title-prefix">🌐</span>
            <span id="fd-title">Mirage — Untitled Page</span>
          </div>
        </div>

        <div class="fd-toolbar">
          <button id="fd-back" aria-label="Back" title="Back" class="fd-iconbtn">◀</button>
          <button id="fd-forward" aria-label="Forward" title="Forward" class="fd-iconbtn">▶</button>
          <button id="fd-reload" aria-label="Reload" title="Re-tune (same address, new universe)" class="fd-iconbtn">⟳</button>
          <button id="fd-home" aria-label="Home" title="Home" class="fd-iconbtn">🏠</button>
          <span class="fd-toolbar-sep"></span>
          <span class="fd-label">Address:</span>
          <input id="fd-url" type="text" style="flex: 1; min-width: 200px;" placeholder="type anything" />
          <button id="fd-go" class="default">Go!</button>
          <span class="fd-toolbar-sep"></span>
          <button id="fd-devpanel-btn" class="fd-iconbtn" title="Dev Panel (Ctrl+Shift+D)" style="font-size:11px; padding: 0 6px;">⚙ Dev</button>
        </div>

        <div class="window-body fd-content" style="flex: 1; padding: 2px; position: relative; overflow: hidden;">
          <div id="fd-page" class="page">
            <img id="fd-img" alt="" />
            <div id="fd-hotspots" class="hotspots"></div>
          </div>
          <div id="fd-tuning" class="fd-tuning" hidden><p id="fd-tuning-text"></p></div>
          <div id="fd-faded" class="window fd-faded" hidden>
            <div class="window-body">
              <p>⚠ The mirage faded.</p>
              <button id="fd-faded-retry">Retry</button>
            </div>
          </div>
        </div>

        <div class="status-bar">
          <p class="status-bar-field" style="flex:1; min-width:0;" id="fd-status-main">Home universe: unreachable.</p>
          <p class="status-bar-field">Tuned to dimension #<span id="fd-dimension">4,817</span></p>
          <p class="status-bar-field" style="min-width:180px; font-family: monospace; font-size:10px; white-space:nowrap; overflow:hidden;" id="fd-status-diag"></p>
          <p class="status-bar-field">🌐 Mirage v0.2</p>
        </div>
      </div>
    </div>

    <div id="fd-splash" class="fd-splash">
      <div class="window">
        <div class="title-bar">
          <div class="title-bar-text">Mirage</div>
          <div class="title-bar-controls">
            <button aria-label="Close" id="fd-splash-close"></button>
          </div>
        </div>
        <div class="window-body fd-splash-body">
          <h2 style="margin: 4px 0 12px 0;">🌐 Welcome to Mirage</h2>
          <p>Mirage is a browser that can only reach the internets of neighbouring parallel universes. Every page arrives from a dimension adjacent to ours: familiar, but never quite right.</p>
          <p><strong>How to navigate the multiverse:</strong></p>
          <ul style="margin: 6px 0 12px 20px;">
            <li>Type anything in the Address bar and press <strong>Go!</strong> to tune to a new dimension</li>
            <li>Click anything on a page. Most links keep you on the site; ads and partner badges take you somewhere else entirely</li>
            <li>Type into a page's search box and press Enter</li>
            <li>Use ◀ ▶ to retrace your steps; ⟳ re-tunes the same address to a new universe</li>
          </ul>
          <p><strong>Note:</strong> each page takes a few seconds to come into focus.</p>
          <div class="field-row" style="justify-content: flex-end; margin-top: 12px;">
            <button class="default" id="fd-splash-go">Tune In 📡</button>
          </div>
        </div>
      </div>
    </div>

    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 7: Rewrite `src/style.css`**

```css
/* Mirage — global styles. 98.css chrome; heat-haze and static loading states. */

@import url("https://fonts.googleapis.com/css2?family=VT323&display=swap");

:root {
  --fd-bg: #c0c0c0;
  --fd-blue: #000080;
  --fd-red: #c00000;
  --fd-noise: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}

* { box-sizing: border-box; }
[hidden] { display: none !important; }

html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  background: #008080;
  font-family: "MS Sans Serif", "Microsoft Sans Serif", Tahoma, Geneva, sans-serif;
  font-size: 13px;
  color: #000;
  overflow: hidden;
}

#app { height: 100vh; padding: 0; }

.fd-window { height: 100vh; font-size: 14px; }
.fd-window .title-bar { font-size: 14px; }
.fd-window .status-bar { font-size: 13px; }

/* Toolbar */
.fd-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  background: var(--fd-bg);
  border-bottom: 1px solid #808080;
}
.fd-iconbtn { width: 28px; height: 24px; min-width: 28px; padding: 0; font-size: 14px; line-height: 1; }
.fd-toolbar-sep { width: 1px; height: 22px; background: #808080; border-right: 1px solid #fff; margin: 0 4px; }
.fd-label { font-size: 13px; color: #000; }
.fd-toolbar input[type="text"] { font-family: "MS Sans Serif", Tahoma, sans-serif; }

/* Status bar */
.status-bar { display: flex; padding: 2px; gap: 2px; font-size: 12px; }
.status-bar-field { margin: 0; padding: 2px 6px; }

/* Page area: the image is letterboxed (object-fit: contain) inside .page;
   hotspots.ts positions .hotspots over the rendered image. */
.fd-content { background: #808080; }
.page { position: relative; width: 100%; height: 100%; overflow: hidden; }
.page img { display: block; width: 100%; height: 100%; object-fit: contain; }
.page img:not([src]) { visibility: hidden; }
.hotspots { position: absolute; z-index: 2; }
.hotspots.is-over-link, .hotspots.is-unmapped { cursor: pointer; }
.fd-hotspot-hover {
  position: absolute;
  pointer-events: none;
  outline: 1px dotted rgba(0, 0, 128, 0.7);
  background: rgba(255, 255, 160, 0.12);
}
.fd-hotspot-input {
  position: absolute;
  margin: 0;
  padding: 0 4px;
  border: 0;
  background: transparent;
  font: 14px Arial, sans-serif;
  color: #000;
  outline: none;
}
.fd-hotspot-input:focus { background: rgba(255, 255, 255, 0.92); outline: 1px dotted var(--fd-blue); }

/* Same-site navigation: the current page wavers in a heat haze */
.page.is-hazy img {
  filter: blur(2px) saturate(0.35) brightness(1.08);
  animation: fd-haze 1.4s ease-in-out infinite alternate;
}
.page.is-hazy::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(180deg, transparent 0%, rgba(255, 230, 180, 0.18) 50%, transparent 100%);
  background-size: 100% 300%;
  animation: fd-shimmer 2.2s linear infinite;
}
@keyframes fd-haze {
  from { transform: scale(1.004) skewX(0.4deg); }
  to   { transform: scale(0.996) skewX(-0.4deg); }
}
@keyframes fd-shimmer {
  from { background-position: 0 100%; }
  to   { background-position: 0 -200%; }
}

/* A new page fades in from noise */
.page.is-arriving img { animation: fd-arrive 0.9s ease-out; }
.page.is-arriving::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background: var(--fd-noise);
  opacity: 0;
  animation: fd-noise-out 0.9s ease-out;
}
@keyframes fd-arrive {
  from { opacity: 0; filter: grayscale(1) contrast(2.5) blur(3px); }
  to   { opacity: 1; filter: none; }
}
@keyframes fd-noise-out {
  from { opacity: 0.9; }
  to   { opacity: 0; }
}

/* New universe: static "tuning" screen */
.fd-tuning {
  position: absolute;
  inset: 2px;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #111 var(--fd-noise);
  animation: fd-static 0.25s steps(3) infinite;
}
.fd-tuning p {
  margin: 0;
  padding: 6px 14px;
  background: rgba(0, 0, 0, 0.75);
  color: #9f9;
  font-family: "VT323", "Courier New", monospace;
  font-size: 28px;
}
@keyframes fd-static {
  0%   { background-position: 0 0; }
  33%  { background-position: -57px 31px; }
  66%  { background-position: 43px -71px; }
  100% { background-position: 0 0; }
}

/* Error notice: the previous page stays visible behind it */
.fd-faded { position: absolute; top: 16px; left: 50%; transform: translateX(-50%); z-index: 4; width: 320px; }
.fd-faded .window-body { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.fd-faded p { margin: 0; color: var(--fd-red); font-weight: bold; }

/* Splash */
.fd-splash {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 9999;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  cursor: pointer;
}
.fd-splash > .window { cursor: default; width: 540px; }
.fd-splash-body { padding: 14px 18px; font-size: 14px; }
.fd-splash-body button { font-size: 13px; }

/* Dev panel */
.fd-devpanel {
  position: fixed;
  top: 60px;
  right: 24px;
  z-index: 10000;
  width: 440px;
  box-shadow: 2px 2px 10px rgba(0, 0, 0, 0.4);
}
.fd-devpanel .window-body { font-size: 12px; max-height: 80vh; overflow-y: auto; }
.fd-devpanel select { width: 100%; }
.fd-runlog { width: 100%; border-collapse: collapse; font-family: monospace; font-size: 11px; }
.fd-runlog th, .fd-runlog td { padding: 1px 4px; text-align: left; }
.fd-run-failed { color: var(--fd-red); }

/* Title bar mascot */
#fd-title-prefix { display: inline-block; animation: fd-bob 1.6s ease-in-out infinite; }
@keyframes fd-bob {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-1px); }
}

/* Faint CRT scanlines over the whole window */
.fd-window::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(0deg, transparent 0px, transparent 2px, rgba(0, 0, 0, 0.02) 2px, rgba(0, 0, 0, 0.02) 3px);
  z-index: 1;
}
```

- [ ] **Step 8: Rewrite `src/main.ts`**

```ts
// Main app: boots the browser chrome and wires navigation (URL bar, hotspot
// clicks, search inputs, back/forward/home/reload) to the image pipeline.
// /api/page draws each page; /api/links maps its links in the background.

import "./style.css";
import { loadSettings, setupDevPanel } from "./devPanel";
import { HotspotLayer } from "./hotspots";
import { LoadingView } from "./loading";
import { recordRun } from "./modelStats";
import { fetchLinks, fetchPage, isAbortError, resolvePoint } from "./openrouter";
import { buildPagePrompt } from "./pageContract";
import { deriveMeta, siteKeyOf } from "./pageMeta";
import { linkRequest, searchRequest, Session, typedRequest } from "./session";
import type { Entry, PageRequest, Point } from "./types";

const $ = <T extends Element>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Element not found: ${sel}`);
  return el;
};

const dom = {
  title: $<HTMLSpanElement>("#fd-title"),
  urlBar: $<HTMLInputElement>("#fd-url"),
  go: $<HTMLButtonElement>("#fd-go"),
  back: $<HTMLButtonElement>("#fd-back"),
  forward: $<HTMLButtonElement>("#fd-forward"),
  reload: $<HTMLButtonElement>("#fd-reload"),
  home: $<HTMLButtonElement>("#fd-home"),
  devBtn: $<HTMLButtonElement>("#fd-devpanel-btn"),
  page: $<HTMLDivElement>("#fd-page"),
  img: $<HTMLImageElement>("#fd-img"),
  layer: $<HTMLDivElement>("#fd-hotspots"),
  tuning: $<HTMLDivElement>("#fd-tuning"),
  tuningText: $<HTMLParagraphElement>("#fd-tuning-text"),
  faded: $<HTMLDivElement>("#fd-faded"),
  fadedRetry: $<HTMLButtonElement>("#fd-faded-retry"),
  status: $<HTMLParagraphElement>("#fd-status-main"),
  diag: $<HTMLParagraphElement>("#fd-status-diag"),
  dimension: $<HTMLSpanElement>("#fd-dimension"),
  splash: $<HTMLDivElement>("#fd-splash"),
  splashGo: $<HTMLButtonElement>("#fd-splash-go"),
  splashClose: $<HTMLButtonElement>("#fd-splash-close"),
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const session = new Session();
let settings = loadSettings();
let inflight: AbortController | null = null;
let lastRequest: PageRequest | null = null;
let resolving = false;
let dimension = 4817;

const loading = new LoadingView({ page: dom.page, tuning: dom.tuning, tuningText: dom.tuningText, status: dom.status });

const hotspots = new HotspotLayer(dom.page, dom.img, dom.layer, {
  onFollow: (link) => {
    const from = session.current();
    if (from) void navigate(linkRequest(from, link));
  },
  onSearch: (link, query) => {
    const from = session.current();
    if (from) void navigate(searchRequest(from, link, query));
  },
  onResolve: (point) => void resolveAt(point),
  onHover: (link) => {
    if (!inflight) dom.status.textContent = link ? `${link.external ? "↗ " : ""}${link.dest}` : "";
  },
});

function setDimension(n: number): void {
  dimension = n;
  dom.dimension.textContent = n.toLocaleString("en-US");
}

const randomDimension = () => Math.floor(Math.random() * 9000) + 1000;

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

async function navigate(req: PageRequest): Promise<void> {
  hideSplash();
  inflight?.abort();
  const ac = new AbortController();
  inflight = ac;
  lastRequest = req;
  dom.faded.hidden = true;
  if (req.mode === "typed" || req.mode === "external") setDimension(randomDimension());
  loading.start(req.mode, dimension, session.current() !== null);

  const t0 = performance.now();
  const { text, referenceImage } = buildPagePrompt(req);
  try {
    const res = await fetchPage({ prompt: text, referenceImage, model: settings.pageModel }, ac.signal);
    recordRun({ kind: "page", model: res.model, ms: res.ms, costUsd: res.costUsd, ok: true });
    if (inflight !== ac) return;
    inflight = null;
    const { url, title } = deriveMeta(req, res);
    const entry: Entry = { imageDataUri: res.image, url, title, links: null, siteKey: siteKeyOf(url) };
    session.push(entry);
    show(entry);
    loading.arrive();
    dom.status.textContent = `Done. (${(res.ms / 1000).toFixed(1)}s)`;
    if (settings.linkMode === "scan") void scanLinks(entry);
  } catch (e) {
    if (isAbortError(e) || inflight !== ac) return;
    inflight = null;
    recordRun({ kind: "page", model: settings.pageModel, ms: Math.round(performance.now() - t0), costUsd: 0, ok: false });
    loading.stop();
    dom.faded.hidden = false;
    dom.status.textContent = "The mirage faded.";
  }
}

function show(entry: Entry): void {
  dom.img.src = entry.imageDataUri;
  dom.img.alt = entry.title;
  dom.urlBar.value = entry.url;
  dom.title.textContent = `${entry.title} — Mirage`;
  document.title = `${entry.title} — Mirage`;
  dom.diag.textContent = entry.links ? `${entry.links.length} links mapped` : "";
  hotspots.setLinks(entry.links);
  dom.back.disabled = !session.canBack();
  dom.forward.disabled = !session.canForward();
}

async function scanLinks(entry: Entry): Promise<void> {
  dom.diag.textContent = "Mapping links…";
  const t0 = performance.now();
  try {
    const res = await fetchLinks(entry.imageDataUri, settings.linkModel);
    recordRun({ kind: "links", model: res.model, ms: res.ms, costUsd: res.costUsd, ok: true });
    // An empty map would make the page unclickable; stay unmapped so clicks resolve.
    entry.links = res.links.length ? res.links : null;
    if (session.current() === entry) {
      hotspots.setLinks(entry.links);
      dom.diag.textContent = entry.links ? `${entry.links.length} links mapped` : "Links unmapped: click anything";
    }
  } catch {
    recordRun({ kind: "links", model: settings.linkModel, ms: Math.round(performance.now() - t0), costUsd: 0, ok: false });
    if (session.current() === entry) dom.diag.textContent = "Links unmapped: click anything";
  }
}

async function resolveAt(point: Point): Promise<void> {
  const entry = session.current();
  if (!entry || resolving) return;
  resolving = true;
  dom.status.textContent = "Feeling for a link…";
  const t0 = performance.now();
  try {
    const res = await resolvePoint(entry.imageDataUri, point, settings.linkModel);
    recordRun({ kind: "point", model: res.model, ms: res.ms, costUsd: res.costUsd, ok: true });
    if (session.current() !== entry) return;
    if (!res.link) {
      dom.status.textContent = "Nothing there.";
    } else if (res.link.kind === "input") {
      hotspots.showInput(res.link);
      dom.status.textContent = res.link.dest;
    } else {
      void navigate(linkRequest(entry, res.link));
    }
  } catch {
    recordRun({ kind: "point", model: settings.linkModel, ms: Math.round(performance.now() - t0), costUsd: 0, ok: false });
    if (session.current() === entry) dom.status.textContent = "Nothing there.";
  } finally {
    resolving = false;
  }
}

function cancelLoad(): void {
  if (!inflight) return;
  inflight.abort();
  inflight = null;
  loading.stop();
}

function goBack(): void {
  cancelLoad();
  const entry = session.back();
  if (entry) show(entry);
}

function goForward(): void {
  cancelLoad();
  const entry = session.forward();
  if (entry) show(entry);
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function hideSplash(): void {
  dom.splash.hidden = true;
}

function wire(): void {
  const go = () => void navigate(typedRequest(dom.urlBar.value));
  dom.go.addEventListener("click", go);
  dom.urlBar.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      go();
    }
  });
  dom.back.addEventListener("click", goBack);
  dom.forward.addEventListener("click", goForward);
  dom.home.addEventListener("click", () => void navigate(typedRequest("")));
  dom.reload.addEventListener("click", () => void navigate(typedRequest(session.current()?.url ?? "")));
  dom.fadedRetry.addEventListener("click", () => {
    if (lastRequest) void navigate(lastRequest);
  });

  dom.splashGo.addEventListener("click", () => void navigate(typedRequest("")));
  dom.splashClose.addEventListener("click", hideSplash);
  dom.splash.addEventListener("click", (e) => {
    if (e.target === dom.splash) hideSplash();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideSplash();
  });

  const panel = setupDevPanel((s) => {
    settings = s;
  });
  dom.devBtn.addEventListener("click", panel.toggle);
}

wire();
setDimension(randomDimension());
dom.back.disabled = true;
dom.forward.disabled = true;

(window as unknown as { __mirage: unknown }).__mirage = { session, navigate };
```

- [ ] **Step 9: Delete the old pipeline and dependencies**

```bash
git rm src/hallucinate.ts src/render.ts src/classify.ts src/handoff.ts src/homepageContract.ts src/agent.ts src/systemPrompts.ts src/ollama.ts api/chat.ts api/image.ts api/image-gemini.ts
npm uninstall dompurify @types/dompurify
grep -rn "dompurify\|ollama\|systemPrompts\|hallucinate\|year\|era\b\|archetype" src api index.html || echo "clean"
```

Expected: `clean`. If the grep matches a word inside an unrelated identifier (for example `generateLinks`), check it by eye. Only references to the removed systems must go.

In `tsconfig.api.json`, delete the `"exclude"` line.

Replace `.env.example` with:

```bash
# Mirage — API keys
# Get your OpenRouter key at https://openrouter.ai/keys
# Used server-side only (api/ functions, and the Vite dev server in development).
OPENROUTER_API_KEY=sk-or-v1-your-key-here
```

- [ ] **Step 10: Run the tests and the build**

Run: `npm test && npm run build`
Expected: all tests PASS (Tasks 1–9), build succeeds with no TypeScript errors.

- [ ] **Step 11: Quick browser smoke check (costs about $0.05)**

Run `npm run dev`, open http://127.0.0.1:5173. Click **Tune In 📡**: the static tuning screen should show rotating lines and the status bar should count seconds. The page image should fade in from noise within ~10 s, and the status diag should show "Mapping links…" and then "N links mapped". Hovering a link should show its dest in the status bar with a dotted box. Clicking it should haze the page and load the next one. The full checklist is in Task 10.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: switch Mirage to the image-first pipeline

Replace HTML generation (hallucinate/render/classify/handoff/agents/eras)
with page images from /api/page plus a hotspot layer from /api/links.
Adds diegetic loading states, a cost/latency run log in the dev panel,
and removes DOMPurify and the Cloudflare/Gemini image proxies.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Documentation and manual verification

**Files:**
- Rewrite: `AGENTS.md`
- Modify: `README.md`, `mirage-design-doc.md`

**Interfaces:** none (docs and verification only).

- [ ] **Step 1: Rewrite `AGENTS.md`**

```markdown
# AGENTS.md

Guidance for AI coding agents working on Mirage.

## Project

Mirage (formerly FeverDream WebSurfer) — a parody web browser that hallucinates
entire fake websites. Each page is a single image drawn by an image model, with
an invisible hotspot layer that makes its links and search boxes work.
Frontend is a Vite + TypeScript SPA; `api/` holds Vercel Functions (Node
runtime) that proxy OpenRouter.

## Verification commands

```bash
npm run build    # tsc (src) && tsc -p tsconfig.api.json (api) && vite build
npm test         # Vitest unit tests (src/**/*.test.ts, api/**/*.test.ts)
npm run dev      # Vite dev server (http://127.0.0.1:5173), serves api/ too
```

Both `npm run build` and `npm test` must pass after any TypeScript change.
There is no lint script.

## Architecture map

- `api/page.ts` — `POST` page generation (`google/gemini-3.1-flash-lite-image`,
  `modalities: ["image","text"]`, 4:3). Retries once with a strict suffix when no
  image comes back, then returns `{error:"faded"}`. Shrinks images over
  `MAX_IMAGE_CHARS` to JPEG.
- `api/links.ts` — `POST` link scan (`google/gemini-3-flash-preview`, `box_2d`
  0–1000) or point resolve (crop 30%×20% around a click).
- `api/models.ts` — `GET` OpenRouter model catalog for the dev panel.
- `api/_lib/` — shared server code and its tests. Vercel does not route
  `_`-prefixed dirs, so **never put a test file directly in `api/`**.
- `src/pageContract.ts` — the prompt contract and `buildPagePrompt()` for the four
  modes: `typed`, `internal`, `external`, `search`.
- `src/pageMeta.ts` — fallback url/title when the model's metadata line is missing.
- `src/session.ts` — in-memory back/forward history and request builders.
- `src/hotspots.ts` — pure box scaling/hit-testing + the overlay layer.
- `src/loading.ts` — heat-haze / tuning-screen loading states.
- `src/openrouter.ts` — browser wrappers for the `api/` endpoints.
- `src/devPanel.ts` — Ctrl+Shift+D: page model, link model, link mode, run log.
  Settings persist under `mirage.settings.v2`.
- `src/modelStats.ts` — in-memory cost/latency log.

## Retry policy

`api/_lib/openrouter.ts` `postChat()` retries `429`, `502`, `503`, `504` up to
`MAX_RETRIES`=2, each wait capped at `MAX_RETRY_MS`=5000 (429 honours
`Retry-After`; 5xx backs off linearly). Errors are logged server-side. The
browser only ever sees `{error:"faded"}` / `{error:"links-unavailable"}`, and the
UI shows "The mirage faded." with a Retry button.

## Secrets

`OPENROUTER_API_KEY` is read server-side only (`.env.local` in dev, Vercel env in
production). Never send it to the browser.
```

- [ ] **Step 2: Update `README.md`**

Replace the intro paragraph that mentions "hallucinated live by an LLM … 1999 web page" with:

```markdown
A parody web browser that can only reach the internets of neighbouring parallel universes. Every page is a single hallucinated image of a website, drawn live by an image model. An invisible layer over it makes the links and search boxes work. No real network requests, no real brands.
```

Replace the whole `## Architecture (one minute version)` section, through the paragraph ending "ID-based navigation…", with:

```markdown
## Architecture (one minute version)

```
URL bar / click / search box
        │
        ▼
 src/session.ts + src/pageContract.ts → prompt for mode typed | internal | external | search
        │                                (internal/search send the current page as a reference image)
        ▼
 POST /api/page  → OpenRouter gemini-3.1-flash-lite-image → { url, title, image, costUsd, ms }
        │
        ▼  (background)
 POST /api/links → OpenRouter gemini-3-flash-preview → clickable boxes
        │
        ▼
 src/hotspots.ts → hover, click and type over the image
```

Internal links pass the current page as a reference, so the next page keeps the
site's logo, nav and footer. External links and typed addresses get no
reference, so each is a fresh universe. Back/forward re-shows cached images
with no calls.
```

Change the Requirements Node line to `Node.js 22+`. In `## Usage`, replace "🏠 return to the current site's homepage" with "🏠 tune to a fresh portal homepage", and drop the `### Try these` bullets that mention 1999. Replace the `## Dev panel` section body with:

```markdown
- **Page model** — image-output models from the OpenRouter catalog
- **Link model** — image-input models used to map links
- **Link mode** — `scan` (map every page in the background; hover + search boxes) or `click-only` (resolve each click on demand)
- **Run log** — cost and latency of every page/scan/click call, plus the session total (in memory only)
```

In `## Deploying to Vercel`, replace "Edge Functions" with "Vercel Functions (Node runtime)". Replace the `## Project layout` code block with:

```
Mirage/
├── api/
│   ├── page.ts              # POST: hallucinate a page image (OpenRouter)
│   ├── links.ts             # POST: map clickable boxes / resolve one click
│   ├── models.ts            # GET: model catalog for the dev panel
│   └── _lib/                # shared server code + tests (not routed)
├── index.html               # Browser chrome shell
├── src/
│   ├── main.ts              # Wiring: chrome ↔ session ↔ API
│   ├── pageContract.ts      # Prompt contract + per-mode prompt builders
│   ├── pageMeta.ts          # Fallback url/title derivation
│   ├── session.ts           # Back/forward history + request builders
│   ├── hotspots.ts          # Invisible link/search layer over the image
│   ├── loading.ts           # Heat-haze / tuning loading states
│   ├── openrouter.ts        # Browser wrappers for api/
│   ├── devPanel.ts          # Ctrl+Shift+D settings + run log
│   ├── modelStats.ts        # In-memory cost/latency log
│   ├── types.ts             # Shared types (also used by api/)
│   └── style.css
├── .env.example
├── package.json
├── tsconfig.json            # src typecheck
├── tsconfig.api.json        # api typecheck
├── vitest.config.ts
├── vite.config.ts           # Dev server: serves api/ handlers locally
└── vercel.json
```

- [ ] **Step 3: Update `mirage-design-doc.md`**

1. In §4, delete Principle 8 ("Period accuracy is the discipline…").
2. Replace the body of §5 "The hallucination engine" with:

```markdown
*This section describes the shipping architecture.*

**Image-first.** Every page is one image of a website from a neighbouring universe, drawn by `google/gemini-3.1-flash-lite-image` via OpenRouter (~5–8 s, ~$0.034/page). The image model is itself the best hallucinator we tested: it invents its own jokes beyond the prompt. The prompt contract asks for a flat screenshot, legible text, parody brands only, played completely straight, plus a one-line `{url, title}` metadata header.

**Making it clickable.** After the page appears, `google/gemini-3-flash-preview` maps every clickable element to a `box_2d` (0–1000). An invisible layer over the image turns those boxes into hover, click and search-box targets. Until the map arrives, a click is resolved on demand from a crop around the pointer.

**Four ways to arrive at a page.** *Typed* (URL bar, home, reload): a fresh universe from the typed text. *Internal* click: the current page goes along as a reference image, so the site keeps its logo, nav and footer. *External* click: no reference, a fresh universe. *Search*: the reference image plus the typed query → a results page on the same site.

**Session only.** Back/forward re-show cached images with no calls; nothing persists beyond the tab.
```

3. In §6, replace the **Page area** paragraph with: `**Page area.** A single hallucinated image, letterboxed in the window, with an invisible hotspot layer for links and search boxes.` Change the loading flavour line to `*"Receiving signal from a neighbouring universe…"*`.

4. Retire every remaining year/era reference (user decision, 2026-10-02): delete Principle 6 ("You steer time, never space…"), and remove year/era/1999 material from §1–§3, §6 (year dropdown), §7 (MVP "single 1999", deferred year dropdown) and §9 (Phase 1 "1999-only", Phase 2 "Time"), renumbering phases if one empties out. Finish with `grep -n -i "199\|200[0-4]\|year\|era\b\|period" mirage-design-doc.md`; only unrelated matches (e.g. "generate") may remain.

- [ ] **Step 4: Run the manual browser checklist (costs about $0.40)**

Run `npm run dev`, open http://127.0.0.1:5173 and open the dev panel (Ctrl+Shift+D). Tick each item only after seeing it:

- [ ] **Typed URL**: type `moon-pizza.com`, press Enter → tuning static with rotating lines and a seconds counter → page fades in; the URL bar and title update; the dimension number changes.
- [ ] **Internal click (branding held)**: click a nav link → the page hazes → the new page keeps the same logo/nav/footer; ◀ becomes enabled.
- [ ] **External click (new universe)**: click an ad or partner badge (hover shows `↗`) → tuning static → a visibly different site; the dimension number changes.
- [ ] **Search**: click a search box on a page, type a query, press Enter → a results page on the same site that mentions the query.
- [ ] **Back/forward instant**: ◀ and ▶ swap pages immediately with no new rows in the run log.
- [ ] **Resize**: resize the window narrow and wide → hover outlines still sit on the drawn links.
- [ ] **Mid-load navigation**: start a load, then press ◀ (or click another link) before it finishes → no "mirage faded" notice, and the stale page never appears later.
- [ ] **Point resolve**: in the dev panel choose `click-only`, load a page, click a link → status "Feeling for a link…" → navigates.
- [ ] **Forced error**: stop the dev server, set `OPENROUTER_API_KEY=bad` in `.env.local`, restart, press Go → "⚠ The mirage faded." notice with Retry; the previous page stays visible; no upstream text in the UI. Restore the key afterwards.
- [ ] **Dev panel**: every call shows a row with kind, model, seconds and $; the session total adds up.

If an item fails, use superpowers:systematic-debugging before changing code. Record any fix as its own commit.

- [ ] **Step 5: Final gates**

Run: `npm test && npm run build`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add AGENTS.md README.md mirage-design-doc.md
git commit -m "docs: describe the image-first pipeline

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
