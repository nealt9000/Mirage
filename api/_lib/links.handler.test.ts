import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../links";
import { DEFAULT_LINK_MODEL } from "./modelIds";

const reply = (content: string, cost = 0.004) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { cost } }), { status: 200 });

const request = (body: unknown) =>
  new Request("http://localhost/api/links", { method: "POST", body: JSON.stringify(body) });

let IMG = "";
beforeEach(async () => {
  process.env.OPENROUTER_API_KEY = "test-key";
  const png = await sharp({ create: { width: 1000, height: 1000, channels: 3, background: "#fff" } }).png().toBuffer();
  IMG = `data:image/png;base64,${png.toString("base64")}`;
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("POST /api/links", () => {
  it("scan: returns parsed links with cost and model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply('```json\n[{"label":"Shop","kind":"link","dest":"shop","external":false,"box_2d":[1,2,3,4]}]\n```'));
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(request({ image: IMG }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({ links: [{ label: "Shop", box: [1, 2, 3, 4] }], costUsd: 0.004, model: DEFAULT_LINK_MODEL });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.temperature).toBe(0);
    expect(sent.messages[0].content[1].image_url.url).toBe(IMG);
  });

  it("point: sends the crop with the in-crop point and maps the box back", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply('{"label":"Buy","kind":"button","dest":"cart","external":false,"box_2d":[0,0,1000,1000]}'));
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(request({ image: IMG, point: { x: 500, y: 500 } }));
    const body = (await res.json()) as any;
    expect(body.link).toMatchObject({ label: "Buy", box: [400, 350, 600, 650] });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.messages[0].content[0].text).toContain("(y=500, x=500)");
    expect(sent.messages[0].content[1].image_url.url).not.toBe(IMG);
  });

  it("point: returns link null when nothing is clickable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply("null")));
    const body = (await (await POST(request({ image: IMG, point: { x: 10, y: 10 } }))).json()) as any;
    expect(body.link).toBeNull();
  });

  it("rejects a missing image or a bad point", async () => {
    vi.stubGlobal("fetch", vi.fn());
    expect((await POST(request({ image: "https://x/y.png" }))).status).toBe(400);
    expect((await POST(request({ image: IMG, point: { x: "a" } }))).status).toBe(400);
  });

  it("hides upstream failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("secret", { status: 401 })));
    const res = await POST(request({ image: IMG }));
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("secret");
  });
});
