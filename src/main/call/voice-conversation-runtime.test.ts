import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { VoiceConversationRuntime } from "./voice-conversation-runtime";
import { VoiceConversationStore } from "./voice-conversation-store";

describe("VoiceConversationRuntime", () => {
  it("selects a persisted conversation, restores context, and appends the next turn", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cyrene-voice-runtime-"));
    const store = new VoiceConversationStore(root);
    const first = store.create("长期对话");
    store.appendTurn(first.id, { userText: "昨天聊了什么", assistantText: "聊了旅行。" });
    const onSelected = vi.fn();
    const runtime = new VoiceConversationRuntime(store, { onSelected });

    expect(runtime.current()).toBeNull();
    expect(runtime.select(first.id)?.id).toBe(first.id);
    expect(onSelected).toHaveBeenCalledWith([
      expect.objectContaining({ userText: "昨天聊了什么", assistantText: "聊了旅行。" }),
    ]);

    expect(runtime.appendTurn("今天继续吧", "好呀。")?.turns).toHaveLength(2);
    expect(new VoiceConversationStore(root).get(first.id)?.turns.at(-1))
      .toMatchObject({ userText: "今天继续吧", assistantText: "好呀。" });
  });

  it("selects a newly created named conversation immediately", () => {
    const store = new VoiceConversationStore(
      fs.mkdtempSync(path.join(os.tmpdir(), "cyrene-voice-runtime-")),
    );
    const runtime = new VoiceConversationRuntime(store);

    const created = runtime.create("新的早晨");

    expect(runtime.current()?.id).toBe(created?.id);
    expect(runtime.list()).toContainEqual(expect.objectContaining({
      title: "新的早晨",
      turnCount: 0,
    }));
  });
});
