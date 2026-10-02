// Request body and response parsing for the page image model.

import { completionCost, messageText, type ChatCompletion } from "./openrouter.js";

export const STRICT_SUFFIX = "\n\nRespond with the metadata line and an image only.";
export const MAX_PROMPT_CHARS = 4000;

export function pageBody(model: string, prompt: string, referenceImage?: string): Record<string, unknown> {
  const content: unknown[] = [{ type: "text", text: prompt }];
  if (referenceImage) content.push({ type: "image_url", image_url: { url: referenceImage } });
  return {
    model,
    modalities: ["image", "text"],
    image_config: { aspect_ratio: "4:3" },
    messages: [{ role: "user", content }],
  };
}

/**
 * First `{...}` object in the text → url/title. If it isn't valid JSON (the
 * model sometimes drops a closing quote), each field is read on its own.
 * Anything unusable → null.
 */
export function parseMeta(text: string): { url: string | null; title: string | null } {
  const match = text.match(/\{[^{}]*\}/);
  if (match) {
    try {
      const obj = JSON.parse(match[0]) as Record<string, unknown>;
      return { url: cleanString(obj.url), title: cleanString(obj.title) };
    } catch {
      // fall through to per-field recovery
    }
  }
  return { url: looseField(text, "url"), title: looseField(text, "title") };
}

function looseField(text: string, name: string): string | null {
  const m = text.match(new RegExp(`"${name}"\\s*:\\s*"([^"}\\n]*)`));
  return m ? cleanString(m[1]) : null;
}

function cleanString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, 200);
  return s || null;
}

export function extractPageParts(c: ChatCompletion): { text: string; image: string | null; costUsd: number } {
  const images = c.choices?.[0]?.message?.images ?? [];
  const image = images
    .map((i) => i.image_url?.url)
    .find((u): u is string => typeof u === "string" && u.startsWith("data:image/")) ?? null;
  return { text: messageText(c), image, costUsd: completionCost(c) };
}
