// POST /api/links
//   { image, sig, model? }         → full scan:     LinksResult
//   { image, sig, point, model? }  → point resolve: PointResult (crop around the click)
// `sig` is the signature /api/page issued with the image; unsigned → 403.

import type { LinksResult, PointResult } from "../src/types";
import { cropBoxToFull, pointInCrop } from "./_lib/crop.js";
import { json } from "./_lib/http.js";
import { cropAround, isImageDataUri } from "./_lib/image.js";
import { parseLinks, parsePointLink, pointPrompt, SCAN_PROMPT, toPoint, visionBody } from "./_lib/links.js";
import { DEFAULT_LINK_MODEL, pickModel } from "./_lib/modelIds.js";
import { completionCost, messageText, postChat } from "./_lib/openrouter.js";
import { isAllowedOrigin } from "./_lib/origin.js";
import { verifyImage } from "./_lib/sign.js";

export async function POST(req: Request): Promise<Response> {
  const t0 = Date.now();
  if (!isAllowedOrigin(req)) return json({ error: "forbidden" }, 403);
  let input: { image?: unknown; sig?: unknown; point?: unknown; model?: unknown };
  try {
    input = (await req.json()) as typeof input;
  } catch {
    return json({ error: "bad-request" }, 400);
  }
  if (!input || !isImageDataUri(input.image)) return json({ error: "bad-request" }, 400);
  if (!verifyImage(input.image, input.sig)) return json({ error: "forbidden" }, 403);
  const image = input.image;
  const model = pickModel(input.model, DEFAULT_LINK_MODEL);
  const point = input.point === undefined ? undefined : toPoint(input.point);
  if (point === null) return json({ error: "bad-request" }, 400);

  try {
    if (point) {
      const { crop, rect, width, height } = await cropAround(image, point);
      const local = pointInCrop(point, rect, width, height);
      const completion = await postChat(visionBody(model, pointPrompt(local), crop), { signal: req.signal });
      const raw = parsePointLink(messageText(completion));
      const result: PointResult = {
        link: raw ? { ...raw, box: cropBoxToFull(raw.box, rect, width, height) } : null,
        costUsd: completionCost(completion),
        ms: Date.now() - t0,
        model,
      };
      return json(result);
    }
    const completion = await postChat(visionBody(model, SCAN_PROMPT, image), { signal: req.signal });
    const result: LinksResult = {
      links: parseLinks(messageText(completion)),
      costUsd: completionCost(completion),
      ms: Date.now() - t0,
      model,
    };
    return json(result);
  } catch (e) {
    console.error("[api/links]", e);
    return json({ error: "links-unavailable" }, 502);
  }
}
