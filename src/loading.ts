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
