import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../page";
import { DEFAULT_PAGE_MODEL } from "./modelIds";
import { CONTRACT } from "./pageContract";
import { STRICT_SUFFIX } from "./pageGen";
import { signImage, verifyImage } from "./sign";

const IMG = "data:image/png;base64,iVBORw0KGgo=";

const completion = (content: string, image?: string, cost = 0.034) => new Response(JSON.stringify({
  choices: [{ message: { content, images: image ? [{ type: "image_url", image_url: { url: image } }] : [] } }],
  usage: { cost },
}), { status: 200 });

const request = (body: unknown) =>
  new Request("http://localhost/api/page", { method: "POST", headers: { origin: "http://localhost" }, body: JSON.stringify(body) });

const typed = (input = "moon.com") => ({ request: { mode: "typed", input } });
const internal = (referenceImage: string, referenceSig: string) => ({
  request: { mode: "internal", site: { url: "a.com", title: "A" }, label: "Shop", dest: "shop", referenceImage, referenceSig },
});

const sentBody = (fetchMock: ReturnType<typeof vi.fn>, call: number) =>
  JSON.parse(fetchMock.mock.calls[call][1].body);
const sentText = (fetchMock: ReturnType<typeof vi.fn>, call: number) =>
  sentBody(fetchMock, call).messages[0].content[0].text as string;

beforeEach(() => { process.env.OPENROUTER_API_KEY = "test-key"; });
afterEach(() => { vi.unstubAllGlobals(); });

describe("POST /api/page", () => {
  it("returns url, title, signed image, cost and model", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(completion('{"url":"www.x.com","title":"X"}', IMG)));
    const res = await POST(request(typed()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({ url: "www.x.com", title: "X", image: IMG, costUsd: 0.034, model: DEFAULT_PAGE_MODEL });
    expect(verifyImage(body.image, body.sig)).toBe(true);
    expect(typeof body.ms).toBe("number");
  });

  it("builds the prompt on the server from the request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion("", IMG));
    vi.stubGlobal("fetch", fetchMock);
    await POST(request(typed("moon.com")));
    expect(sentText(fetchMock, 0)).toContain(CONTRACT);
    expect(sentText(fetchMock, 0)).toContain('"moon.com"');
  });

  it("ignores a raw prompt field", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion("", IMG));
    vi.stubGlobal("fetch", fetchMock);
    await POST(request({ ...typed("x"), prompt: "draw a cat wearing a hat" }));
    expect(sentText(fetchMock, 0)).not.toContain("cat wearing a hat");
  });

  it("returns null metadata when the line is missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(completion("", IMG)));
    const body = await (await POST(request(typed()))).json();
    expect(body).toMatchObject({ url: null, title: null, image: IMG });
  });

  it("retries once with the strict suffix when no image comes back", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(completion("I'd rather describe it.", undefined, 0.01))
      .mockResolvedValueOnce(completion('{"url":"a.com","title":"A"}', IMG, 0.03));
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(request(typed()));
    expect(res.status).toBe(200);
    expect(sentText(fetchMock, 1)).toBe(sentText(fetchMock, 0) + STRICT_SUFFIX);
    expect(((await res.json()) as any).costUsd).toBeCloseTo(0.04);
  });

  it("fades after two imageless responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(completion("no"))));
    const res = await POST(request(typed()));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "faded" });
  });

  it("never leaks upstream detail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response('{"error":{"message":"secret stack trace at redis.js:42"}}', { status: 401 })
    ));
    const res = await POST(request(typed()));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain("secret");
    expect(text).not.toContain("redis");
  });

  it("rejects a missing or malformed request", async () => {
    vi.stubGlobal("fetch", vi.fn());
    expect((await POST(request({}))).status).toBe(400);
    expect((await POST(request(null))).status).toBe(400);
    expect((await POST(request({ prompt: "draw" }))).status).toBe(400);
    expect((await POST(new Request("http://localhost/api/page", { method: "POST", headers: { origin: "http://localhost" }, body: "not json" }))).status).toBe(400);
  });

  it("rejects requests from other origins", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const url = "http://localhost/api/page";
    const foreign = new Request(url, { method: "POST", headers: { origin: "https://evil.example" }, body: "{}" });
    const none = new Request(url, { method: "POST", body: "{}" });
    expect((await POST(foreign)).status).toBe(403);
    expect((await POST(none)).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards a signed reference image", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion("", IMG));
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(request(internal(IMG, signImage(IMG))));
    expect(res.status).toBe(200);
    expect(sentBody(fetchMock, 0).messages[0].content[1]).toEqual({ type: "image_url", image_url: { url: IMG } });
  });

  it("accepts a reference image signed by an earlier response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(completion("", IMG))));
    const first = (await (await POST(request(typed()))).json()) as any;
    const res = await POST(request(internal(first.image, first.sig)));
    expect(res.status).toBe(200);
  });

  it("rejects an unsigned or forged reference image", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await POST(request(internal(IMG, "forged")))).status).toBe(403);
    expect((await POST(request(internal(IMG, "")))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the default model for an invalid model id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion("", IMG));
    vi.stubGlobal("fetch", fetchMock);
    await POST(request({ ...typed(), model: "../../etc" }));
    expect(sentBody(fetchMock, 0).model).toBe(DEFAULT_PAGE_MODEL);
  });

  it("forwards a model id allowed by MIRAGE_ALLOWED_MODELS", async () => {
    process.env.MIRAGE_ALLOWED_MODELS = "google/gemini-3.1-flash-image";
    const fetchMock = vi.fn().mockResolvedValue(completion("", IMG));
    vi.stubGlobal("fetch", fetchMock);
    await POST(request({ ...typed(), model: "google/gemini-3.1-flash-image" }));
    expect(sentBody(fetchMock, 0).model).toBe("google/gemini-3.1-flash-image");
    delete process.env.MIRAGE_ALLOWED_MODELS;
  });
});
