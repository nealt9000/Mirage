import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  completionCost, MAX_RETRY_MS, messageText, postChat, retryDelayMs, UpstreamError,
} from "./openrouter";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const fail = (status: number) => new Response("upstream sad", { status });
const noSleep = () => vi.fn().mockResolvedValue(undefined);

beforeEach(() => { process.env.OPENROUTER_API_KEY = "test-key"; });
afterEach(() => { vi.unstubAllGlobals(); });

describe("retryDelayMs", () => {
  it("honours Retry-After on 429, capped", () => {
    expect(retryDelayMs(429, 0, "2")).toBe(2000);
    expect(retryDelayMs(429, 0, "60")).toBe(MAX_RETRY_MS);
    expect(retryDelayMs(429, 0, null)).toBe(5000);
  });
  it("uses linear backoff for 5xx, capped", () => {
    expect(retryDelayMs(502, 0, null)).toBe(2000);
    expect(retryDelayMs(503, 1, null)).toBe(4000);
    expect(retryDelayMs(504, 5, null)).toBe(MAX_RETRY_MS);
  });
});

describe("postChat", () => {
  it("retries a 502 and returns the next completion", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fail(502))
      .mockResolvedValueOnce(ok({ choices: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const sleep = noSleep();
    await expect(postChat({ model: "m" }, { sleep })).resolves.toEqual({ choices: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("gives up after MAX_RETRIES retries", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(fail(503)));
    vi.stubGlobal("fetch", fetchMock);
    await expect(postChat({ model: "m" }, { sleep: noSleep() })).rejects.toBeInstanceOf(UpstreamError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry other errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fail(400));
    vi.stubGlobal("fetch", fetchMock);
    await expect(postChat({ model: "m" }, { sleep: noSleep() })).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends the bearer key and asks for usage accounting", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({}));
    vi.stubGlobal("fetch", fetchMock);
    await postChat({ model: "m" });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer test-key");
    expect(JSON.parse(init.body)).toMatchObject({ model: "m", usage: { include: true } });
  });

  it("throws without an API key", async () => {
    delete process.env.OPENROUTER_API_KEY;
    vi.stubGlobal("fetch", vi.fn());
    await expect(postChat({ model: "m" })).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe("messageText / completionCost", () => {
  it("reads string content", () => {
    expect(messageText({ choices: [{ message: { content: "hi" } }] })).toBe("hi");
  });
  it("joins array content parts", () => {
    expect(messageText({ choices: [{ message: { content: [{ type: "text", text: "a" }, { type: "image" }, { text: "b" }] } }] })).toBe("ab");
  });
  it("returns empty text for missing content", () => {
    expect(messageText({})).toBe("");
  });
  it("reads cost, defaulting to 0", () => {
    expect(completionCost({ usage: { cost: 0.034 } })).toBe(0.034);
    expect(completionCost({})).toBe(0);
  });
});
