import { describe, expect, it } from "vitest";
import { TUNING_LINES, tuningLine, usesHaze } from "./loading";

describe("tuningLine", () => {
  it("rotates through the lines", () => {
    expect(tuningLine(0, 4817)).toBe("Receiving signal from a neighbouring universe…");
    expect(tuningLine(TUNING_LINES.length, 4817)).toBe(tuningLine(0, 4817));
  });
  it("formats the dimension number", () => {
    expect(tuningLine(1, 4817)).toBe("Tuned to dimension #4,817");
  });
});

describe("usesHaze", () => {
  it("hazes same-site navigation over an existing page", () => {
    expect(usesHaze("internal", true)).toBe(true);
    expect(usesHaze("search", true)).toBe(true);
  });
  it("tunes for new universes or when there is no page yet", () => {
    expect(usesHaze("typed", true)).toBe(false);
    expect(usesHaze("external", true)).toBe(false);
    expect(usesHaze("internal", false)).toBe(false);
  });
});
