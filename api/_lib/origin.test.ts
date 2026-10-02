import { describe, expect, it } from "vitest";
import { isAllowedOrigin } from "./origin";

const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { method: "POST", headers });

describe("isAllowedOrigin", () => {
  it("accepts a same-origin request", () => {
    expect(isAllowedOrigin(req("https://mirage.app/api/page", { origin: "https://mirage.app" }), {})).toBe(true);
  });
  it("accepts an origin matching x-forwarded-host", () => {
    expect(isAllowedOrigin(req("http://internal/api/page", { origin: "https://mirage.app", "x-forwarded-host": "mirage.app" }), {})).toBe(true);
  });
  it("rejects a missing, foreign or garbage origin", () => {
    expect(isAllowedOrigin(req("https://mirage.app/api/page"), {})).toBe(false);
    expect(isAllowedOrigin(req("https://mirage.app/api/page", { origin: "https://evil.example" }), {})).toBe(false);
    expect(isAllowedOrigin(req("https://mirage.app/api/page", { origin: "null" }), {})).toBe(false);
  });
  it("accepts origins listed in MIRAGE_ALLOWED_ORIGINS", () => {
    const env = { MIRAGE_ALLOWED_ORIGINS: "https://a.com, https://b.com" };
    expect(isAllowedOrigin(req("https://mirage.app/api/page", { origin: "https://b.com" }), env)).toBe(true);
  });
});
