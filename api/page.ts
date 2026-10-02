// POST /api/page — { prompt, referenceImage?, model? } → PageResult.
// One retry with STRICT_SUFFIX when the model answers without an image;
// after that, { error: "faded" }. Upstream detail is logged, never returned.

import type { PageResult } from "../src/types";
import { json } from "./_lib/http.js";
import { isImageDataUri, shrinkIfLarge } from "./_lib/image.js";
import { DEFAULT_PAGE_MODEL, pickModel } from "./_lib/modelIds.js";
import { postChat } from "./_lib/openrouter.js";
import { signImage } from "./_lib/sign.js";
import { extractPageParts, MAX_PROMPT_CHARS, pageBody, parseMeta, STRICT_SUFFIX } from "./_lib/pageGen.js";

export async function POST(req: Request): Promise<Response> {
  const t0 = Date.now();
  let input: { prompt?: unknown; referenceImage?: unknown; model?: unknown };
  try {
    input = (await req.json()) as typeof input;
  } catch {
    return json({ error: "bad-request" }, 400);
  }
  if (!input || typeof input.prompt !== "string" || !input.prompt.trim()) {
    return json({ error: "bad-request" }, 400);
  }
  const prompt = input.prompt.slice(0, MAX_PROMPT_CHARS);
  const referenceImage = isImageDataUri(input.referenceImage) ? input.referenceImage : undefined;
  const model = pickModel(input.model, DEFAULT_PAGE_MODEL);

  let costUsd = 0;
  try {
    for (const suffix of ["", STRICT_SUFFIX]) {
      const completion = await postChat(pageBody(model, prompt + suffix, referenceImage), { signal: req.signal });
      const parts = extractPageParts(completion);
      costUsd += parts.costUsd;
      if (!parts.image) continue;
      const image = await shrinkIfLarge(parts.image);
      const result: PageResult = {
        ...parseMeta(parts.text),
        image,
        sig: signImage(image),
        costUsd,
        ms: Date.now() - t0,
        model,
      };
      return json(result);
    }
  } catch (e) {
    console.error("[api/page]", e);
  }
  return json({ error: "faded", costUsd, ms: Date.now() - t0 }, 502);
}
