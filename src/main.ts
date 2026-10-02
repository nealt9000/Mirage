// Main app: boots the browser chrome and wires navigation (URL bar, hotspot
// clicks, search inputs, back/forward/home/reload) to the image pipeline.
// /api/page builds the prompt and draws each page; /api/links maps its links in the background.

import "./style.css";
import { DEFAULT_SETTINGS, loadSettings, setupDevPanel } from "./devPanel";
import { HotspotLayer } from "./hotspots";
import { LoadingView } from "./loading";
import { recordRun } from "./modelStats";
import { fetchLinks, fetchPage, isAbortError, resolvePoint } from "./openrouter";
import { deriveMeta, siteKeyOf } from "./pageMeta";
import { linkRequest, NavThrottle, requestKey, searchRequest, Session, typedRequest } from "./session";
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
  idle: $<HTMLDivElement>("#fd-idle"),
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
const throttle = new NavThrottle();
const devTools = import.meta.env.DEV || import.meta.env.VITE_MIRAGE_DEV_TOOLS === "1";
let settings = devTools ? loadSettings() : { ...DEFAULT_SETTINGS };
let inflight: AbortController | null = null;
let lastRequest: PageRequest | null = null;
let resolveAc: AbortController | null = null;
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
  if (!throttle.tryStart(requestKey(req), performance.now())) return;
  hideSplash();
  cancelResolve();
  inflight?.abort();
  const ac = new AbortController();
  inflight = ac;
  lastRequest = req;
  dom.faded.hidden = true;
  if (req.mode === "typed" || req.mode === "external") setDimension(randomDimension());
  loading.start(req.mode, dimension, session.current() !== null);

  const t0 = performance.now();
  try {
    const res = await fetchPage({ request: req, model: settings.pageModel }, ac.signal);
    recordRun({ kind: "page", model: res.model, ms: res.ms, costUsd: res.costUsd, ok: true });
    if (inflight !== ac) return;
    inflight = null;
    throttle.finish();
    const { url, title } = deriveMeta(req, res);
    const entry: Entry = { imageDataUri: res.image, imageSig: res.sig, url, title, links: null, siteKey: siteKeyOf(url) };
    session.push(entry);
    show(entry);
    loading.arrive();
    dom.status.textContent = `Done. (${(res.ms / 1000).toFixed(1)}s)`;
    if (settings.linkMode === "scan") void scanLinks(entry);
  } catch (e) {
    if (isAbortError(e) || inflight !== ac) return;
    inflight = null;
    throttle.finish();
    recordRun({ kind: "page", model: settings.pageModel, ms: Math.round(performance.now() - t0), costUsd: 0, ok: false });
    loading.stop();
    dom.faded.hidden = false;
    dom.status.textContent = "The mirage faded.";
  }
}

function show(entry: Entry): void {
  dom.idle.hidden = true;
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
    const res = await fetchLinks(entry.imageDataUri, entry.imageSig, settings.linkModel);
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
  if (!entry || resolveAc) return;
  const ac = new AbortController();
  resolveAc = ac;
  dom.status.textContent = "Feeling for a link…";
  const t0 = performance.now();
  try {
    const res = await resolvePoint(entry.imageDataUri, entry.imageSig, point, settings.linkModel, ac.signal);
    recordRun({ kind: "point", model: res.model, ms: res.ms, costUsd: res.costUsd, ok: true });
    // A newer navigation (or back/forward) supersedes this click.
    if (ac.signal.aborted || session.current() !== entry) return;
    if (!res.link) {
      dom.status.textContent = "Nothing there.";
    } else if (res.link.kind === "input") {
      hotspots.showInput(res.link);
      dom.status.textContent = res.link.dest;
    } else {
      void navigate(linkRequest(entry, res.link));
    }
  } catch (e) {
    if (isAbortError(e)) return;
    recordRun({ kind: "point", model: settings.linkModel, ms: Math.round(performance.now() - t0), costUsd: 0, ok: false });
    if (session.current() === entry) dom.status.textContent = "Nothing there.";
  } finally {
    if (resolveAc === ac) resolveAc = null;
  }
}

function cancelResolve(): void {
  resolveAc?.abort();
  resolveAc = null;
}

function cancelLoad(): void {
  throttle.finish();
  cancelResolve();
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

  if (devTools) {
    const panel = setupDevPanel((s) => {
      settings = s;
    });
    dom.devBtn.addEventListener("click", panel.toggle);
  } else {
    document.querySelectorAll("[data-dev]").forEach((el) => el.remove());
  }
}

wire();
setDimension(randomDimension());
dom.back.disabled = true;
dom.forward.disabled = true;

if (devTools) (window as unknown as { __mirage: unknown }).__mirage = { session, navigate };
