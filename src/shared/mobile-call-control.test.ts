import { describe, expect, it } from "vitest";
import { parseMobileCallControl } from "./mobile-call-control";

function payload(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

describe("parseMobileCallControl", () => {
  it("accepts the supported conversation and turn commands", () => {
    expect(parseMobileCallControl(payload({ type: "conversation.list" })))
      .toEqual({ type: "conversation.list" });
    expect(parseMobileCallControl(payload({
      type: "conversation.list",
      after: "00000000-0000-4000-8000-000000000001",
    }))).toEqual({
      type: "conversation.list",
      after: "00000000-0000-4000-8000-000000000001",
    });
    expect(parseMobileCallControl(payload({
      type: "conversation.create",
      title: "晚间闲聊",
    }))).toEqual({
      type: "conversation.create",
      title: "晚间闲聊",
    });
    expect(parseMobileCallControl(payload({
      type: "conversation.select",
      conversationId: "00000000-0000-4000-8000-000000000001",
    }))).toEqual({
      type: "conversation.select",
      conversationId: "00000000-0000-4000-8000-000000000001",
    });
    expect(parseMobileCallControl(payload({
      type: "conversation.delete",
      conversationId: "00000000-0000-4000-8000-000000000001",
    }))).toEqual({
      type: "conversation.delete",
      conversationId: "00000000-0000-4000-8000-000000000001",
    });
    expect(parseMobileCallControl(payload({
      type: "turn.mode",
      mode: "manual",
    }))).toEqual({ type: "turn.mode", mode: "manual" });
    expect(parseMobileCallControl(payload({ type: "turn.begin" })))
      .toEqual({ type: "turn.begin" });
    expect(parseMobileCallControl(payload({ type: "turn.commit" })))
      .toEqual({ type: "turn.commit" });
  });

  it("rejects unknown, malformed, oversized, and path-like commands", () => {
    expect(parseMobileCallControl(payload({ type: "unknown" }))).toBeNull();
    expect(parseMobileCallControl(payload({
      type: "conversation.select",
      conversationId: "../../outside",
    }))).toBeNull();
    expect(parseMobileCallControl(payload({
      type: "conversation.delete",
      conversationId: "../../outside",
    }))).toBeNull();
    expect(parseMobileCallControl(payload({
      type: "conversation.create",
      title: "x".repeat(81),
    }))).toBeNull();
    expect(parseMobileCallControl(new Uint8Array(4_097))).toBeNull();
  });
});
