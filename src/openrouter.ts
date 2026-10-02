// Browser-side wrappers for the same-origin api/ functions. Any failure other
// than an abort becomes FadedError; upstream detail never reaches the UI.

import type { LinksResult, PageRequest, PageResult, Point, PointResult } from "./types";

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
  body: { request: PageRequest; model: string },
  signal?: AbortSignal
): Promise<PageResult> {
  return postJson<PageResult>("/api/page", body, signal);
}

export function fetchLinks(image: string, sig: string, model: string, signal?: AbortSignal): Promise<LinksResult> {
  return postJson<LinksResult>("/api/links", { image, sig, model }, signal);
}

export function resolvePoint(image: string, sig: string, point: Point, model: string, signal?: AbortSignal): Promise<PointResult> {
  return postJson<PointResult>("/api/links", { image, sig, point, model }, signal);
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
