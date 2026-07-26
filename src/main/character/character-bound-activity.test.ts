import { describe, expect, it } from "vitest";
import {
  getCharacterBoundActivitySnapshot,
  trackCharacterBoundActivity,
} from "./character-bound-activity";

describe("character-bound activity tracking", () => {
  it("keeps an activity busy until every overlapping operation has settled", async () => {
    let finishFirst!: () => void;
    let finishSecond!: () => void;
    const first = trackCharacterBoundActivity("tts", () => new Promise<void>((resolve) => {
      finishFirst = resolve;
    }));
    const second = trackCharacterBoundActivity("tts", () => new Promise<void>((resolve) => {
      finishSecond = resolve;
    }));

    expect(getCharacterBoundActivitySnapshot().tts).toBe(true);
    finishFirst();
    await first;
    expect(getCharacterBoundActivitySnapshot().tts).toBe(true);
    finishSecond();
    await second;
    expect(getCharacterBoundActivitySnapshot().tts).toBe(false);
  });

  it("clears busy state when an operation fails", async () => {
    await expect(trackCharacterBoundActivity("state-write", async () => {
      throw new Error("write failed");
    })).rejects.toThrow("write failed");

    expect(getCharacterBoundActivitySnapshot().stateWrite).toBe(false);
  });
});
