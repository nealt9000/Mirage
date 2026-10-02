# Image-First Mirage — Design Spec

**Date:** 2026-10-02
**Status:** Approved in brainstorming; awaiting written-spec review
**Supersedes:** the HTML-generation pipeline (`hallucinate.ts` / `render.ts` / classify / handoff / era system)

## 1. Intent

Mirage's mission: harness AI hallucination to produce a surreal, comedic web-surfing
experience — every page a convincing website from a neighbouring universe, played
completely straight.

The previous pipeline (LLM writes HTML → sanitize → iframe) never reached shippable
speed. Pre-formatted templates and an era lock (1999–2003) improved speed but worked
against the spirit of the project. That approach is considered fully explored.

**New approach:** each page is a single hallucinated *image* of a website, generated
by an image model, with an invisible hotspot layer over it that makes the links work.

**Decisions made during brainstorming**

| Topic | Decision |
|---|---|
| Inference budget | Paid inference OK. Phase 1 accepts ~$0.037/page; phase 2 tunes cost down. |
| Eras | Removed entirely. The model decides when a page is from. |
| Page model | `google/gemini-3.1-flash-lite-image` via OpenRouter |
| Link model | `google/gemini-3-flash-preview` via OpenRouter (bounding boxes) |

**Success criteria (phase 1)**
- A page arrives in ~5–8 s with a diegetic loading state, so the wait reads as "tuning in".
- Page text (headlines, nav, product names, body copy) is legible.
- Internal links keep the site's branding; external links and typed URLs draw a fresh universe.
- Every visibly clickable element can be clicked; search boxes accept typing.
- Per-page cost and latency are visible in the dev panel.

## 2. Spike evidence (2026-10-02)

Five prompts (portal, shop, news, forum, personal page) were run against seven image
models; throwaway code was kept in the session scratchpad.

| Model | Latency | $/page | Text quality |
|---|---|---|---|
| gemini-3.1-flash-lite-image | 4–6 s | $0.034 | Fully legible, incl. paragraphs |
| gemini-3.1-flash-image | 11–14 s | $0.067 | Best |
| flux-2-klein-9b (Cloudflare) | ~2 s | very low | Headlines OK, sparse |
| gpt-5-image-mini | 40–60 s | $0.045 | Good, too slow |
| flux-1-schnell / lucid-origin | 2–4 s | low | Small text garbled |

Key findings:
- Gemini image models **invent extra jokes** beyond the prompt, e.g. "Void Whales Observed
  migrating near Jupiter". The image model is itself the best hallucinator tested.
- **Click-through coherence:** with the previous page passed as a reference, the next
  page keeps the same logo, nav and footer and writes legible article copy (8–10 s).
- **Link extraction:** Gemini Flash returns pixel-accurate `box_2d` boxes (0–1000,
  `[ymin, xmin, ymax, xmax]`), 25 elements on the portal page, in 5–10 s for ~$0.003–0.005.
  Qwen-VL's boxes used a different convention and it was dropped.

## 3. Architecture

```
URL bar / click / search input
        │
        ▼
 src/session.ts ── builds request (mode, prompt inputs, optional reference image)
        │
        ▼
 POST /api/page ──► OpenRouter: gemini-3.1-flash-lite-image
        │             modalities [image, text], aspect 4:3
        ▼
 { url, title, image, costUsd, ms }  → <img> shown, chrome updated, history push
        │
        ▼  (background, non-blocking)
 POST /api/links ──► OpenRouter: gemini-3-flash-preview → [{label, kind, dest, external, box}]
        │
        ▼
 src/hotspots.ts ── overlay of clickable regions + <input> overlays
```

### 3.1 Navigation modes and prompts (`src/pageContract.ts`)

All prompts share a short **contract**: a full-page desktop screenshot of a website
from a parallel universe; content is confidently absurd and plays it completely straight;
no in-page winks; crisp legible text; flat screenshot with **no browser frame, no OS
taskbar**; no real brand names (parodies only); no real-person defamation or genuinely
harmful content. Before the image, the model emits **one line** of JSON:
`{"url": "...", "title": "..."}`.

| Mode | Trigger | Reference image | Prompt inputs |
|---|---|---|---|
| `typed` | URL bar / home / reload | none | the typed text (empty → "a web portal homepage") |
| `internal` | click on a non-external hotspot | current page image | site url/title, clicked `label`, `dest` |
| `external` | click on an external hotspot | none (new universe) | clicked `label`, `dest` only |
| `search` | Enter in an input overlay | current page image | site url/title, input `label`, query text |

Reload re-generates in `typed` mode from the current URL, which re-rolls the universe.

The prompt builders are pure functions:
`buildPagePrompt(req: PageRequest): { text: string; referenceImage?: string }`.

### 3.2 `/api/page` (Vercel Function, Node runtime)

- Input: `{ prompt: string, referenceImage?: string (data URI) }`.
- Calls OpenRouter `/chat/completions` with `modalities: ["image","text"]` and
  `image_config: { aspect_ratio: "4:3" }`.
- Parses the metadata line from the text content (first `{...}` JSON object). If it is
  missing or invalid, it returns `url: null, title: null`, and the client derives them:
  a slug of the label, under the current site for `internal`, or a fresh invented domain
  slug for `external`/`typed`.
- Returns `{ url, title, image (data URI), costUsd, ms }`. If the image exceeds about
  4 MB it is re-encoded to JPEG, to stay under the 4.5 MB response limit.
- Errors: no image in the response → one retry with a stricter suffix ("Respond with
  the metadata line and an image only"). After that it returns
  `{ error: "faded" }`. 429/5xx keep the existing retry policy (MAX_RETRIES=2,
  MAX_RETRY_MS=5000), now implemented server-side in this function rather than in the
  client streaming code. Upstream detail is never shown to the user.
- The API key stays server-side (`OPENROUTER_API_KEY`).

### 3.3 `/api/links`

- **Full scan:** input `{ image }` returns `Link[]` with
  `Link = { label, kind: "link"|"button"|"input"|"image", dest, external, box: [ymin,xmin,ymax,xmax] /* 0–1000 */ }`.
- **Point resolve:** input `{ image, point: {x,y} /* 0–1000 */ }`. The server crops
  roughly 30% × 20% of the image around the point, asks "what element is at the centre,
  and where does it lead", and returns a single `Link` (or `null` if nothing clickable).
- `temperature: 0`. The JSON is fence-stripped and parsed; malformed entries are dropped,
  not fatal.

### 3.4 Client modules

- **`src/session.ts`**: the history stack of
  `Entry = { imageDataUri, url, title, links: Link[] | null, siteKey }`, plus a cursor for
  back/forward. Back and forward re-show the entry with no calls. In-memory only;
  nothing goes to `localStorage` except dev settings.
- **`src/hotspots.ts`**: renders absolutely positioned transparent `<a>` elements over
  the `<img>`, scaled from 0–1000 to rendered pixels. It recomputes on resize via a
  `ResizeObserver`. Hover shows `dest` in the status bar. `kind: "input"` gets a
  transparent `<input>` sized to the box. Clicking an empty area before the scan
  arrives triggers point resolve; once the scan has arrived, empty-area clicks do nothing.
  The scaling and hit-testing functions are pure and exported for tests.
- **`src/ollama.ts`**: renamed to `src/openrouter.ts` and reduced to thin `fetchPage()` /
  `fetchLinks()` wrappers around the two endpoints, plus the model catalog fetch for the
  dev panel.
- **`src/devPanel.ts`**: settings for the page model, link model, and link mode
  (`scan` | `click-only`), plus a per-page log of cost, latency and model fed by `modelStats.ts`.
- **`src/main.ts`**: wires the chrome to the session. The page area becomes
  `<div class="page"><img><div class="hotspots"></div></div>`.

### 3.5 Loading experience (CSS only)

- **`internal` / `search`:** the current page blurs, desaturates and shimmers in a
  heat-haze style. The new image fades in from noise.
- **`typed` / `external`:** a "tuning" static screen with rotating chrome copy
  ("Receiving signal from a neighbouring universe…", "Tuned to dimension #4,817").
- The status bar shows elapsed seconds. Navigating again while a page loads aborts the
  in-flight request with an `AbortController`.
- On error the chrome shows "The mirage faded." with a Retry button. The page area
  keeps the previous page.

## 4. Removals

Deleted:
- `src/hallucinate.ts`, `src/render.ts`, `src/classify.ts`, `src/handoff.ts`,
  `src/homepageContract.ts`, `src/agent.ts`
- `api/image.ts`, `api/image-gemini.ts`, `api/chat.ts`

Changed:
- `src/systemPrompts.ts` is replaced by `src/pageContract.ts`.
- All era, year, archetype and visual-archetype types and UI are removed from `types.ts`,
  `main.ts` and `index.html`. This includes the year dropdown and per-navigation year
  randomisation.
- DOMPurify is removed from dependencies if nothing else uses it.
- `AGENTS.md` and `mirage-design-doc.md` are updated to describe the image-first pipeline.
  The design doc's era principle (#8) and its Ollama/local-generation text are retired.

## 5. Testing

- `npm run build` (tsc + vite) must pass. This is the repo's correctness gate.
- Add **Vitest** as a dev dependency, with unit tests for:
  - the prompt builders (each mode includes and omits the right inputs and reference)
  - metadata-line parsing (valid JSON, missing line, garbage → fallback derivation)
  - box scaling 0–1000 → pixels, and hit-testing
  - `/api/links` response parsing (fenced JSON, malformed entries dropped)
- Manual browser checklist before claiming done: typed URL; internal click (branding
  held); external click (new universe); search input → results page; back/forward
  instant; resize keeps hotspots aligned; forced error shows "The mirage faded"; dev
  panel shows cost and latency.

## 6. Phase 2: cost tuning (not part of phase-1 implementation)

Each experiment is measured with the phase-1 cost/latency log against a fixed
comparison set (the 5 spike prompts plus 2 click-throughs), judged on cost, latency,
wit and legibility.

1. **Click-only link resolution:** drop the full scan (saves ~$0.003–0.005/page) and
   lose the hover affordance.
2. **Cheaper scan:** gemini-3.5-flash-lite, or a downscaled image sent to the scan model.
3. **Smaller output images:** check whether Flash-Lite image token counts change with
   size or aspect settings. Output tokens are about 99% of page cost.
4. **Direct Gemini API** versus OpenRouter, including flex or batch pricing tiers.
5. **Model tiering:** flux-2-klein-9b plus an LLM-written joke prompt for
   `typed`/`external` pages; Gemini for `internal` pages.
6. **Hover-intent prefetch** to cut perceived latency, at extra cost.

## 7. Out of scope

Page sharing, tabs/multiple windows, pages taller than one screen (scrolling), mobile
layout, and any persistence beyond the live session.
