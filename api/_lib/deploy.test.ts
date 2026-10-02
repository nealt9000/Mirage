import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Vercel compiles each api/*.ts file on its own (no bundling) and package.json
// is "type": "module", so Node's ESM resolver needs explicit extensions on
// relative value imports or every route fails with ERR_MODULE_NOT_FOUND.
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
  });
}

describe("api deploy shape", () => {
  it("uses .js extensions on relative value imports", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles("api")) {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const m = line.match(/^import (?!type\b).*from "(\.{1,2}\/[^"]+)";/);
        if (m && !m[1].endsWith(".js")) offenders.push(`${file}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("gives the model-calling functions room beyond the legacy 10 s limit", () => {
    const cfg = JSON.parse(readFileSync("vercel.json", "utf8"));
    expect(cfg.functions?.["api/page.ts"]?.maxDuration).toBeGreaterThanOrEqual(60);
    expect(cfg.functions?.["api/links.ts"]?.maxDuration).toBeGreaterThanOrEqual(30);
  });
});
