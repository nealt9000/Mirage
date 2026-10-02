import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../models";

afterEach(() => {
  delete process.env.VERCEL_ENV;
  vi.unstubAllGlobals();
});

describe("GET /api/models", () => {
  it("is 404 in production", async () => {
    process.env.VERCEL_ENV = "production";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await GET()).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("proxies the catalog locally, cacheable for an hour", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"data":[]}', { status: 200 })));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=3600");
  });
});
