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
