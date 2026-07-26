import { describe, expect, it } from "vitest";
import {
  SEMANTIC_ACTIONS,
  findSemanticAction,
  isLive2DTarget,
} from "../shared/semantic-actions";

describe("Semantic Actions catalog", () => {
  it("has stable unique IDs and aliases", () => {
    expect(new Set(SEMANTIC_ACTIONS.map((action) => action.id)).size).toBe(SEMANTIC_ACTIONS.length);
    expect(new Set(SEMANTIC_ACTIONS.map((action) => action.alias)).size).toBe(SEMANTIC_ACTIONS.length);
  });

  it("resolves both a stable ID and its user-facing alias", () => {
    expect(findSemanticAction("wink")?.id).toBe("wink");
    expect(findSemanticAction("眨眨眼")?.id).toBe("wink");
    expect(findSemanticAction("不存在")).toBeUndefined();
  });

  it("accepts only complete motion or expression targets", () => {
    expect(isLive2DTarget({ kind: "motion", group: "main", motionName: "wave" })).toBe(true);
    expect(isLive2DTarget({ kind: "expression", name: "smile" })).toBe(true);
    expect(isLive2DTarget({ kind: "motion", group: "main" })).toBe(false);
    expect(isLive2DTarget({ kind: "script", command: "run" })).toBe(false);
  });
});
