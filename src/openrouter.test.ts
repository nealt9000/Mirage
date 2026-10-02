import { afterEach, describe, expect, it, vi } from "vitest";
import { FadedError, fetchLinks, fetchPage, isAbortError, listModels, resolvePoint } from "./openrouter";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
afterEach(() => { vi.unstubAllGlobals(); });

describe("fetchPage", () => {
  it("POSTs JSON to /api/page and returns the result", async () => {
    const result = { url: "a.com", title: "A", image: "data:image/png;base64,AA", costUsd: 0.03, ms: 5000, model: "m" };
    const fetchMock = vi.fn().mockResolvedValue(ok(result));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchPage({ prompt: "p", model: "m" })).resolves.toEqual(result);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/page");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ prompt: "p", model: "m" });
  });

  it("turns a non-OK response into FadedError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error":"faded"}', { status: 502 })));
    await expect(fetchPage({ prompt: "p", model: "m" })).rejects.toBeInstanceOf(FadedError);
  });

  it("turns a network failure into FadedError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(fetchPage({ prompt: "p", model: "m" })).rejects.toBeInstanceOf(FadedError);
  });

  it("propagates AbortError (navigating away is not a fade)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError")));
    const err = await fetchPage({ prompt: "p", model: "m" }).catch((e) => e);
    expect(err).not.toBeInstanceOf(FadedError);
    expect(isAbortError(err)).toBe(true);
  });
});

describe("fetchLinks / resolvePoint", () => {
  it("send image (and point) to /api/links", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(ok({ links: [], link: null, costUsd: 0, ms: 1, model: "m" })));
    vi.stubGlobal("fetch", fetchMock);
    await fetchLinks("data:image/png;base64,AA", "m");
    await resolvePoint("data:image/png;base64,AA", { x: 1, y: 2 }, "m");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/links");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ image: "data:image/png;base64,AA", model: "m" });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ image: "data:image/png;base64,AA", point: { x: 1, y: 2 }, model: "m" });
  });
});

describe("listModels", () => {
  it("maps modalities", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ data: [
      { id: "g/img", architecture: { input_modalities: ["text", "image"], output_modalities: ["image", "text"] } },
      { id: "x/bare" },
    ] })));
    expect(await listModels()).toEqual([
      { id: "g/img", inputModalities: ["text", "image"], outputModalities: ["image", "text"] },
      { id: "x/bare", inputModalities: [], outputModalities: [] },
    ]);
  });
  it("returns [] on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    expect(await listModels()).toEqual([]);
  });
});
