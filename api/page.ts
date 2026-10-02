// POST /api/page — { request: PageRequest, model? } → PageResult.
// The prompt is built here from the structured request, so the endpoint
// can't be used as a general image generator. Reference images must carry
// the signature this endpoint issued with them.
// One retry with STRICT_SUFFIX when the model answers without an image;
// after that, { error: "faded" }. Upstream detail is logged, never returned.

import type { PageResult } from "../src/types";
import { json } from "./_lib/http.js";
import { shrinkIfLarge } from "./_lib/image.js";
import { DEFAULT_PAGE_MODEL, pickModel } from "./_lib/modelIds.js";
import { postChat } from "./_lib/openrouter.js";
import { buildPagePrompt } from "./_lib/pageContract.js";
import { extractPageParts, pageBody, parseMeta, STRICT_SUFFIX } from "./_lib/pageGen.js";
import { parsePageRequest } from "./_lib/pageRequest.js";
import { signImage, verifyImage } from "./_lib/sign.js";

export async function POST(req: Request): Promise<Response> {
  const t0 = Date.now();
  let input: { request?: unknown; model?: unknown } | null;
  try {
    input = (await req.json()) as typeof input;
  } catch {
    return json({ error: "bad-request" }, 400);
  }
  if (!input || typeof input !== "object") return json({ error: "bad-request" }, 400);
  const pageReq = parsePageRequest(input.request);
  if (!pageReq) return json({ error: "bad-request" }, 400);
  if (
    (pageReq.mode === "internal" || pageReq.mode === "search") &&
    !verifyImage(pageReq.referenceImage, pageReq.referenceSig)
  ) {
    return json({ error: "forbidden" }, 403);
  }
  const { text: prompt, referenceImage } = buildPagePrompt(pageReq);
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
