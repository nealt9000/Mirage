# Mirage

*Browse the web that was never there.*

A parody web browser that can only reach the internets of neighbouring parallel universes. Every page is a single hallucinated image of a website, drawn live by an image model, with an invisible layer over it that makes the links and search boxes work. No real network requests, no real brands.

Nothing exists until you ask for it. The homepage, the search results, the destination pages, even the external sites you click through to — all fabricated as you navigate.

## Architecture (one minute version)

```
URL bar / click / search box
        │
        ▼
 src/session.ts → PageRequest for mode typed | internal | external | search
        │                                (internal/search send the current page as a reference image)
        ▼
 POST /api/page  → api/_lib/pageContract.ts builds the prompt → OpenRouter gemini-3.1-flash-lite-image → { url, title, image, sig, costUsd, ms }
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

A page takes ~5–8 s and costs ~$0.034; mapping its links adds ~$0.005. Until
the link map arrives, a click is resolved on demand from a crop around the pointer.

Worst case, one page request makes up to 6 upstream calls: two prompt attempts,
each retried twice on 429/5xx. Only completed generations are billed, but an
imageless first answer is billed and then retried.

## Requirements

- **Node.js** 22+
- **OpenRouter API key** with credits — [openrouter.ai/keys](https://openrouter.ai/keys)

## Setup (one time)

### 1. Configure your API key

```bash
cp .env.example .env.local
# Edit .env.local and add your OpenRouter key:
#   OPENROUTER_API_KEY=sk-or-v1-your-key-here
```

### 2. Install dependencies

```bash
npm install
```

### 3. Run the dev server

```bash
npm run dev
# → http://127.0.0.1:5173
```

The dev server loads the key from `.env.local` and serves the `api/` functions locally.

## Usage

- **Type anything** in the Address bar and press `Go!` (or Enter) to tune to a new dimension
- **Click anything on a page** — most links stay on the site; ads and partner badges cross to another universe
- **Type into a page's search box** and press Enter for a results page on the same site
- **◀ ▶** go back / forward (instant, cached)
- **🏠** tune to a fresh portal homepage
- **⟳** re-tune to a new neighbour (same address, new universe)
- **Ctrl+Shift+D** open the tuning panel (dev builds only)

### Try these

- `moon-pizza.com` — a pizzeria with a lunar delivery radius
- `best haunted toaster reviews` — consumer journalism for possessed appliances
- just press Go — a fresh portal homepage from a new universe each time

## Dev panel (Ctrl+Shift+D)

- **Page model** — image-output models from the OpenRouter catalog
- **Link model** — image-input models used to map links
- **Link mode** — `scan` (map every page in the background; hover + search boxes) or `click-only` (resolve each click on demand)
- **Run log** — cost and latency of every page/scan/click call, plus the session total (in memory only)

Settings persist to `localStorage`. Only available under `npm run dev`, or on a deployment with `VITE_MIRAGE_DEV_TOOLS=1`.

## Testing

```bash
npm test        # Vitest unit tests
npm run build   # typechecks src and api, then builds
```

## Deploying to Vercel

```bash
# Set the environment variable in your Vercel project:
#   vercel env add OPENROUTER_API_KEY
# Then deploy:
vercel
```

The `api/` directory contains Vercel Functions (Node runtime) that hold the key server-side and call OpenRouter. The static build in `dist/` is served for all other routes.

## Project layout

```
Mirage/
├── api/
│   ├── page.ts              # POST: hallucinate a page image (OpenRouter)
│   ├── links.ts             # POST: map clickable boxes / resolve one click
│   ├── models.ts            # GET: model catalog for the dev panel
│   └── _lib/                # shared server code + tests (not routed)
│       └── pageContract.ts  # Prompt contract + per-mode prompt builders
├── index.html               # Browser chrome shell
├── src/
│   ├── main.ts              # Wiring: chrome ↔ session ↔ API
│   ├── pageMeta.ts          # Fallback url/title derivation
│   ├── session.ts           # Back/forward history + request builders
│   ├── hotspots.ts          # Invisible link/search layer over the image
│   ├── loading.ts           # Heat-haze / tuning loading states
│   ├── openrouter.ts        # Browser wrappers for api/
│   ├── devPanel.ts          # Ctrl+Shift+D settings + run log
│   ├── modelStats.ts        # In-memory cost/latency log
│   ├── types.ts             # Shared types (also used by api/)
│   ├── vite-env.d.ts        # Vite client types
│   └── style.css
├── .env.example
├── package.json
├── tsconfig.json            # src typecheck
├── tsconfig.api.json        # api typecheck
├── vitest.config.ts
├── vite.config.ts           # Dev server: serves api/ handlers locally
└── vercel.json
```

## Security

- Pages are plain images; no generated markup or script ever runs in the browser
- The OpenRouter API key lives server-side only (Vercel Function or dev server) — never in the browser bundle
- Upstream errors are logged server-side; the browser only ever sees "The mirage faded."
- The browser sends a structured request; prompts are built server-side and user text is capped at 200 characters
- Page images are HMAC-signed; /api/links and reference images only accept signed images
- /api/page and /api/links require a same-site Origin
- Set a credit limit on the OpenRouter key and a per-IP rate limit in the Vercel Firewall before sharing widely

## Roadmap

- Cost tuning: click-only link resolution, cheaper scans, smaller images, model tiering
- Multiple windows / tabbed browsing
- Sharing a single page as a starting point

## License

MIT.
