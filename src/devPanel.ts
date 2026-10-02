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
