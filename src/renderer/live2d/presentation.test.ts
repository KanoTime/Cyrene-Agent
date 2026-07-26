import { describe, expect, it } from "vitest";
import { applyCharacterPresentation } from "./presentation";

function surfaces() {
  return {
    canvas: { style: { visibility: "visible" } },
    avatar: { src: "old-character.png", alt: "旧角色", hidden: false },
  };
}

describe("applyCharacterPresentation", () => {
  it("shows only the active character Live2D canvas", () => {
    const elements = surfaces();

    const result = applyCharacterPresentation({
      displayName: "昔涟",
      visual: { kind: "live2d", modelUrl: "local-character://cyrene/live2d/model.json" },
    }, elements);

    expect(result).toEqual({ kind: "live2d", modelUrl: "local-character://cyrene/live2d/model.json" });
    expect(elements.canvas.style.visibility).toBe("visible");
    expect(elements.avatar).toMatchObject({ hidden: true, src: "", alt: "" });
  });

  it("shows the active avatar and hides the old Live2D canvas for a text-only character", () => {
    const elements = surfaces();

    const result = applyCharacterPresentation({
      displayName: "流明",
      visual: { kind: "static", avatarUrl: "local-character://fixture.lumen/avatar" },
    }, elements);

    expect(result).toEqual({ kind: "static" });
    expect(elements.canvas.style.visibility).toBe("hidden");
    expect(elements.avatar).toMatchObject({
      hidden: false,
      src: "local-character://fixture.lumen/avatar",
      alt: "流明",
    });
  });
});
