import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { VoiceConversationStore } from "./voice-conversation-store";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cyrene-voice-conversations-"));
}

describe("VoiceConversationStore", () => {
  it("persists named conversations and lists the most recently used first", () => {
    let now = 1_000;
    let sequence = 0;
    const root = tempRoot();
    const store = new VoiceConversationStore(root, {
      now: () => now,
      id: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    });

    const first = store.create("晚间闲聊");
    now = 2_000;
    const second = store.create("旅行计划");
    now = 3_000;
    store.appendTurn(first.id, {
      userText: "我们继续聊昨天的话题",
      assistantText: "好呀，我还记得。",
    });

    expect(store.list()).toEqual([
      expect.objectContaining({
        id: first.id,
        title: "晚间闲聊",
        turnCount: 1,
        preview: "好呀，我还记得。",
      }),
      expect.objectContaining({
        id: second.id,
        title: "旅行计划",
        turnCount: 0,
      }),
    ]);

    const restored = new VoiceConversationStore(root);
    expect(restored.get(first.id)?.turns).toEqual([
      expect.objectContaining({
        userText: "我们继续聊昨天的话题",
        assistantText: "好呀，我还记得。",
      }),
    ]);
  });

  it("renames a conversation and keeps only the requested recent turns for model context", () => {
    let now = 10;
    const store = new VoiceConversationStore(tempRoot(), { now: () => now++ });
    const conversation = store.create("临时名字");
    for (let index = 1; index <= 30; index += 1) {
      store.appendTurn(conversation.id, {
        userText: `问题 ${index}`,
        assistantText: `回答 ${index}`,
      });
    }

    expect(store.rename(conversation.id, "昔涟的长期对话")?.title)
      .toBe("昔涟的长期对话");
    expect(store.getRecentTurns(conversation.id, 24)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userText: "问题 7", assistantText: "回答 7" }),
        expect.objectContaining({ userText: "问题 30", assistantText: "回答 30" }),
      ]),
    );
    expect(store.getRecentTurns(conversation.id, 24)).toHaveLength(24);
  });

  it("rejects empty names and invalid conversation identifiers", () => {
    const store = new VoiceConversationStore(tempRoot());

    expect(() => store.create("   ")).toThrow("VOICE_CONVERSATION_TITLE_REQUIRED");
    expect(() => store.create("a".repeat(81))).toThrow("VOICE_CONVERSATION_TITLE_TOO_LONG");
    expect(store.get("../../outside")).toBeNull();
    expect(store.rename("../../outside", "无效")).toBeNull();
  });
});
