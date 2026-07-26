import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import type { ActiveCharacterContext } from "./character-runtime";
import { createCharacterVisualContext } from "./character-visual";

function activeCharacter(input: Readonly<{
  id: string;
  displayName: string;
  live2d?: { modelPath: string; mappingPath?: string };
}>): ActiveCharacterContext {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "character-visual-"));
  const avatarPath = path.join(root, "avatar.svg");
  const identityPath = path.join(root, "identity.md");
  const soulPath = path.join(root, "soul.md");
  fs.writeFileSync(avatarPath, "<svg />");
  fs.writeFileSync(identityPath, "identity");
  fs.writeFileSync(soulPath, "soul");
  const stateRoot = path.join(root, ".state");
  return {
    id: input.id,
    displayName: input.displayName,
    version: "1.0.0",
    source: "local",
    readOnly: false,
    distributionStatus: "redistributable",
    packageRoot: root,
    content: { identityPath, soulPath, avatarPath },
    stateRoot,
    speechRecognitionHints: { displayName: input.displayName, terms: [input.displayName] },
    state: {
      root: stateRoot,
      chatsRoot: path.join(stateRoot, "chats"),
      channelHistoryRoot: path.join(stateRoot, "chats", "channels", "history"),
      channelLogFile: path.join(stateRoot, "chats", "channels", "log.jsonl"),
      memoryFile: path.join(stateRoot, "memory.json"),
      entityGraphFile: path.join(stateRoot, "entities.json"),
      memoryTraceFile: path.join(stateRoot, "trace.log"),
      ragRoot: path.join(stateRoot, "rag"),
      relationshipFile: path.join(stateRoot, "relationship.json"),
      worldbookStateFile: path.join(stateRoot, "worldbook.json"),
      proactiveStateFile: path.join(stateRoot, "proactive.json"),
      ttsCacheRoot: path.join(stateRoot, "tts"),
    },
    capabilities: {
      worldbook: { status: "unavailable" },
      live2d: input.live2d
        ? { status: "available", modelPath: input.live2d.modelPath }
        : { status: "unavailable" },
      semanticActions: input.live2d?.mappingPath
        ? { status: "available", filePath: input.live2d.mappingPath }
        : { status: "unavailable" },
      voice: { status: "unavailable" },
      stickers: { status: "unavailable" },
      openers: { status: "unavailable" },
    },
  };
}

function live2dFixture(id: string, winkTarget: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "character-live2d-"));
  const modelPath = path.join(root, `${id}.model3.json`);
  const mappingPath = path.join(root, "semantic-actions.json");
  fs.writeFileSync(modelPath, "{}");
  fs.writeFileSync(mappingPath, JSON.stringify({
    schemaVersion: 1,
    actions: { wink: winkTarget },
  }));
  return { modelPath, mappingPath };
}

describe("CharacterVisualContext", () => {
  it("resolves the same Semantic Action to each character's own target", () => {
    const cyrene = createCharacterVisualContext(activeCharacter({
      id: "cyrene",
      displayName: "昔涟",
      live2d: live2dFixture("cyrene", { kind: "motion", group: "动作#6", motionName: "Wink~" }),
    }));
    const prism = createCharacterVisualContext(activeCharacter({
      id: "fixture.prism",
      displayName: "棱镜",
      live2d: live2dFixture("prism", { kind: "expression", name: "blink_left" }),
    }));

    expect(cyrene.presentation).toMatchObject({ kind: "live2d", characterId: "cyrene" });
    expect(prism.presentation).toMatchObject({ kind: "live2d", characterId: "fixture.prism" });
    expect(cyrene.resolveAction("眨眨眼")).toEqual({
      kind: "play",
      actionId: "wink",
      target: { kind: "motion", group: "动作#6", motionName: "Wink~" },
    });
    expect(prism.resolveAction("眨眨眼")).toEqual({
      kind: "play",
      actionId: "wink",
      target: { kind: "expression", name: "blink_left" },
    });
  });

  it("uses the active avatar and returns a diagnostic no-op for a text-only character", () => {
    const visual = createCharacterVisualContext(activeCharacter({
      id: "fixture.lumen",
      displayName: "流明",
    }));

    expect(visual.presentation).toMatchObject({
      kind: "static",
      characterId: "fixture.lumen",
      avatarUrl: "local-character://fixture.lumen/avatar",
    });
    expect(visual.resolveAction("眨眨眼")).toMatchObject({
      kind: "noop",
      actionId: "wink",
      reason: "live2d_unavailable",
    });
  });

  it("never borrows a target when an action is not declared by the active character", () => {
    const visual = createCharacterVisualContext(activeCharacter({
      id: "fixture.prism",
      displayName: "棱镜",
      live2d: live2dFixture("prism", { kind: "expression", name: "blink_left" }),
    }));

    expect(visual.resolveAction("戴墨镜")).toMatchObject({
      kind: "noop",
      actionId: "cool",
      reason: "action_unavailable",
    });
    expect(visual.resolveAction("完全未知动作")).toMatchObject({
      kind: "noop",
      reason: "unknown_action",
    });
  });
});
