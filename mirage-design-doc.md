# MIRAGE — Concept & Design Document

*Browse the web that was never there.*

> **Status:** Living document · rev 0.3. Steers development past the MVP.
> **Codebase:** `FeverDreamWebSurfer` is the retired working title; the product is **Mirage**.
> **Current build:** image-first pipeline — every page is one hallucinated image of a website, made clickable by an invisible hotspot layer.

---

## 1. One-line pitch

Mirage is a parody web browser that can only reach the internets of neighboring parallel universes. Every page is hallucinated by AI at the moment you request it — never retrieved, never stored — producing a web that is eerily like ours and never quite ours.

---

## 2. The conceit

This is the fiction the product commits to and never breaks:

Mirage is a browser. It looks like one and behaves like one. Its network stack is "broken" in exactly one magical way: it cannot connect to our universe's internet. It can only pick up signal from adjacent universes — and it picks them up as **real, working websites**, complete with internal links that lead where they say they lead.

The neighbor universes are *close*. Recognizable brands, formats, and cultural touchstones — but always subtly or wildly wrong. The target sensation is familiar-but-off: the uncanny valley of the web. Neither pure realism nor pure surrealism.

**You never choose the universe.** Which universe a given page is drawn from is never selectable and never announced. You can ask for an address; you cannot ask for a world. Whatever neighbor answers is the one you get.

**Coherence within a site, drift across the web.** While you stay on one site and follow its internal links, you remain in one universe — the site behaves like a real, working website. But the moment a new thread begins — you type a new address, you reload, or you follow an external link to another domain — the universe is silently re-drawn at random. Over a session you drift across neighbors and can never steer back to one. An external link doesn't just leave the site; it leaves the universe. That is why the next page knows nothing about where you came from: it is a different world's version of the same idea.

Reloading is re-tuning. The same address yields a different world each time. Nothing is stable, nothing returns. Ephemerality is the experience, not a limitation.

The browser is honest about its dishonesty — but only in the chrome. Flavor copy says "home universe unreachable" and "tuning to dimension #…". The *content inside the page always plays it completely straight.* The fiction never winks at you from inside the page.

---

## 3. Why it exists

Mirage turns AI's most-criticized failure mode — confident fabrication, "slop" — into the entire point. By making hallucination the explicit product rather than an embarrassing accident, it gives people a safe, playful, self-aware space to feel what it's like when a machine generates a convincing reality with zero grounding.

It is a conversation piece about epistemics. What makes something *feel* real? How much of "realness" is just plausibility, formatting, and confidence? When everything is labeled fake but looks real, where does your trust actually go?

The order of operations matters: **delight first, provoke second.** It should be genuinely fun to surf. The commentary lands precisely because the experience is seductive — not because the product lectures. It is a concept piece, not a tool: an in-the-moment experience, not something meant to function as a real browser.

---

## 4. Design principles

Every downstream decision is checked against these.

1. **Plausible, not random, yet always leaning into the absurd.** Hallucination is not noise. Pages must be internally coherent. The magic is "this could be comically and ironically real in another universe" never "this is gibberish."
2. **Confident fabrication.** No hedging, no "as an AI," no disclaimers inside a page. The universe believes in itself completely.
3. **Familiar but wrong.** Every page should carry at least one recognizable anchor *and* at least one thing that's off.
4. **The frame is honest; the content is not.** Every "this is fake / parallel / unreachable" signal lives in the browser chrome. Never in the page.
5. **Impermanence is absolute.** Nothing persists. No bookmarks, no saved history, no way to pin or return to a universe. Back/forward retraces only the current live session and dies when the tab closes. Protect this against every future "let's just add caching/saving" — it is the thing that makes Mirage *Mirage*. The one exception, is the ability to share a single page, where others can visit the page you visited as their starting point, before jumping off into another rabbit hole of hallucinations.
6. **Tune for hallucination.** Generation maximizes invention, not accuracy. Creativity rails come off; safety rails (no real-person defamation, no genuinely harmful content) stay on.

---

## 5. The hallucination engine

*This section describes the shipping architecture.*

**Image-first.** Every page is one image of a website from a neighbouring universe, drawn by `google/gemini-3.1-flash-lite-image` via OpenRouter (~5–8 s, ~$0.034/page). The image model is itself the best hallucinator we tested: it invents its own jokes beyond the prompt. The prompt contract asks for a flat page (not a browser mockup), legible text, parody brands only, played completely straight, plus a one-line `{url, title}` metadata header.

**Making it clickable.** After the page appears, `google/gemini-3-flash-preview` maps every clickable element to a `box_2d` (0–1000). An invisible layer over the image turns those boxes into hover, click and search-box targets. Until the map arrives, a click is resolved on demand from a crop around the pointer.

**Four ways to arrive at a page.** *Typed* (URL bar, home, reload): a fresh universe from the typed text. *Internal* click: the current page goes along as a reference image, so the site keeps its logo, nav and footer. *External* click: no reference, a fresh universe. *Search*: the reference image plus the typed query → a results page on the same site.

**Session only.** Back/forward re-show cached images with no calls; nothing persists beyond the tab. The API key lives server-side in Vercel Functions; the browser never sees upstream errors, only "The mirage faded."

---

## 6. Product surface (UX)

**Chrome.** Back / forward (live-session only), reload, a URL bar (kept, editable — typing an address navigates), and home (a fresh portal homepage).

**Explicitly absent.** No bookmark control. No history sidebar. No saved state of any kind. (Struck from the roadmap by design — Principle 5.)

**Reload semantics.** Reload re-tunes to a new neighbor: same address, new universe.

**Flavor copy** (chrome only — reinforces the conceit, never breaks page content):
- Idle/status: *"Home universe: unreachable."* / *"Tuned to dimension #4,817."*
- Loading: *"Receiving signal from a neighbouring universe…"*
- Timeout/error: *"The mirage faded."*

**Loading.** Same-site navigation shimmers the current page in a heat haze; a new universe shows a "tuning" static screen. The new page fades in from noise.

**Page area.** A single hallucinated image, letterboxed in the window, with an invisible hotspot layer for links and search boxes.

---

## 7. Current scope

**In:**
- URL bar + go; hallucinated page images; hotspot layer for links and search boxes.
- Site coherence via reference images; fresh-universe draws on typed addresses, reloads and external links.
- Core chrome, flavor copy, loading/re-tune states; dev panel (Ctrl+Shift+D) with model selection, link mode and a per-request cost/latency log.
- Per-reload universe re-roll; session-only back/forward.

**Deferred — architecture must not preclude:**
- Cost tuning (click-only link resolution, cheaper scans, smaller images, model tiering).
- Multiple windows / tabbed browsing.
- Pages taller than one screen.

**Struck (will not build):**
- Bookmarks. History sidebar. Any durable persistence or universe pinning.

---

## 8. Tone, voice & identity

**Name:** Mirage *(formerly the working title FeverDream WebSurfer)*. **Primary tagline:** *Browse the web that was never there.*
Alternates on the shelf: *Every page is a mirage* · *A faithful archive of things that never happened* · *Loading a web that doesn't exist. Please wait.*

**Voice of the chrome:** dry, deadpan, faintly melancholy — a sci-fi sysadmin who knows it can't get home.
**Voice of the pages:** whatever that fake universe's web would actually sound like, played entirely straight.

**Visual direction (recommendation, open to override):** a familiar-but-wrong browser — unmistakably "a browser," with one or two details that feel slightly off — paired with a mirage / heat-shimmer motif (warm, hazy, a subtle shimmer or transmission overlay on load) rather than cold tech-blue, to separate it from real browsers and reinforce the name.

---

## 9. Roadmap

- **Phase 1 — Image-first (current):** hallucinated page images with working links; cost and latency visible in the dev panel.
- **Phase 2 — Cost tuning:** measured experiments against a fixed comparison set (see the design spec).
- **Phase 3 — Multiplicity:** multiple windows / tabbed browsing (each tab its own drifting thread).
- **Phase 4 — The conversation:** ways to capture/share a single mirage in the moment, framing the "what's real?" question — emergent, never preachy, and never at the cost of impermanence.

---

## 10. Open questions to resolve

Deliberately left open so the document steers rather than pretends to be final.

1. **Divergence dial.** How "wrong" is the default neighbor — uncanny-subtle or gleefully divergent? *(Recommendation: make it tunable; default to mid.)*
2. **Landing page.** Does the user start on a fake portal/search engine, or land mid-web? *(The home button currently draws a fresh portal homepage.)*
3. **Thesis in-product.** How hard do we state the AI-slop / what's-real theme inside the product vs. letting it emerge? *(Recommendation: emergent.)*
4. **Latency vs. cost.** Where's the line between page quality, the ~5–8 s wait, and per-page cost?

*Resolved:*
- **Universe control** → none; universe drawn, never chosen; coherent within a site, re-drawn at every new thread (type / reload / external link).
- **Impermanence** → absolute. Bookmarks and history sidebar struck.
- **Eras / years** → removed. The model decides when a page is from.
