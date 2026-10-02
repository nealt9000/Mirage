import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../page";
import { STRICT_SUFFIX } from "./pageGen";
import { DEFAULT_PAGE_MODEL } from "./modelIds";

const IMG = "data:image/png;base64,iVBORw0KGgo=";

const completion = (content: string, image?: string, cost = 0.034) => new Response(JSON.stringify({
  choices: [{ message: { content, images: image ? [{ type: "image_url", image_url: { url: image } }] : [] } }],
  usage: { cost },
}), { status: 200 });

const request = (body: unknown) =>
  new Request("http://localhost/api/page", { method: "POST", body: JSON.stringify(body) });

const sentBody = (fetchMock: ReturnType<typeof vi.fn>, call: number) =>
  JSON.parse(fetchMock.mock.calls[call][1].body);

beforeEach(() => { process.env.OPENROUTER_API_KEY = "test-key"; });
afterEach(() => { vi.unstubAllGlobals(); });

describe("POST /api/page", () => {
  it("returns url, title, image, cost and model", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(completion('{"url":"www.x.com","title":"X"}', IMG)));
    const res = await POST(request({ prompt: "draw" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({ url: "www.x.com", title: "X", image: IMG, costUsd: 0.034, model: DEFAULT_PAGE_MODEL });
    expect(typeof body.ms).toBe("number");
  });

  it("returns null metadata when the line is missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(completion("", IMG)));
    const body = await (await POST(request({ prompt: "draw" }))).json();
    expect(body).toMatchObject({ url: null, title: null, image: IMG });
  });

  it("retries once with the strict suffix when no image comes back", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(completion("I'd rather describe it.", undefined, 0.01))
      .mockResolvedValueOnce(completion('{"url":"a.com","title":"A"}', IMG, 0.03));
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(request({ prompt: "draw" }));
    expect(res.status).toBe(200);
    expect(sentBody(fetchMock, 1).messages[0].content[0].text).toBe("draw" + STRICT_SUFFIX);
    expect(((await res.json()) as any).costUsd).toBeCloseTo(0.04);
  });

  it("fades after two imageless responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(completion("no"))));
    const res = await POST(request({ prompt: "draw" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "faded" });
  });

  it("never leaks upstream detail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response('{"error":{"message":"secret stack trace at redis.js:42"}}', { status: 401 })
    ));
    const res = await POST(request({ prompt: "draw" }));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain("secret");
    expect(text).not.toContain("redis");
  });

  it("rejects a missing prompt", async () => {
    vi.stubGlobal("fetch", vi.fn());
    expect((await POST(request({}))).status).toBe(400);
    expect((await POST(new Request("http://localhost/api/page", { method: "POST", body: "not json" }))).status).toBe(400);
  });

  it("drops a non-image reference and an invalid model id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion("", IMG));
    vi.stubGlobal("fetch", fetchMock);
    await POST(request({ prompt: "draw", referenceImage: "https://evil/x.png", model: "../../etc" }));
    const sent = sentBody(fetchMock, 0);
    expect(sent.model).toBe(DEFAULT_PAGE_MODEL);
    expect(sent.messages[0].content).toHaveLength(1);
  });

  it("forwards a valid model id and reference image", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion("", IMG));
    vi.stubGlobal("fetch", fetchMock);
    await POST(request({ prompt: "draw", referenceImage: IMG, model: "google/gemini-3.1-flash-image" }));
    const sent = sentBody(fetchMock, 0);
    expect(sent.model).toBe("google/gemini-3.1-flash-image");
    expect(sent.messages[0].content[1]).toEqual({ type: "image_url", image_url: { url: IMG } });
  });
});
