import { describe, expect, it, vi } from "vitest";
vi.mock("../character/active-character", () => ({ getActiveCharacterText: () => ({ id: "fixture", displayName: "Fixture", identity: "ACTIVE_IDENTITY", soul: "ACTIVE_SOUL", canonQuotes: "ACTIVE_QUOTES", examples: "ACTIVE_EXAMPLES", defaultStyle: "ACTIVE_STYLE" }) }));
import { buildModePrompt } from "./mode-prompt-profile";
const load = (name: string) => `[${name}]`;
describe("buildModePrompt with the active character", () => {
  it.each(["chat", "work", "learn", "code"] as const)("keeps %s mode policy separate from character content", mode => {
    const prompt = buildModePrompt(mode, load);
    expect(prompt).toContain(`[${mode}_system.md]`);
    expect(prompt).toContain("[application_policy.md]");
    expect(prompt).toContain("ACTIVE_IDENTITY");
    for (const other of ["chat", "work", "learn", "code"]) if (other !== mode) expect(prompt).not.toContain(`[${other}_system.md]`);
    expect(prompt).not.toContain(`[${mode}_identity.md]`);
    if (mode === "chat") expect(prompt).toContain("ACTIVE_SOUL");
    else expect(prompt).not.toContain("ACTIVE_SOUL");
  });
  it("only injects the Golden Descendant roster into task-capable modes", () => {
    expect(buildModePrompt("work", load)).toContain("可委托的黄金裔");
    expect(buildModePrompt("code", load)).toContain("可委托的黄金裔");
    expect(buildModePrompt("chat", load)).not.toContain("可委托的黄金裔");
    expect(buildModePrompt("learn", load)).not.toContain("可委托的黄金裔");
  });
});
