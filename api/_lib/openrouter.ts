// Server-side OpenRouter client. Retries 429/502/503/504 up to MAX_RETRIES
// times (429 honours Retry-After, 5xx backs off linearly), each wait capped
// at MAX_RETRY_MS. Callers never forward UpstreamError text to the browser.

export const MAX_RETRIES = 2;
export const MAX_RETRY_MS = 5000;

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const RETRY_STATUSES = new Set([429, 502, 503, 504]);

export class UpstreamError extends Error {
  constructor(public readonly status: number, detail: string) {
    super(`OpenRouter ${status}: ${detail.slice(0, 500)}`);
    this.name = "UpstreamError";
  }
}

export type ContentPart = { type?: string; text?: string };

export type ChatCompletion = {
  choices?: {
    message?: {
      content?: string | ContentPart[] | null;
      images?: { image_url?: { url?: string } }[];
    };
  }[];
  usage?: { cost?: number };
};

export type PostChatDeps = {
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function retryDelayMs(status: number, attempt: number, retryAfter: string | null): number {
  if (status === 429) {
    const n = Number.parseInt(retryAfter ?? "", 10);
    const sec = Number.isFinite(n) && n > 0 ? n : 5;
    return Math.min(sec * 1000, MAX_RETRY_MS);
  }
  return Math.min(2000 * (attempt + 1), MAX_RETRY_MS);
}

export async function postChat(
  body: Record<string, unknown>,
  deps: PostChatDeps = {}
): Promise<ChatCompletion> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new UpstreamError(500, "OPENROUTER_API_KEY not configured");
  const sleep = deps.sleep ?? defaultSleep;

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://mirage-web.app",
        "X-OpenRouter-Title": "Mirage",
      },
      body: JSON.stringify({ ...body, usage: { include: true } }),
      signal: deps.signal,
    });
    if (res.ok) return (await res.json()) as ChatCompletion;

    const detail = await res.text().catch(() => "");
    if (RETRY_STATUSES.has(res.status) && attempt < MAX_RETRIES) {
      await sleep(retryDelayMs(res.status, attempt, res.headers.get("Retry-After")));
      continue;
    }
    throw new UpstreamError(res.status, detail);
  }
}

export function messageText(c: ChatCompletion): string {
  const content = c.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p.text === "string" ? p.text : "")).join("");
  }
  return "";
}

export function completionCost(c: ChatCompletion): number {
  const cost = c.usage?.cost;
  return typeof cost === "number" && Number.isFinite(cost) ? cost : 0;
}
