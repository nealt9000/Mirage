import { describe, expect, it } from "vitest";
import { devToolsEnabled } from "./devTools";

describe("devToolsEnabled", () => {
  it("is on locally and under vercel dev", () => {
    expect(devToolsEnabled({})).toBe(true);
    expect(devToolsEnabled({ VERCEL_ENV: "development" })).toBe(true);
  });
  it("is off on preview and production deployments", () => {
    expect(devToolsEnabled({ VERCEL_ENV: "preview" })).toBe(false);
    expect(devToolsEnabled({ VERCEL_ENV: "production" })).toBe(false);
  });
  it("can be forced on with VITE_MIRAGE_DEV_TOOLS=1", () => {
    expect(devToolsEnabled({ VERCEL_ENV: "production", VITE_MIRAGE_DEV_TOOLS: "1" })).toBe(true);
  });
});
