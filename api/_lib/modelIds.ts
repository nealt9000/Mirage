// Default models and the server-side allowlist for client-chosen model ids
// (dev panel). Anything not allowed falls back to the default, so a public
// deployment can't be driven onto arbitrary (expensive) models. Extend the
// list with MIRAGE_ALLOWED_MODELS (comma-separated).
// Pricier alternatives (e.g. google/gemini-3.1-flash-image) must be listed explicitly.

export const DEFAULT_PAGE_MODEL = "google/gemini-3.1-flash-lite-image";
export const DEFAULT_LINK_MODEL = "google/gemini-3-flash-preview";

const BUILT_IN_MODELS = [DEFAULT_PAGE_MODEL, DEFAULT_LINK_MODEL];

const MODEL_ID_RE = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9.:_-]*$/i;

export function isModelId(v: unknown): v is string {
  return typeof v === "string" && v.length <= 100 && MODEL_ID_RE.test(v);
}

function allowedModels(): Set<string> {
  const extra = (process.env.MIRAGE_ALLOWED_MODELS ?? "").split(",").map((s) => s.trim()).filter(isModelId);
  return new Set([...BUILT_IN_MODELS, ...extra]);
}

export function pickModel(v: unknown, fallback: string): string {
  return isModelId(v) && allowedModels().has(v) ? v : fallback;
}
