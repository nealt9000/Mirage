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

- `api/page.ts` — `POST` `{request, model?}` page generation (`google/gemini-3.1-flash-lite-image`,
  `modalities: ["image","text"]`, 4:3). Retries once with a strict suffix when no
  image comes back, then returns `{error:"faded"}`. Shrinks images over
  `MAX_IMAGE_CHARS` to JPEG. Returns a signed image.
- `api/links.ts` — `POST` link scan (`google/gemini-3-flash-preview`, `box_2d`
  0–1000) or point resolve (crop 30%×20% around a click).
- `api/models.ts` — `GET` OpenRouter model catalog for the dev panel.
- `api/_lib/` — shared server code and its tests. Vercel does not route
  `_`-prefixed dirs, so **never put a test file directly in `api/`**.
- `api/_lib/pageContract.ts` — the prompt contract and `buildPagePrompt()` for the four
  modes: `typed`, `internal`, `external`, `search` (server-side only).
- `api/_lib/pageRequest.ts` — validates the structured `{request}` body of `/api/page`.
- `api/_lib/sign.ts` — HMAC signatures on page images; `/api/links` and reference
  images require them.
- `api/_lib/origin.ts` — same-site `Origin` check on `/api/page` and `/api/links`.
- `api/_lib/devTools.ts` — dev panel + `/api/models` only locally or with
  `VITE_MIRAGE_DEV_TOOLS=1`.
- `src/pageMeta.ts` — fallback url/title when the model's metadata line is missing.
- `src/session.ts` — in-memory back/forward history (capped at 40), request builders,
  `NavThrottle`.
- `src/hotspots.ts` — pure box scaling/hit-testing + the overlay layer.
- `src/loading.ts` — heat-haze / tuning-screen loading states.
- `src/openrouter.ts` — browser wrappers for the `api/` endpoints.
- `src/devPanel.ts` — Ctrl+Shift+D: page model, link model, link mode, run log.
  Settings persist under `mirage.settings.v2`.
- `src/vite-env.d.ts` — Vite client types and the `__APP_VERSION__` build constant
  (from package.json).
- `src/modelStats.ts` — in-memory cost/latency log.

## Model output quirks (handled; keep the tests)

- The link model sometimes emits stray tokens between array entries, so
  `parseLinks()` falls back to parsing each `{...}` entry on its own.
- The page model sometimes drops a closing quote in its metadata line, so
  `parseMeta()` falls back to reading each field on its own.
- Prompt wording that mentions screenshots, browsers or the address bar makes
  the page model draw browser chrome into the page. The contract avoids it.

## Retry policy

`api/_lib/openrouter.ts` `postChat()` retries `429`, `502`, `503`, `504` up to
`MAX_RETRIES`=2, each wait capped at `MAX_RETRY_MS`=5000 (429 honours
`Retry-After`; 5xx backs off linearly). Errors are logged server-side. The
browser only ever sees `{error:"faded"}` / `{error:"links-unavailable"}`, and the
UI shows "The mirage faded." with a Retry button.

## Secrets

`OPENROUTER_API_KEY` is read server-side only (`.env.local` in dev, Vercel env in
production). Never send it to the browser.

Client-chosen models go through a server-side allowlist (`api/_lib/modelIds.ts`
`pickModel()`); anything else falls back to the default. Extend it with
`MIRAGE_ALLOWED_MODELS` (comma-separated).

Abuse limits: the browser sends a structured `PageRequest`, never prompt text;
user text is capped at 200 chars on both sides. Page images are HMAC-signed
(`MIRAGE_SIGNING_SECRET`, falling back to the OpenRouter key), and unsigned
images are refused with 403. `Origin` must match the deployment. Per-IP rate
limits live in the Vercel Firewall, not in code.
