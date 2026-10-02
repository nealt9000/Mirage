// GET /api/models — thin proxy to the OpenRouter model catalog (dev panel
// pickers). 404 unless dev tools are enabled.

import { devToolsEnabled } from "./_lib/devTools.js";

export async function GET(): Promise<Response> {
  if (!devToolsEnabled()) return new Response("Not found", { status: 404 });
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return new Response("OPENROUTER_API_KEY not configured", { status: 500 });
  const upstream = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, max-age=3600" },
  });
}
