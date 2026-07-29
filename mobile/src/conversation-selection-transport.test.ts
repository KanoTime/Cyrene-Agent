import { describe, expect, it, vi } from "vitest";
import {
  prepareConversationEntryTransport,
  resolveNewConversationTitle,
} from "./conversation-selection-transport";

describe("conversation entry transport", () => {
  it("starts a new named conversation by default without opening the history picker", () => {
    const setMicrophoneEnabled = vi.fn(async () => undefined);
    const requestConversationCatalog = vi.fn(async () => undefined);
    const createConversation = vi.fn(async () => undefined);

    prepareConversationEntryTransport({
      mode: "new",
      now: new Date("2026-07-29T03:15:00+08:00"),
      setMicrophoneEnabled,
      requestConversationCatalog,
      createConversation,
    });

    expect(setMicrophoneEnabled).toHaveBeenCalledExactlyOnceWith(true);
    expect(createConversation).toHaveBeenCalledExactlyOnceWith(
      "7月29日 03:15 的语音对话",
    );
    expect(requestConversationCatalog).not.toHaveBeenCalled();
  });

  it("opens the history catalog only when the user explicitly chooses to continue", () => {
    const setMicrophoneEnabled = vi.fn(async () => undefined);
    const requestConversationCatalog = vi.fn(async () => undefined);
    const createConversation = vi.fn(async () => undefined);

    prepareConversationEntryTransport({
      mode: "history",
      setMicrophoneEnabled,
      requestConversationCatalog,
      createConversation,
    });

    expect(setMicrophoneEnabled).toHaveBeenCalledExactlyOnceWith(true);
    expect(requestConversationCatalog).toHaveBeenCalledOnce();
    expect(createConversation).not.toHaveBeenCalled();
  });

  it("uses a generated title when an optional custom title is blank", () => {
    expect(resolveNewConversationTitle(
      "   ",
      new Date("2026-07-29T03:15:00+08:00"),
    )).toBe("7月29日 03:15 的语音对话");
    expect(resolveNewConversationTitle(
      "  睡前   闲聊  ",
      new Date("2026-07-29T03:15:00+08:00"),
    )).toBe("睡前 闲聊");
  });
});
