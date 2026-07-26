import { describe, expect, it } from "vitest";
import { buildActiveCharacterUiText } from "./active-character";

describe("active character UI identity", () => {
  it("uses the character name for character-facing copy and keeps the product brand separate", () => {
    const text = buildActiveCharacterUiText({
      id: "fixture.lumen",
      displayName: "流明",
      avatarUrl: "local-character://fixture.lumen/avatar",
      visual: {
        kind: "static",
        characterId: "fixture.lumen",
        avatarUrl: "local-character://fixture.lumen/avatar",
      },
    }, "chat");

    expect(text.windowTitle).toBe("流明 · 聊天");
    expect(text.emptyMessage).toBe("流明期待与你聊天哦 ✨");
    expect(text.thinkingMessage).toBe("流明思考中...");
    expect(text.productVersionLabel("0.1.1")).toBe("Cyrene Agent v0.1.1");
  });
});
