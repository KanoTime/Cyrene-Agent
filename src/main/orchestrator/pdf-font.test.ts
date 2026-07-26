import { describe, expect, it } from "vitest";
import { containsCjkText, getCjkFontCandidates, resolveCjkFontPath } from "./pdf-font";

describe("PDF CJK font resolution", () => {
  it("prefers the explicit override", () => {
    const candidates = getCjkFontCandidates("darwin", "/tmp/custom-cjk.ttf");
    expect(candidates[0]).toBe("/tmp/custom-cjk.ttf");
  });

  it("includes macOS Chinese-capable system fonts", () => {
    expect(getCjkFontCandidates("darwin", "")).toContain(
      "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    );
  });

  it("returns the first existing candidate", () => {
    const result = resolveCjkFontPath("darwin", (fontPath) => fontPath.endsWith("Arial Unicode.ttf"), "");
    expect(result).toBe("/System/Library/Fonts/Supplemental/Arial Unicode.ttf");
  });

  it("detects Chinese text", () => {
    expect(containsCjkText("Cyrene 中文 PDF")).toBe(true);
    expect(containsCjkText("ASCII only")).toBe(false);
  });
});
