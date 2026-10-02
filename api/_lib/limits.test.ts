import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_INPUT_CHARS } from "../../src/session";
import { MAX_USER_TEXT } from "./pageContract";

describe("input limits", () => {
  it("the browser caps typing at the server's limit", () => {
    expect(MAX_INPUT_CHARS).toBe(MAX_USER_TEXT);
  });
  it("the address bar carries the cap", () => {
    expect(readFileSync("index.html", "utf8")).toMatch(new RegExp(`id="fd-url"[^>]*maxlength="${MAX_INPUT_CHARS}"`));
  });
});
