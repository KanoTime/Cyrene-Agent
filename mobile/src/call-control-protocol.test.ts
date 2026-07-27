import { describe, expect, it } from "vitest";
import {
  encodeMobileCallControl,
  parseMobileCallEvent,
} from "./call-control-protocol";

describe("mobile call control protocol", () => {
  it("encodes explicit conversation and manual-turn commands", () => {
    expect(JSON.parse(new TextDecoder().decode(encodeMobileCallControl({
      type: "conversation.create",
      title: "晚间闲聊",
    })))).toEqual({
      type: "conversation.create",
      title: "晚间闲聊",
    });
    expect(JSON.parse(new TextDecoder().decode(encodeMobileCallControl({
      type: "turn.begin",
    })))).toEqual({ type: "turn.begin" });
  });

  it("parses conversation catalog and selected-history events", () => {
    const catalog = {
      type: "conversation.catalog",
      conversations: [{
        id: "00000000-0000-4000-8000-000000000001",
        title: "晚间闲聊",
        createdAt: 1,
        updatedAt: 2,
        turnCount: 3,
        preview: "明天继续。",
      }],
      mode: "automatic",
      replace: true,
    };
    expect(parseMobileCallEvent(new TextEncoder().encode(JSON.stringify(catalog))))
      .toEqual(catalog);

    const selected = {
      type: "conversation.selected",
      conversation: catalog.conversations[0],
      mode: "manual",
    };
    expect(parseMobileCallEvent(new TextEncoder().encode(JSON.stringify(selected))))
      .toEqual(selected);
  });

  it("rejects malformed events instead of trusting the data channel", () => {
    expect(parseMobileCallEvent(new TextEncoder().encode(JSON.stringify({
      type: "conversation.catalog",
      conversations: [{ id: "../../outside" }],
      mode: "automatic",
    })))).toBeNull();
    expect(parseMobileCallEvent(new Uint8Array(15 * 1024))).toBeNull();
  });

  it("keeps recoverable control errors separate from fatal call errors", () => {
    const event = { type: "control.error", message: "请在角色正在聆听时操作" };
    expect(parseMobileCallEvent(new TextEncoder().encode(JSON.stringify(event))))
      .toEqual(event);
  });
});
