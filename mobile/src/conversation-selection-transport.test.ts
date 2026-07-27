import { describe, expect, it, vi } from "vitest";
import { prepareConversationSelectionTransport } from "./conversation-selection-transport";

describe("conversation selection transport", () => {
  it("keeps the encrypted microphone publication enabled while requesting the catalog", () => {
    const setMicrophoneEnabled = vi.fn(async () => undefined);
    const requestConversationCatalog = vi.fn(async () => undefined);

    prepareConversationSelectionTransport({
      setMicrophoneEnabled,
      requestConversationCatalog,
    });

    expect(setMicrophoneEnabled).toHaveBeenCalledExactlyOnceWith(true);
    expect(requestConversationCatalog).toHaveBeenCalledOnce();
  });
});
