# Public Launch Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Mirage safe and presentable for a public URL. Phase 1 makes it hard to run up the OpenRouter bill or use the endpoints for anything except Mirage. Phase 2 fixes the visual loose ends (4:3 window frame, mobile, empty state, branding, link previews).

**Architecture:** Prompt building moves from the browser to `/api/page`, which now takes a structured `PageRequest` instead of free text. Every page image the server returns carries an HMAC signature. `/api/links` and reference images on `/api/page` are only accepted with a valid signature, so the endpoints only process images this server drew. Endpoints also check `Origin`, the browser throttles repeat navigations, and the dev tools are off in production. Phase 2 is mostly CSS/HTML: the window shrinks to frame a 4:3 page area centred on the desktop.

**Tech Stack:** Vite 5 + TypeScript (strict) SPA, 98.css, Vercel Functions (Node runtime, Web `Request`/`Response`), OpenRouter, `node:crypto` HMAC, `sharp`, Vitest 3.

**Spec:** No separate spec file. The loose-ends list agreed in conversation on 2026-10-02 is reproduced under **Scope** below. Item 21 (title-bar buttons) was dropped.

## Scope (loose-ends list → tasks)

| # | Item | Task |
|---|------|------|
| 1 | Endpoints accept arbitrary prompts and images | 1, 2 |
| 2 | Character limits on URL bar and search boxes | 2, 3 |
| 3 | Per-IP rate limiting | 8 (dashboard) |
| 4 | Hard spend cap on the OpenRouter key | 8 (dashboard) |
| 5 | Spam-clicking Go starts a new paid generation each time | 4 |
| 6 | Worst-case upstream calls per page | 8 (documented) |
| 7 | Dev panel visible to everyone / pricier model on the allowlist | 5 |
| 8 | `/api/models` unauthenticated and uncached | 5 |
| 9 | Origin check | 6 |
| 10 | `window.__mirage` global | 5 |
| 11 | Hardcoded `HTTP-Referer` | 6 |
| 12 | Unbounded history memory | 7 |
| 13 | Internal docs in the repo | 12 (user decision) |
| 14 | "AI-generated" note | 11 |
| 15 | Frame the 4:3 page instead of stretching | 9 |
| 16 | FeverDream favicon | 11 |
| 17 | Version mismatch | 11 |
| 18 | Empty state after closing the splash | 10 |
| 19 | Mobile overflow | 9 |
| 20 | Meta description / Open Graph | 11 |

**Phase 1 = Tasks 1–8 (cost and abuse). Phase 2 = Tasks 9–12 (visual and polish).** Phase 1 can ship on its own.

## Global Constraints

- Gates: `npm run build` and `npm test` must both pass at the end of every task.
- Vercel compiles each `api/*.ts` on its own: relative **value** imports under `api/` need a `.js` extension (`import { x } from "./_lib/foo.js"`). `api/_lib/deploy.test.ts` enforces this. Type-only imports (`import type`) are exempt.
- Never put a test file directly in `api/`. Server tests go in `api/_lib/`.
- `src/**/*.test.ts` are typechecked with `"types": []`. They cannot import `node:*` modules. Tests that need `node:fs` go in `api/_lib/`.
- The browser only ever sees error codes (`{error:"faded"}`, `{error:"links-unavailable"}`, `{error:"bad-request"}`, `{error:"forbidden"}`), never upstream detail.
- `OPENROUTER_API_KEY` and `MIRAGE_SIGNING_SECRET` stay server-side.
- User-typed text cap: **200 characters** (`MAX_USER_TEXT` on the server, `MAX_INPUT_CHARS` in the browser; they must be equal).
- Minimum gap between navigations: **1500 ms**. History cap: **40 entries**.
- Functions use the default Node runtime (no `runtime: "edge"`).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Going back, then clicking a link on an older page.** Signatures are stateless HMACs, so an old entry's `imageSig` must still verify. Pinned by the round-trip test "accepts a reference image signed by an earlier response" in Task 2.
2. **Images shrunk to JPEG.** The signature must cover the image actually returned (after `shrinkIfLarge`), not the model's original. Pinned by the `verifyImage(body.image, body.sig)` assertion in Task 1. Reviewers should confirm `signImage` is called on the shrunk value.
3. **Origin check on the real deployment.** If Vercel's `req.url` host differs from the browser's `Origin`, every request would 403. `x-forwarded-host` is accepted too (test in Task 6), and Task 8 has a preview-deploy check before production.
4. **A quick second click is ignored silently, and the throttle must release after a failure** or Retry would be stuck. Pinned by the NavThrottle tests in Task 4 (`finish()` re-opens the same key). Reviewers should confirm `finish()` runs on success, failure and `cancelLoad`.
5. **Pasting a 1,000-character address.** The bar caps at 200, and the server caps anything that bypasses the UI. Pinned by "caps user text" (Task 2) and `limits.test.ts` (Task 3).

---

# Phase 1 — Cost and abuse

### Task 1: Sign page images; require signatures on `/api/links`

**Files:**
- Create: `api/_lib/sign.ts`, `api/_lib/sign.test.ts`
- Modify: `api/page.ts`, `api/links.ts`, `src/types.ts`, `src/openrouter.ts`, `src/main.ts`
- Test: `api/_lib/page.handler.test.ts`, `api/_lib/links.handler.test.ts`, `src/openrouter.test.ts`, `src/session.test.ts`

**Interfaces:**
- Produces: `signImage(image: string): string` and `verifyImage(image: string, sig: unknown): boolean` in `api/_lib/sign.ts`. `PageResult.sig: string`. `Entry.imageSig: string`. `fetchLinks(image, sig, model, signal?)` and `resolvePoint(image, sig, point, model, signal?)` in `src/openrouter.ts`.

- [ ] **Step 1: Write the failing signature tests**

Create `api/_lib/sign.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signImage, verifyImage } from "./sign";

const IMG = "data:image/png;base64,iVBORw0KGgo=";

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
  delete process.env.MIRAGE_SIGNING_SECRET;
});
afterEach(() => { delete process.env.MIRAGE_SIGNING_SECRET; });

describe("image signatures", () => {
  it("verifies its own signature", () => {
    expect(verifyImage(IMG, signImage(IMG))).toBe(true);
  });
  it("rejects a signature for a different image", () => {
    expect(verifyImage(IMG + "A", signImage(IMG))).toBe(false);
  });
  it("rejects missing or junk signatures", () => {
    for (const s of [undefined, null, "", "abc", 42]) expect(verifyImage(IMG, s)).toBe(false);
  });
  it("prefers MIRAGE_SIGNING_SECRET over the API key", () => {
    const withApiKey = signImage(IMG);
    process.env.MIRAGE_SIGNING_SECRET = "another-secret";
    expect(signImage(IMG)).not.toBe(withApiKey);
    expect(verifyImage(IMG, withApiKey)).toBe(false);
  });
  it("never verifies when no key is configured", () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(signImage(IMG)).toBe("");
    expect(verifyImage(IMG, "")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run api/_lib/sign.test.ts`
Expected: FAIL, cannot resolve `./sign`.

- [ ] **Step 3: Implement `api/_lib/sign.ts`**

```ts
// HMAC signatures for page images. /api/page signs every image it returns;
// /api/links and reference images sent back to /api/page must carry a valid
// signature, so the endpoints only ever process images this server drew.
// Key: MIRAGE_SIGNING_SECRET, else the OpenRouter key (never sent anywhere).

import { createHmac, timingSafeEqual } from "node:crypto";

function signingKey(): string {
  return process.env.MIRAGE_SIGNING_SECRET || process.env.OPENROUTER_API_KEY || "";
}

export function signImage(image: string): string {
  const key = signingKey();
  if (!key) return "";
  return createHmac("sha256", key).update(image).digest("base64url");
}

export function verifyImage(image: string, sig: unknown): boolean {
  if (typeof sig !== "string" || !sig) return false;
  const expected = signImage(image);
  if (!expected) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Run the signature tests**

Run: `npx vitest run api/_lib/sign.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing handler tests**

In `api/_lib/page.handler.test.ts`, add `import { verifyImage } from "./sign";` and extend the first test (`"returns url, title, image, cost and model"`) with:

```ts
    expect(verifyImage(body.image, body.sig)).toBe(true);
```

In `api/_lib/links.handler.test.ts`, add `import { signImage } from "./sign";` and replace the `request` helper so it signs the image unless a test overrides `sig`:

```ts
const request = (body: Record<string, unknown>) =>
  new Request("http://localhost/api/links", {
    method: "POST",
    body: JSON.stringify({ sig: typeof body.image === "string" ? signImage(body.image) : undefined, ...body }),
  });
```

Then add this test inside the `describe`:

```ts
  it("rejects an image this server did not sign", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await POST(request({ image: IMG, sig: "forged" }))).status).toBe(403);
    expect((await POST(request({ image: IMG, sig: undefined, point: { x: 1, y: 1 } }))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
```

- [ ] **Step 6: Run them to make sure they fail**

Run: `npx vitest run api/_lib/page.handler.test.ts api/_lib/links.handler.test.ts`
Expected: FAIL. `body.sig` is undefined, and the forged request gets 200/502 instead of 403.

- [ ] **Step 7: Sign in `/api/page`, verify in `/api/links`**

`src/types.ts`: add `sig` to `PageResult` and `imageSig` to `Entry`:

```ts
export type PageResult = {
  url: string | null;
  title: string | null;
  image: string;
  /** HMAC of `image`; send it back with the image to /api/links or as a reference. */
  sig: string;
  costUsd: number;
  ms: number;
  model: string;
};
```

```ts
export type Entry = {
  imageDataUri: string;
  /** Server signature for imageDataUri (PageResult.sig). */
  imageSig: string;
  url: string;
  ...
```

`api/page.ts`: add `import { signImage } from "./_lib/sign.js";` and build the result from the shrunk image:

```ts
      if (!parts.image) continue;
      const image = await shrinkIfLarge(parts.image);
      const result: PageResult = {
        ...parseMeta(parts.text),
        image,
        sig: signImage(image),
        costUsd,
        ms: Date.now() - t0,
        model,
      };
      return json(result);
```

`api/links.ts`: add `import { verifyImage } from "./_lib/sign.js";`, widen the input type, and check the signature right after the data-URI check:

```ts
  let input: { image?: unknown; sig?: unknown; point?: unknown; model?: unknown };
  ...
  if (!input || !isImageDataUri(input.image)) return json({ error: "bad-request" }, 400);
  if (!verifyImage(input.image, input.sig)) return json({ error: "forbidden" }, 403);
```

Update the file's header comment to `{ image, sig, model? }` / `{ image, sig, point, model? }`.

- [ ] **Step 8: Pass the signature through the browser**

`src/openrouter.ts`:

```ts
export function fetchLinks(image: string, sig: string, model: string, signal?: AbortSignal): Promise<LinksResult> {
  return postJson<LinksResult>("/api/links", { image, sig, model }, signal);
}

export function resolvePoint(image: string, sig: string, point: Point, model: string, signal?: AbortSignal): Promise<PointResult> {
  return postJson<PointResult>("/api/links", { image, sig, point, model }, signal);
}
```

`src/openrouter.test.ts`: in `"send image (and point) to /api/links"`, call `fetchLinks("data:image/png;base64,AA", "s", "m")` and `resolvePoint("data:image/png;base64,AA", "s", { x: 1, y: 2 }, "m")`, and expect bodies `{ image: "data:image/png;base64,AA", sig: "s", model: "m" }` and `{ image: "data:image/png;base64,AA", sig: "s", point: { x: 1, y: 2 }, model: "m" }`.

`src/main.ts`:
- in `navigate`, the entry becomes `{ imageDataUri: res.image, imageSig: res.sig, url, title, links: null, siteKey: siteKeyOf(url) }`
- in `scanLinks`: `fetchLinks(entry.imageDataUri, entry.imageSig, settings.linkModel)`
- in `resolveAt`: `resolvePoint(entry.imageDataUri, entry.imageSig, point, settings.linkModel, ac.signal)`

`src/session.test.ts`: the `entry` helper gains `imageSig: \`sig-${url}\``.

- [ ] **Step 9: Run the gates**

Run: `npm test && npm run build`
Expected: all tests PASS, build succeeds. If `tsc` reports another object literal missing `imageSig`, add it there.

- [ ] **Step 10: Commit**

```bash
git add api/_lib/sign.ts api/_lib/sign.test.ts api/page.ts api/links.ts src/types.ts src/openrouter.ts src/openrouter.test.ts src/main.ts src/session.test.ts api/_lib/page.handler.test.ts api/_lib/links.handler.test.ts
git commit -m "Sign page images and require signatures on /api/links

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Build the page prompt on the server from a structured request

**Files:**
- Move: `src/pageContract.ts` → `api/_lib/pageContract.ts`, `src/pageContract.test.ts` → `api/_lib/pageContract.test.ts`
- Create: `api/_lib/pageRequest.ts`, `api/_lib/pageRequest.test.ts`
- Modify: `api/page.ts`, `api/_lib/pageGen.ts`, `src/types.ts`, `src/session.ts`, `src/openrouter.ts`, `src/main.ts`
- Test: `api/_lib/page.handler.test.ts` (rewritten), `src/session.test.ts`, `src/pageMeta.test.ts`, `src/openrouter.test.ts`

**Interfaces:**
- Consumes: `signImage`, `verifyImage` (Task 1); `Entry.imageSig` (Task 1).
- Produces: `parsePageRequest(v: unknown): PageRequest | null`. `MAX_USER_TEXT = 200` exported from `api/_lib/pageContract.ts`. `PageRequest` internal/search variants gain `referenceSig: string`. `/api/page` body is `{ request: PageRequest, model?: string }`. `fetchPage(body: { request: PageRequest; model: string }, signal?)`.

- [ ] **Step 1: Move the prompt contract to the server**

```bash
git mv src/pageContract.ts api/_lib/pageContract.ts
git mv src/pageContract.test.ts api/_lib/pageContract.test.ts
```

In `api/_lib/pageContract.ts`:
- change the import to `import type { PageRequest, PromptParts } from "../../src/types";`
- change `export const MAX_USER_TEXT = 300;` to `export const MAX_USER_TEXT = 200;`
- change the header comment's second line to `// Pure functions, run server-side by /api/page; the browser never sends prompt text.`

- [ ] **Step 2: Add `referenceSig` to the request type and builders**

`src/types.ts`:

```ts
export type PageRequest =
  | { mode: "typed"; input: string }
  | { mode: "internal"; site: SiteRef; label: string; dest: string; referenceImage: string; referenceSig: string }
  | { mode: "external"; label: string; dest: string }
  | { mode: "search"; site: SiteRef; label: string; query: string; referenceImage: string; referenceSig: string };
```

`src/session.ts`: in `linkRequest`'s internal branch and in `searchRequest`, add `referenceSig: from.imageSig,` after `referenceImage: from.imageDataUri,`.

Update test literals so they typecheck:
- `src/session.test.ts`: the two expected objects in `"internal link carries site and reference image"` and `"search carries site, input label, query and reference image"` gain `referenceSig: from.imageSig`.
- `src/pageMeta.test.ts` lines 47 and 59: add `referenceSig: "s"` to each `PageRequest` literal.
- `api/_lib/pageContract.test.ts`: add `referenceSig: "s"` to the internal and search `buildPagePrompt({...})` calls.

- [ ] **Step 3: Write the failing request-validation tests**

Create `api/_lib/pageRequest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MAX_USER_TEXT } from "./pageContract";
import { parsePageRequest } from "./pageRequest";

const IMG = "data:image/png;base64,iVBORw0KGgo=";
const site = { url: "cheese.net", title: "Cheese" };

describe("parsePageRequest", () => {
  it("accepts each mode", () => {
    expect(parsePageRequest({ mode: "typed", input: " moon.com " })).toEqual({ mode: "typed", input: "moon.com" });
    expect(parsePageRequest({ mode: "external", label: "Ad", dest: "gravity store" }))
      .toEqual({ mode: "external", label: "Ad", dest: "gravity store" });
    expect(parsePageRequest({ mode: "internal", site, label: "Shop", dest: "shop", referenceImage: IMG, referenceSig: "s" }))
      .toEqual({ mode: "internal", site, label: "Shop", dest: "shop", referenceImage: IMG, referenceSig: "s" });
    expect(parsePageRequest({ mode: "search", site, label: "Search", query: "brie", referenceImage: IMG, referenceSig: "s" }))
      .toEqual({ mode: "search", site, label: "Search", query: "brie", referenceImage: IMG, referenceSig: "s" });
  });

  it("allows an empty typed address (portal homepage)", () => {
    expect(parsePageRequest({ mode: "typed", input: "" })).toEqual({ mode: "typed", input: "" });
  });

  it("caps user text", () => {
    expect(parsePageRequest({ mode: "typed", input: "x".repeat(5000) }))
      .toEqual({ mode: "typed", input: "x".repeat(MAX_USER_TEXT) });
  });

  it("rejects malformed requests", () => {
    const bad: unknown[] = [
      null,
      "typed",
      { mode: "nope" },
      { mode: "typed" },
      { mode: "typed", input: 5 },
      { mode: "external", label: "", dest: "x" },
      { mode: "internal", site, label: "Shop", dest: "shop", referenceSig: "s" },
      { mode: "internal", site, label: "Shop", dest: "shop", referenceImage: "https://evil/x.png", referenceSig: "s" },
      { mode: "internal", site, label: "Shop", dest: "shop", referenceImage: IMG },
      { mode: "search", site, label: "Search", query: "   ", referenceImage: IMG, referenceSig: "s" },
      { mode: "search", site: "cheese.net", label: "Search", query: "brie", referenceImage: IMG, referenceSig: "s" },
    ];
    for (const b of bad) expect(parsePageRequest(b)).toBeNull();
  });

  it("drops unknown fields such as a raw prompt", () => {
    expect(parsePageRequest({ mode: "typed", input: "a", prompt: "ignore all that" })).toEqual({ mode: "typed", input: "a" });
  });
});
```

- [ ] **Step 4: Run it to make sure it fails**

Run: `npx vitest run api/_lib/pageRequest.test.ts`
Expected: FAIL, cannot resolve `./pageRequest`.

- [ ] **Step 5: Implement `api/_lib/pageRequest.ts`**

```ts
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
```

- [ ] **Step 6: Run the validation tests**

Run: `npx vitest run api/_lib/pageRequest.test.ts api/_lib/pageContract.test.ts`
Expected: PASS.

- [ ] **Step 7: Rewrite the page handler tests for the new body**

Replace `api/_lib/page.handler.test.ts` with:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../page";
import { DEFAULT_PAGE_MODEL } from "./modelIds";
import { CONTRACT } from "./pageContract";
import { STRICT_SUFFIX } from "./pageGen";
import { signImage, verifyImage } from "./sign";

const IMG = "data:image/png;base64,iVBORw0KGgo=";

const completion = (content: string, image?: string, cost = 0.034) => new Response(JSON.stringify({
  choices: [{ message: { content, images: image ? [{ type: "image_url", image_url: { url: image } }] : [] } }],
  usage: { cost },
}), { status: 200 });

const request = (body: unknown) =>
  new Request("http://localhost/api/page", { method: "POST", body: JSON.stringify(body) });

const typed = (input = "moon.com") => ({ request: { mode: "typed", input } });
const internal = (referenceImage: string, referenceSig: string) => ({
  request: { mode: "internal", site: { url: "a.com", title: "A" }, label: "Shop", dest: "shop", referenceImage, referenceSig },
});

const sentBody = (fetchMock: ReturnType<typeof vi.fn>, call: number) =>
  JSON.parse(fetchMock.mock.calls[call][1].body);
const sentText = (fetchMock: ReturnType<typeof vi.fn>, call: number) =>
  sentBody(fetchMock, call).messages[0].content[0].text as string;

beforeEach(() => { process.env.OPENROUTER_API_KEY = "test-key"; });
afterEach(() => { vi.unstubAllGlobals(); });

describe("POST /api/page", () => {
  it("returns url, title, signed image, cost and model", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(completion('{"url":"www.x.com","title":"X"}', IMG)));
    const res = await POST(request(typed()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({ url: "www.x.com", title: "X", image: IMG, costUsd: 0.034, model: DEFAULT_PAGE_MODEL });
    expect(verifyImage(body.image, body.sig)).toBe(true);
    expect(typeof body.ms).toBe("number");
  });

  it("builds the prompt on the server from the request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion("", IMG));
    vi.stubGlobal("fetch", fetchMock);
    await POST(request(typed("moon.com")));
    expect(sentText(fetchMock, 0)).toContain(CONTRACT);
    expect(sentText(fetchMock, 0)).toContain('"moon.com"');
  });

  it("ignores a raw prompt field", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion("", IMG));
    vi.stubGlobal("fetch", fetchMock);
    await POST(request({ ...typed("x"), prompt: "draw a cat wearing a hat" }));
    expect(sentText(fetchMock, 0)).not.toContain("cat wearing a hat");
  });

  it("returns null metadata when the line is missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(completion("", IMG)));
    const body = await (await POST(request(typed()))).json();
    expect(body).toMatchObject({ url: null, title: null, image: IMG });
  });

  it("retries once with the strict suffix when no image comes back", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(completion("I'd rather describe it.", undefined, 0.01))
      .mockResolvedValueOnce(completion('{"url":"a.com","title":"A"}', IMG, 0.03));
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(request(typed()));
    expect(res.status).toBe(200);
    expect(sentText(fetchMock, 1)).toBe(sentText(fetchMock, 0) + STRICT_SUFFIX);
    expect(((await res.json()) as any).costUsd).toBeCloseTo(0.04);
  });

  it("fades after two imageless responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(completion("no"))));
    const res = await POST(request(typed()));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "faded" });
  });

  it("never leaks upstream detail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response('{"error":{"message":"secret stack trace at redis.js:42"}}', { status: 401 })
    ));
    const res = await POST(request(typed()));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain("secret");
    expect(text).not.toContain("redis");
  });

  it("rejects a missing or malformed request", async () => {
    vi.stubGlobal("fetch", vi.fn());
    expect((await POST(request({}))).status).toBe(400);
    expect((await POST(request(null))).status).toBe(400);
    expect((await POST(request({ prompt: "draw" }))).status).toBe(400);
    expect((await POST(new Request("http://localhost/api/page", { method: "POST", body: "not json" }))).status).toBe(400);
  });

  it("forwards a signed reference image", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion("", IMG));
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(request(internal(IMG, signImage(IMG))));
    expect(res.status).toBe(200);
    expect(sentBody(fetchMock, 0).messages[0].content[1]).toEqual({ type: "image_url", image_url: { url: IMG } });
  });

  it("accepts a reference image signed by an earlier response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(completion("", IMG))));
    const first = (await (await POST(request(typed()))).json()) as any;
    const res = await POST(request(internal(first.image, first.sig)));
    expect(res.status).toBe(200);
  });

  it("rejects an unsigned or forged reference image", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await POST(request(internal(IMG, "forged")))).status).toBe(403);
    expect((await POST(request(internal(IMG, "")))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the default model for an invalid model id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion("", IMG));
    vi.stubGlobal("fetch", fetchMock);
    await POST(request({ ...typed(), model: "../../etc" }));
    expect(sentBody(fetchMock, 0).model).toBe(DEFAULT_PAGE_MODEL);
  });

  it("forwards an allowed model id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion("", IMG));
    vi.stubGlobal("fetch", fetchMock);
    await POST(request({ ...typed(), model: "google/gemini-3.1-flash-image" }));
    expect(sentBody(fetchMock, 0).model).toBe("google/gemini-3.1-flash-image");
  });
});
```

- [ ] **Step 8: Run them to make sure they fail**

Run: `npx vitest run api/_lib/page.handler.test.ts`
Expected: FAIL. The handler still wants `prompt`, so typed requests get 400.

- [ ] **Step 9: Rewrite `api/page.ts`**

```ts
// POST /api/page — { request: PageRequest, model? } → PageResult.
// The prompt is built here from the structured request, so the endpoint
// can't be used as a general image generator. Reference images must carry
// the signature this endpoint issued with them.
// One retry with STRICT_SUFFIX when the model answers without an image;
// after that, { error: "faded" }. Upstream detail is logged, never returned.

import type { PageResult } from "../src/types";
import { json } from "./_lib/http.js";
import { shrinkIfLarge } from "./_lib/image.js";
import { DEFAULT_PAGE_MODEL, pickModel } from "./_lib/modelIds.js";
import { postChat } from "./_lib/openrouter.js";
import { buildPagePrompt } from "./_lib/pageContract.js";
import { extractPageParts, pageBody, parseMeta, STRICT_SUFFIX } from "./_lib/pageGen.js";
import { parsePageRequest } from "./_lib/pageRequest.js";
import { signImage, verifyImage } from "./_lib/sign.js";

export async function POST(req: Request): Promise<Response> {
  const t0 = Date.now();
  let input: { request?: unknown; model?: unknown } | null;
  try {
    input = (await req.json()) as typeof input;
  } catch {
    return json({ error: "bad-request" }, 400);
  }
  if (!input || typeof input !== "object") return json({ error: "bad-request" }, 400);
  const pageReq = parsePageRequest(input.request);
  if (!pageReq) return json({ error: "bad-request" }, 400);
  if (
    (pageReq.mode === "internal" || pageReq.mode === "search") &&
    !verifyImage(pageReq.referenceImage, pageReq.referenceSig)
  ) {
    return json({ error: "forbidden" }, 403);
  }
  const { text: prompt, referenceImage } = buildPagePrompt(pageReq);
  const model = pickModel(input.model, DEFAULT_PAGE_MODEL);

  let costUsd = 0;
  try {
    for (const suffix of ["", STRICT_SUFFIX]) {
      const completion = await postChat(pageBody(model, prompt + suffix, referenceImage), { signal: req.signal });
      const parts = extractPageParts(completion);
      costUsd += parts.costUsd;
      if (!parts.image) continue;
      const image = await shrinkIfLarge(parts.image);
      const result: PageResult = {
        ...parseMeta(parts.text),
        image,
        sig: signImage(image),
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

In `api/_lib/pageGen.ts`, delete the line `export const MAX_PROMPT_CHARS = 4000;`. Nothing else uses it.

- [ ] **Step 10: Send the structured request from the browser**

`src/openrouter.ts`: change the import to `import type { LinksResult, PageRequest, PageResult, Point, PointResult } from "./types";` and replace `fetchPage`:

```ts
export function fetchPage(
  body: { request: PageRequest; model: string },
  signal?: AbortSignal
): Promise<PageResult> {
  return postJson<PageResult>("/api/page", body, signal);
}
```

`src/openrouter.test.ts`: in the `fetchPage` describe, replace every `fetchPage({ prompt: "p", model: "m" })` with `fetchPage({ request: { mode: "typed", input: "p" }, model: "m" })`. The body assertion becomes `expect(JSON.parse(init.body)).toEqual({ request: { mode: "typed", input: "p" }, model: "m" });`.

`src/main.ts`:
- delete `import { buildPagePrompt } from "./pageContract";`
- in `navigate`, delete `const { text, referenceImage } = buildPagePrompt(req);` and change the fetch to `const res = await fetchPage({ request: req, model: settings.pageModel }, ac.signal);`
- update the header comment's third line to `// /api/page builds the prompt and draws each page; /api/links maps its links in the background.`

- [ ] **Step 11: Run the gates**

Run: `npm test && npm run build`
Expected: all PASS. `grep -rn "pageContract" src` prints nothing.

- [ ] **Step 12: Commit**

```bash
git add -A api src
git commit -m "Build page prompts server-side from a structured request

/api/page no longer accepts prompt text. Reference images must carry
the signature the server issued.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Character limits in the address bar and page search boxes

**Files:**
- Create: `api/_lib/limits.test.ts`
- Modify: `src/session.ts`, `src/hotspots.ts`, `index.html`

**Interfaces:**
- Consumes: `MAX_USER_TEXT` (Task 2).
- Produces: `MAX_INPUT_CHARS = 200` exported from `src/session.ts`.

- [ ] **Step 1: Write the failing test**

Create `api/_lib/limits.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_INPUT_CHARS } from "../../src/session";
import { MAX_USER_TEXT } from "./pageContract";

describe("input limits", () => {
  it("the browser caps typing at the server's limit", () => {
    expect(MAX_INPUT_CHARS).toBe(MAX_USER_TEXT);
  });
  it("the address bar carries the cap", () => {
    expect(readFileSync("index.html", "utf8")).toMatch(new RegExp(`id="fd-url"[^>]*maxlength="${MAX_INPUT_CHARS}"`));
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run api/_lib/limits.test.ts`
Expected: FAIL, `MAX_INPUT_CHARS` is undefined.

- [ ] **Step 3: Implement**

`src/session.ts`, below the imports:

```ts
/** Longest text a visitor can type; matches the server's MAX_USER_TEXT. */
export const MAX_INPUT_CHARS = 200;
```

`index.html`: the address input becomes

```html
          <input id="fd-url" type="text" maxlength="200" style="flex: 1; min-width: 200px;" placeholder="type anything" />
```

`src/hotspots.ts`: add `import { MAX_INPUT_CHARS } from "./session";` and in `render()`, after `input.type = "text";`:

```ts
      input.maxLength = MAX_INPUT_CHARS;
```

- [ ] **Step 4: Run the gates**

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/limits.test.ts src/session.ts src/hotspots.ts index.html
git commit -m "Cap typed text at 200 characters in the address bar and page inputs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Throttle repeat navigations

**Files:**
- Modify: `src/session.ts`, `src/main.ts`
- Test: `src/session.test.ts`

**Interfaces:**
- Produces: `MIN_NAV_GAP_MS = 1500`, `requestKey(req: PageRequest): string`, `class NavThrottle { constructor(minGapMs?: number); tryStart(key: string, now: number): boolean; finish(): void }` in `src/session.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `src/session.test.ts`, and add `NavThrottle, requestKey` to its import from `./session`:

```ts
describe("NavThrottle", () => {
  it("lets the first navigation through", () => {
    expect(new NavThrottle(1500).tryStart("a", 0)).toBe(true);
  });
  it("ignores the same request while it is loading, until finish()", () => {
    const t = new NavThrottle(1500);
    t.tryStart("a", 0);
    expect(t.tryStart("a", 5000)).toBe(false);
    t.finish();
    expect(t.tryStart("a", 5000)).toBe(true);
  });
  it("ignores any navigation inside the minimum gap", () => {
    const t = new NavThrottle(1500);
    t.tryStart("a", 0);
    expect(t.tryStart("b", 1000)).toBe(false);
    expect(t.tryStart("b", 1500)).toBe(true);
  });
  it("a rejected attempt does not restart the gap", () => {
    const t = new NavThrottle(1500);
    t.tryStart("a", 0);
    t.tryStart("b", 1000);
    expect(t.tryStart("c", 1600)).toBe(true);
  });
});

describe("requestKey", () => {
  it("ignores the reference image and signature", () => {
    const a = linkRequest(entry("cheese.net"), link());
    const b = { ...a, referenceImage: "data:image/png;base64,ZZ", referenceSig: "other" };
    expect(requestKey(b)).toBe(requestKey(a));
  });
  it("differs by destination", () => {
    expect(requestKey(typedRequest("a.com"))).not.toBe(requestKey(typedRequest("b.com")));
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/session.test.ts`
Expected: FAIL, `NavThrottle` is not exported.

- [ ] **Step 3: Implement in `src/session.ts`**

```ts
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
```

- [ ] **Step 4: Wire it into `src/main.ts`**

- extend the session import: `import { linkRequest, NavThrottle, requestKey, searchRequest, Session, typedRequest } from "./session";`
- under `const session = new Session();` add `const throttle = new NavThrottle();`
- first line of `navigate()`: `if (!throttle.tryStart(requestKey(req), performance.now())) return;`
- in `navigate()`'s success path, after `inflight = null;`, add `throttle.finish();`
- in `navigate()`'s catch, after the abort guard's `inflight = null;`, add `throttle.finish();`. **Not** before the guard: an aborted request's key belongs to the newer navigation.
- in `cancelLoad()`, make `throttle.finish();` the first line

- [ ] **Step 5: Run the gates**

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 6: Manual check**

Run `npm run dev` and open http://127.0.0.1:5173. Type `moon.com` and press Enter three times quickly. The dev panel run log (Ctrl+Shift+D) should show **one** page row. After a fade, Retry must still work.

- [ ] **Step 7: Commit**

```bash
git add src/session.ts src/session.test.ts src/main.ts
git commit -m "Ignore repeat navigations while loading and within 1.5 s

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Dev tools off in production

Covers the dev panel, `/api/models`, `window.__mirage`, and the pricier built-in model.

**Files:**
- Create: `api/_lib/devTools.ts`, `api/_lib/devTools.test.ts`, `api/_lib/models.handler.test.ts`, `src/vite-env.d.ts`
- Modify: `api/models.ts`, `api/_lib/modelIds.ts`, `src/main.ts`, `index.html`, `.env.example`
- Test: `api/_lib/modelIds.test.ts`, `api/_lib/page.handler.test.ts`

**Interfaces:**
- Produces: `devToolsEnabled(env?: Record<string, string | undefined>): boolean`. Env var `VITE_MIRAGE_DEV_TOOLS=1` turns dev tools on in production, for both the browser build and the server.

- [ ] **Step 1: Write the failing tests**

`api/_lib/devTools.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { devToolsEnabled } from "./devTools";

describe("devToolsEnabled", () => {
  it("is on locally and under vercel dev", () => {
    expect(devToolsEnabled({})).toBe(true);
    expect(devToolsEnabled({ VERCEL_ENV: "development" })).toBe(true);
  });
  it("is off on preview and production deployments", () => {
    expect(devToolsEnabled({ VERCEL_ENV: "preview" })).toBe(false);
    expect(devToolsEnabled({ VERCEL_ENV: "production" })).toBe(false);
  });
  it("can be forced on with VITE_MIRAGE_DEV_TOOLS=1", () => {
    expect(devToolsEnabled({ VERCEL_ENV: "production", VITE_MIRAGE_DEV_TOOLS: "1" })).toBe(true);
  });
});
```

`api/_lib/models.handler.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../models";

afterEach(() => {
  delete process.env.VERCEL_ENV;
  vi.unstubAllGlobals();
});

describe("GET /api/models", () => {
  it("is 404 in production", async () => {
    process.env.VERCEL_ENV = "production";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await GET()).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("proxies the catalog locally, cacheable for an hour", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"data":[]}', { status: 200 })));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=3600");
  });
});
```

In `api/_lib/modelIds.test.ts`, add inside the `describe`:

```ts
  it("does not allow the pricier image model unless listed", () => {
    expect(pickModel("google/gemini-3.1-flash-image", DEFAULT_PAGE_MODEL)).toBe(DEFAULT_PAGE_MODEL);
  });
```

In `api/_lib/page.handler.test.ts`, replace `"forwards an allowed model id"` with:

```ts
  it("forwards a model id allowed by MIRAGE_ALLOWED_MODELS", async () => {
    process.env.MIRAGE_ALLOWED_MODELS = "google/gemini-3.1-flash-image";
    const fetchMock = vi.fn().mockResolvedValue(completion("", IMG));
    vi.stubGlobal("fetch", fetchMock);
    await POST(request({ ...typed(), model: "google/gemini-3.1-flash-image" }));
    expect(sentBody(fetchMock, 0).model).toBe("google/gemini-3.1-flash-image");
    delete process.env.MIRAGE_ALLOWED_MODELS;
  });
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run api/_lib/devTools.test.ts api/_lib/models.handler.test.ts api/_lib/modelIds.test.ts`
Expected: FAIL. `./devTools` is missing, there's no 404, and flash-image is still allowed.

- [ ] **Step 3: Implement the server side**

`api/_lib/devTools.ts`:

```ts
// The dev panel and /api/models are for local tuning: on under `npm run dev`
// and `vercel dev`, off on deployments unless VITE_MIRAGE_DEV_TOOLS=1. The
// same variable switches the panel on in the browser build.

export function devToolsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return !env.VERCEL_ENV || env.VERCEL_ENV === "development" || env.VITE_MIRAGE_DEV_TOOLS === "1";
}
```

`api/models.ts`:

```ts
// GET /api/models — thin proxy to the OpenRouter model catalog (dev panel
// pickers). 404 unless dev tools are enabled.

import { devToolsEnabled } from "./_lib/devTools.js";

export async function GET(): Promise<Response> {
  if (!devToolsEnabled()) return new Response("Not found", { status: 404 });
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return new Response("OPENROUTER_API_KEY not configured", { status: 500 });
  const upstream = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, max-age=3600" },
  });
}
```

`api/_lib/modelIds.ts`: change to `const BUILT_IN_MODELS = [DEFAULT_PAGE_MODEL, DEFAULT_LINK_MODEL];` and add to the header comment: `// Pricier alternatives (e.g. google/gemini-3.1-flash-image) must be listed explicitly.`

- [ ] **Step 4: Implement the browser side**

`src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
```

`index.html`: add `data-dev` to the separator before the dev button and to the dev button itself:

```html
          <span class="fd-toolbar-sep" data-dev></span>
          <button id="fd-devpanel-btn" data-dev class="fd-iconbtn" title="Dev Panel (Ctrl+Shift+D)" style="font-size:11px; padding: 0 6px;">⚙ Dev</button>
```

`src/main.ts`:
- import: `import { DEFAULT_SETTINGS, loadSettings, setupDevPanel } from "./devPanel";`
- replace `let settings = loadSettings();` with:

```ts
const devTools = import.meta.env.DEV || import.meta.env.VITE_MIRAGE_DEV_TOOLS === "1";
let settings = devTools ? loadSettings() : { ...DEFAULT_SETTINGS };
```

- in `wire()`, replace the last four lines (`const panel = ...` through `dom.devBtn.addEventListener(...)`) with:

```ts
  if (devTools) {
    const panel = setupDevPanel((s) => {
      settings = s;
    });
    dom.devBtn.addEventListener("click", panel.toggle);
  } else {
    document.querySelectorAll("[data-dev]").forEach((el) => el.remove());
  }
```

- replace the last line of the file with:

```ts
if (devTools) (window as unknown as { __mirage: unknown }).__mirage = { session, navigate };
```

`.env.example`: replace the `MIRAGE_ALLOWED_MODELS` block with:

```
# Optional: extra models the dev panel may select (comma-separated OpenRouter ids).
# Anything else falls back to the defaults, so a public deploy can't be driven
# onto arbitrary or pricier models.
# MIRAGE_ALLOWED_MODELS=google/gemini-3.1-flash-image,openai/gpt-5-image-mini

# Optional: show the dev panel and serve /api/models on a deployment.
# Always on under `npm run dev`. Leave unset in production.
# VITE_MIRAGE_DEV_TOOLS=1
```

- [ ] **Step 5: Run the gates**

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 6: Manual check of the production build**

Run: `npx vite preview --host 127.0.0.1` and open the printed URL. There should be no ⚙ Dev button, and Ctrl+Shift+D should do nothing. In the devtools console, `window.__mirage` is `undefined`. (Pages won't load under `vite preview`, because it doesn't serve `api/`. That's expected.)

- [ ] **Step 7: Commit**

```bash
git add api/_lib/devTools.ts api/_lib/devTools.test.ts api/_lib/models.handler.test.ts api/models.ts api/_lib/modelIds.ts api/_lib/modelIds.test.ts api/_lib/page.handler.test.ts src/vite-env.d.ts src/main.ts index.html .env.example
git commit -m "Turn dev tools off in production builds and deployments

Dev panel, /api/models and window.__mirage only under npm run dev or
VITE_MIRAGE_DEV_TOOLS=1. Drop flash-image from the built-in allowlist.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Origin check and configurable attribution header

**Files:**
- Create: `api/_lib/origin.ts`, `api/_lib/origin.test.ts`
- Modify: `api/page.ts`, `api/links.ts`, `api/_lib/openrouter.ts`, `vite.config.ts`, `.env.example`
- Test: `api/_lib/page.handler.test.ts`, `api/_lib/links.handler.test.ts`, `api/_lib/openrouter.test.ts`

**Interfaces:**
- Produces: `isAllowedOrigin(req: Request, env?: Record<string, string | undefined>): boolean`. Env vars `MIRAGE_ALLOWED_ORIGINS` (comma-separated full origins) and `VITE_PUBLIC_URL` (e.g. `https://mirage.example`; Task 11 also uses it).

- [ ] **Step 1: Write the failing origin tests**

`api/_lib/origin.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isAllowedOrigin } from "./origin";

const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { method: "POST", headers });

describe("isAllowedOrigin", () => {
  it("accepts a same-origin request", () => {
    expect(isAllowedOrigin(req("https://mirage.app/api/page", { origin: "https://mirage.app" }), {})).toBe(true);
  });
  it("accepts an origin matching x-forwarded-host", () => {
    expect(isAllowedOrigin(req("http://internal/api/page", { origin: "https://mirage.app", "x-forwarded-host": "mirage.app" }), {})).toBe(true);
  });
  it("rejects a missing, foreign or garbage origin", () => {
    expect(isAllowedOrigin(req("https://mirage.app/api/page"), {})).toBe(false);
    expect(isAllowedOrigin(req("https://mirage.app/api/page", { origin: "https://evil.example" }), {})).toBe(false);
    expect(isAllowedOrigin(req("https://mirage.app/api/page", { origin: "null" }), {})).toBe(false);
  });
  it("accepts origins listed in MIRAGE_ALLOWED_ORIGINS", () => {
    const env = { MIRAGE_ALLOWED_ORIGINS: "https://a.com, https://b.com" };
    expect(isAllowedOrigin(req("https://mirage.app/api/page", { origin: "https://b.com" }), env)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run api/_lib/origin.test.ts`
Expected: FAIL, cannot resolve `./origin`.

- [ ] **Step 3: Implement `api/_lib/origin.ts`**

```ts
// Cheap deterrent against other sites (and casual scripts) calling the API:
// POSTs must carry an Origin whose host is this deployment's host, or one
// listed in MIRAGE_ALLOWED_ORIGINS. Not a security boundary (Origin can be
// forged outside a browser); signatures and rate limits do the real work.

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

export function isAllowedOrigin(req: Request, env: Record<string, string | undefined> = process.env): boolean {
  const origin = hostOf(req.headers.get("origin"));
  if (!origin) return false;
  const own = [hostOf(req.url), req.headers.get("x-forwarded-host"), req.headers.get("host")];
  const extra = (env.MIRAGE_ALLOWED_ORIGINS ?? "").split(",").map((s) => hostOf(s.trim()));
  return [...own, ...extra].some((h) => h === origin);
}
```

- [ ] **Step 4: Run the origin tests**

Run: `npx vitest run api/_lib/origin.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing handler and header tests**

In both `api/_lib/page.handler.test.ts` and `api/_lib/links.handler.test.ts`, add `headers: { origin: "http://localhost" }` to the `request` helper's `Request` init, and to the `"not json"` request in the page test. Then add to each `describe`:

```ts
  it("rejects requests from other origins", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const url = "http://localhost/api/page"; // use "/api/links" in the links test
    const foreign = new Request(url, { method: "POST", headers: { origin: "https://evil.example" }, body: "{}" });
    const none = new Request(url, { method: "POST", body: "{}" });
    expect((await POST(foreign)).status).toBe(403);
    expect((await POST(none)).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
```

Append to `api/_lib/openrouter.test.ts`, merging `afterEach`, `describe`, `expect`, `it`, `vi` and `postChat` into its existing imports if they aren't there:

```ts
describe("attribution headers", () => {
  afterEach(() => {
    delete process.env.VITE_PUBLIC_URL;
    vi.unstubAllGlobals();
  });
  it("sends HTTP-Referer only when VITE_PUBLIC_URL is set", async () => {
    process.env.OPENROUTER_API_KEY = "k";
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response("{}", { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    await postChat({ model: "m" });
    expect(fetchMock.mock.calls[0][1].headers["HTTP-Referer"]).toBeUndefined();
    process.env.VITE_PUBLIC_URL = "https://mirage.example";
    await postChat({ model: "m" });
    expect(fetchMock.mock.calls[1][1].headers["HTTP-Referer"]).toBe("https://mirage.example");
  });
});
```

- [ ] **Step 6: Run them to make sure they fail**

Run: `npx vitest run api/_lib/page.handler.test.ts api/_lib/links.handler.test.ts api/_lib/openrouter.test.ts`
Expected: FAIL. Foreign/no-origin requests aren't 403, and HTTP-Referer is still hardcoded.

- [ ] **Step 7: Implement**

In `api/page.ts` and `api/links.ts`, add `import { isAllowedOrigin } from "./_lib/origin.js";` and make this the line right after `const t0 = Date.now();`:

```ts
  if (!isAllowedOrigin(req)) return json({ error: "forbidden" }, 403);
```

`api/_lib/openrouter.ts`, the `headers` object in `postChat`:

```ts
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(process.env.VITE_PUBLIC_URL ? { "HTTP-Referer": process.env.VITE_PUBLIC_URL } : {}),
        "X-OpenRouter-Title": "Mirage",
      },
```

`vite.config.ts`, so the dev server passes the browser's origin and host through. In `config()`, extend the key list to `["OPENROUTER_API_KEY", "MIRAGE_ALLOWED_MODELS", "MIRAGE_SIGNING_SECRET", "MIRAGE_ALLOWED_ORIGINS", "VITE_PUBLIC_URL"]`. Replace the `new Request(...)` call with:

```ts
            new Request(`http://${req.headers.host ?? "localhost"}${req.url}`, {
              method: req.method,
              headers: {
                "content-type": req.headers["content-type"] ?? "application/json",
                ...(req.headers.origin ? { origin: req.headers.origin } : {}),
              },
              body: hasBody ? await readBody(req) : undefined,
              signal: ac.signal,
            })
```

`.env.example`, append:

```
# Optional: public URL of the deployment (no trailing slash). Sent to OpenRouter
# as HTTP-Referer for app attribution, and used for the Open Graph image URL.
# VITE_PUBLIC_URL=https://mirage.example

# Optional: extra origins allowed to call /api/page and /api/links (comma-separated).
# The deployment's own host is always allowed.
# MIRAGE_ALLOWED_ORIGINS=https://www.mirage.example

# Optional: secret for signing page images. Defaults to OPENROUTER_API_KEY.
# Set it in production so rotating the API key doesn't invalidate open sessions:
#   openssl rand -base64 32
# MIRAGE_SIGNING_SECRET=
```

- [ ] **Step 8: Run the gates**

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 9: Manual check in dev**

Run `npm run dev`. In the browser, a page loads, a link click works, and the run log shows page and links rows. In another terminal:
`curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:5173/api/page -d '{"request":{"mode":"typed","input":"x"}}'`
Expected: `403`.

- [ ] **Step 10: Commit**

```bash
git add api/_lib/origin.ts api/_lib/origin.test.ts api/page.ts api/links.ts api/_lib/openrouter.ts api/_lib/openrouter.test.ts api/_lib/page.handler.test.ts api/_lib/links.handler.test.ts vite.config.ts .env.example
git commit -m "Require a same-site Origin on page/link calls; make HTTP-Referer configurable

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Cap history at 40 entries

**Files:**
- Modify: `src/session.ts`
- Test: `src/session.test.ts`

**Interfaces:**
- Produces: `MAX_HISTORY = 40`, `new Session(maxEntries?: number)`.

- [ ] **Step 1: Write the failing test**

Add to the `describe("Session")` block in `src/session.test.ts`:

```ts
  it("keeps only the newest maxEntries pages", () => {
    const s = new Session(3);
    const [a, b, c, d] = [entry("a"), entry("b"), entry("c"), entry("d")];
    s.push(a); s.push(b); s.push(c); s.push(d);
    expect(s.current()).toBe(d);
    expect(s.back()).toBe(c);
    expect(s.back()).toBe(b);
    expect(s.canBack()).toBe(false);
    expect(s.forward()).toBe(c);
  });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/session.test.ts`
Expected: FAIL. `a` is still reachable, so `canBack()` is true.

- [ ] **Step 3: Implement**

In `src/session.ts`, above the class:

```ts
/** Each entry holds a page image of up to ~3.5 MB; older ones are dropped. */
export const MAX_HISTORY = 40;
```

Add a constructor to `Session` and trim in `push`:

```ts
  constructor(private readonly maxEntries = MAX_HISTORY) {}

  push(entry: Entry): void {
    this.entries = this.entries.slice(0, this.cursor + 1);
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) this.entries.shift();
    this.cursor = this.entries.length - 1;
  }
```

- [ ] **Step 4: Run the gates**

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/session.ts src/session.test.ts
git commit -m "Cap back/forward history at 40 pages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Phase 1 docs and launch checklist

**Files:**
- Modify: `AGENTS.md`, `README.md`

- [ ] **Step 1: Update `AGENTS.md`**

In **Architecture map**:
- replace the `src/pageContract.ts` line with `- \`api/_lib/pageContract.ts\` — the prompt contract and \`buildPagePrompt()\` for the four modes (server-side only).`
- add after the `api/_lib/` line:
  - `` - `api/_lib/pageRequest.ts` — validates the structured `{request}` body of `/api/page`. ``
  - `` - `api/_lib/sign.ts` — HMAC signatures on page images; `/api/links` and reference images require them. ``
  - `` - `api/_lib/origin.ts` — same-site `Origin` check on `/api/page` and `/api/links`. ``
  - `` - `api/_lib/devTools.ts` — dev panel + `/api/models` only locally or with `VITE_MIRAGE_DEV_TOOLS=1`. ``
- change the `api/page.ts` line to start `` `POST` `{request, model?}` page generation `` and add `Returns a signed image.`
- change the `src/session.ts` line to `` in-memory back/forward history (capped at 40), request builders, `NavThrottle`. ``

Replace the last paragraph of **Secrets** (from "Client-chosen models…" to the end) with:

```markdown
Client-chosen models go through a server-side allowlist (`api/_lib/modelIds.ts`
`pickModel()`); anything else falls back to the default. Extend it with
`MIRAGE_ALLOWED_MODELS` (comma-separated).

Abuse limits: the browser sends a structured `PageRequest`, never prompt text;
user text is capped at 200 chars on both sides. Page images are HMAC-signed
(`MIRAGE_SIGNING_SECRET`, falling back to the OpenRouter key), and unsigned
images are refused with 403. `Origin` must match the deployment. Per-IP rate
limits live in the Vercel Firewall, not in code.
```

- [ ] **Step 2: Update `README.md`**

- Architecture diagram line 15: `src/session.ts → PageRequest for mode typed | internal | external | search`. Change line 18 to `POST /api/page  → api/_lib/pageContract.ts builds the prompt → OpenRouter … → { url, title, image, sig, costUsd, ms }`.
- After the cost paragraph (line 32–33), add: `Worst case, one page request makes up to 6 upstream calls: two prompt attempts, each retried twice on 429/5xx. Only completed generations are billed, but an imageless first answer is billed and then retried.`
- Usage: change `**Ctrl+Shift+D** open the tuning panel` to `**Ctrl+Shift+D** open the tuning panel (dev builds only)`.
- Dev panel section: add `Only available under \`npm run dev\`, or on a deployment with \`VITE_MIRAGE_DEV_TOOLS=1\`.`
- Project layout: move `pageContract.ts` from `src/` to under `api/_lib/`, and add `vite-env.d.ts` to `src/`.
- Security section: add these bullets:
  - `The browser sends a structured request; prompts are built server-side and user text is capped at 200 characters`
  - `Page images are HMAC-signed; /api/links and reference images only accept signed images`
  - `/api/page and /api/links require a same-site Origin`
  - `Set a credit limit on the OpenRouter key and a per-IP rate limit in the Vercel Firewall before sharing widely`

- [ ] **Step 3: Run the gates and commit**

```bash
npm test && npm run build
git add AGENTS.md README.md
git commit -m "Document Phase 1 abuse limits

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Launch checklist (the user does these in dashboards)**

1. **OpenRouter spend cap:** openrouter.ai → Keys → edit the production key → set a credit limit (e.g. $20/month to start). Use a separate key for local dev.
2. **Vercel env vars (Production):** `OPENROUTER_API_KEY`; `MIRAGE_SIGNING_SECRET` (from `openssl rand -base64 32`); `VITE_PUBLIC_URL` (the real `https://` URL). Leave `VITE_MIRAGE_DEV_TOOLS` unset.
3. **Vercel Firewall rate limits:** Project → Firewall → Configure → New Rule:
   - Request path equals `/api/page` → Rate limit, **10 requests / 60 s per IP**, action Deny (429)
   - Request path equals `/api/links` → Rate limit, **30 requests / 60 s per IP**, action Deny (429)

   Rate-limit rules may depend on your plan. If they're unavailable, enable Bot Protection / BotID instead.
4. **Preview-deploy check before production:** deploy a preview with the production env vars copied to Preview, then confirm:
   - pages load and links click through (the Origin check passes on Vercel's real host)
   - `curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<preview>/api/page -d '{}'` prints `403`
   - there's no ⚙ Dev button

---

# Phase 2 — Visual and polish

### Task 9: Frame the 4:3 page in a centred window, and fix mobile overflow

**Files:**
- Modify: `index.html`, `src/style.css`

No unit tests (CSS only). Verified with screenshots at four viewport sizes.

- [ ] **Step 1: Move inline styles out of `index.html`**

Replace the window markup, from `<div class="window fd-window" …>` to the end of the status bar, with:

```html
      <div class="window fd-window">
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
          <input id="fd-url" class="fd-url" type="text" maxlength="200" placeholder="type anything" />
          <button id="fd-go" class="default">Go!</button>
          <span class="fd-toolbar-sep" data-dev></span>
          <button id="fd-devpanel-btn" data-dev class="fd-iconbtn fd-devbtn" title="Dev Panel (Ctrl+Shift+D)">⚙ Dev</button>
        </div>

        <div class="window-body fd-content">
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
          <p class="status-bar-field fd-status-main" id="fd-status-main">Home universe: unreachable.</p>
          <p class="status-bar-field fd-status-dim">Tuned to dimension #<span id="fd-dimension">4,817</span></p>
          <p class="status-bar-field fd-status-diag" id="fd-status-diag"></p>
          <p class="status-bar-field">🌐 Mirage v0.2</p>
        </div>
      </div>
```

- [ ] **Step 2: Replace the layout CSS in `src/style.css`**

Add to `:root`:

```css
  /* Desktop margin around the window, and the height of the window chrome
     (title bar + toolbar + status bar + borders). The page area gets what's
     left, at 4:3. */
  --fd-gutter: 16px;
  --fd-chrome-h: 104px;
```

Replace the `#app { … }` and `.fd-window { height: 100vh; … }` rules with:

```css
#app {
  height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--fd-gutter);
}

.fd-window {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(100%, calc((100dvh - 2 * var(--fd-gutter) - var(--fd-chrome-h)) * 4 / 3));
  font-size: 14px;
}
```

Replace the toolbar input rule (`.fd-toolbar input[type="text"] { … }`) with:

```css
.fd-url { flex: 1; min-width: 120px; font-family: "MS Sans Serif", Tahoma, sans-serif; }
.fd-devbtn { width: auto; font-size: 11px; padding: 0 6px; }
```

Add under the status-bar rules:

```css
.fd-status-main { flex: 1; min-width: 0; }
.fd-status-diag { min-width: 180px; font-family: monospace; font-size: 10px; white-space: nowrap; overflow: hidden; }
```

Replace `.fd-content { background: #808080; }` with:

```css
.fd-content {
  position: relative;
  flex: none;
  aspect-ratio: 4 / 3;
  padding: 2px;
  overflow: hidden;
  background: #808080;
}
```

Change these widths:
- `.fd-faded`: `width: 320px;` → `width: min(320px, calc(100% - 32px));`
- `.fd-splash > .window`: `width: 540px;` → `width: min(540px, calc(100% - 24px));`
- `.fd-devpanel`: `width: 440px;` → `width: min(440px, calc(100vw - 24px));`

Add `overflow-y: auto;` to `.fd-splash`. Then add at the end of the file:

```css
/* Phones: the window fills the width; drop the least useful chrome */
@media (max-width: 700px) {
  :root { --fd-gutter: 0px; }
  .fd-label, .fd-status-dim, .fd-status-diag { display: none; }
  .fd-url { min-width: 0; }
}
```

- [ ] **Step 3: Calibrate `--fd-chrome-h`**

Run `npm run dev` and open http://127.0.0.1:5173 in a 1440×900 window. In the devtools console run:

```js
document.querySelector(".fd-window").offsetHeight - document.querySelector(".fd-content").offsetHeight
```

Set `--fd-chrome-h` to that number, rounded up to an even number. Reload.

- [ ] **Step 4: Visual check at four sizes**

Load a page (e.g. `moon-pizza.com`) and take screenshots at 1920×1080, 1440×900, 1024×768 and 390×844 (phone). At each size:
- the window is centred on teal, with no scrollbars
- the image fills the content area with at most a hairline of grey (the model's image is close to, but not exactly, 4:3)
- hovering a link shows the dotted box exactly over the drawn link (hotspots line up)
- the splash and the "mirage faded" box fit on the phone width

- [ ] **Step 5: Run the gates and commit**

```bash
npm test && npm run build
git add index.html src/style.css
git commit -m "Frame the 4:3 page in a centred window; fit chrome on phones

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Idle screen before the first page

**Files:**
- Modify: `index.html`, `src/style.css`, `src/main.ts`

- [ ] **Step 1: Markup**

In `index.html`, inside `.fd-content`, before `<div id="fd-tuning" …>`:

```html
          <div id="fd-idle" class="fd-idle"><p>No signal.<br />Type an address and press Go!</p></div>
```

- [ ] **Step 2: Style**

`src/style.css`, after the `.fd-tuning` rules:

```css
/* Before the first page: a quiet, unmoving "no signal" screen */
.fd-idle {
  position: absolute;
  inset: 2px;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #111 var(--fd-noise);
}
.fd-idle p {
  margin: 0;
  padding: 6px 14px;
  background: rgba(0, 0, 0, 0.75);
  color: #9f9;
  font-family: "VT323", "Courier New", monospace;
  font-size: 24px;
  text-align: center;
}
```

It sits under the tuning screen (z-index 3) and the faded notice (z-index 4), so loading and errors still show on top.

- [ ] **Step 3: Hide it once a page is shown**

`src/main.ts`: add `idle: $<HTMLDivElement>("#fd-idle"),` to `dom`, and make `dom.idle.hidden = true;` the first line of `show()`.

- [ ] **Step 4: Check**

Run `npm run dev`. Close the splash with ✕: the "No signal" screen shows. Press Go: the tuning screen covers it, and once the page arrives the idle screen is gone. Going Back to the first page still shows a page, not the idle screen.

- [ ] **Step 5: Run the gates and commit**

```bash
npm test && npm run build
git add index.html src/style.css src/main.ts
git commit -m "Show a no-signal screen before the first page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Favicon, version, AI note, link previews

**Files:**
- Create: `public/og.png`
- Modify: `index.html`, `package.json`, `vite.config.ts`, `src/vite-env.d.ts`, `src/main.ts`, `src/style.css`

**Interfaces:**
- Consumes: `VITE_PUBLIC_URL` (Task 6).
- Produces: build-time constant `__APP_VERSION__: string`.

- [ ] **Step 1: Favicon "M"**

In the `<link rel="icon" …>` data URI in `index.html`, change the letter `%3EF%3C` to `%3EM%3C`.

- [ ] **Step 2: One source for the version**

`package.json`: `"version": "0.2.0"`.

`vite.config.ts`: add `import { readFileSync } from "node:fs";` at the top. Above `export default`:

```ts
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };
```

and add to the `defineConfig({...})` object:

```ts
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
```

`src/vite-env.d.ts`, append:

```ts
declare const __APP_VERSION__: string;
```

`index.html`: the last status field becomes `<p class="status-bar-field" id="fd-version">🌐 Mirage</p>`.

`src/main.ts`: add `version: $<HTMLParagraphElement>("#fd-version"),` to `dom`, and next to `setDimension(randomDimension());` at the bottom add:

```ts
dom.version.textContent = `🌐 Mirage v${__APP_VERSION__}`;
```

- [ ] **Step 3: AI-generated note in the splash**

`index.html`, right after the `<p><strong>Note:</strong> …</p>` line in the splash:

```html
          <p class="fd-splash-note">Every page is AI-generated parody. Nothing on it is real, and any resemblance to an actual website is a glitch in the multiverse.</p>
```

`src/style.css`, after `.fd-splash-body button`:

```css
.fd-splash-note { font-size: 12px; color: #444; }
```

- [ ] **Step 4: Meta description and Open Graph tags**

`index.html`, in `<head>` after `<title>`:

```html
    <meta name="description" content="A parody web browser that only reaches the internets of neighbouring parallel universes. Every page is drawn live by an image model." />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="Mirage" />
    <meta property="og:description" content="Browse the web that was never there." />
    <meta property="og:image" content="%VITE_PUBLIC_URL%/og.png" />
    <meta name="twitter:card" content="summary_large_image" />
```

Vite replaces `%VITE_PUBLIC_URL%` at build time from the env.

- [ ] **Step 5: Share image**

With `npm run dev` running, load a good-looking page. Resize the browser so the window is about 1200×630, or crop afterwards. Take a screenshot of the whole desktop (teal and window), crop it to exactly 1200×630, and save it as `public/og.png` (create `public/`). Keep it under 1 MB, e.g. `npx sharp-cli` or any editor at PNG/80% quality.

- [ ] **Step 6: Verify**

```bash
npm test && VITE_PUBLIC_URL=https://example.test npm run build
grep -o 'https://example.test/og.png' dist/index.html
ls dist/og.png
```

Expected: the grep prints the URL and `dist/og.png` exists. In `npm run dev`, the tab icon shows "M" and the status bar reads `🌐 Mirage v0.2.0`.

- [ ] **Step 7: Commit**

```bash
git add index.html package.json vite.config.ts src/vite-env.d.ts src/main.ts src/style.css public/og.png
git commit -m "Add favicon, single-source version, AI note and link-preview tags

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Phase 2 docs, repo hygiene, final check

**Files:**
- Modify: `README.md`, `AGENTS.md`, `.env.example`

- [ ] **Step 1: Docs**

- `README.md` project layout: add `public/og.png  # link-preview image`.
- `README.md` Deploying section: add `Set VITE_PUBLIC_URL so link previews and OpenRouter attribution point at your domain.`
- `AGENTS.md` architecture map: add `` - `src/vite-env.d.ts` — Vite client types and the `__APP_VERSION__` build constant (from package.json). ``
- `.env.example`: confirm all of these are documented: `OPENROUTER_API_KEY`, `MIRAGE_ALLOWED_MODELS`, `VITE_MIRAGE_DEV_TOOLS`, `VITE_PUBLIC_URL`, `MIRAGE_ALLOWED_ORIGINS`, `MIRAGE_SIGNING_SECRET`.

- [ ] **Step 2: Internal docs in the repo (user decision, item 13)**

Ask the user whether the repo itself will be public, and if so, whether to keep `docs/superpowers/`, `modelTestingNotes.md` and `mirage-design-doc.md`. If they say remove: `git rm -r docs/superpowers modelTestingNotes.md mirage-design-doc.md` (they stay in git history). Otherwise leave them.

- [ ] **Step 3: Final verification**

```bash
npm test && npm run build
```

Then repeat the Task 8 Step 4 preview-deploy check, plus the Task 9 Step 4 visual check on the preview URL.

- [ ] **Step 4: Commit**

```bash
git add -A README.md AGENTS.md .env.example
git commit -m "Document Phase 2 and deployment env vars

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
