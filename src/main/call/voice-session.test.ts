import { describe, expect, it, vi } from "vitest";
import type { AsrSession } from "../asr/types";
import { VoiceSession, type VoiceSessionEvent } from "./voice-session";

function createAsrSessionHarness() {
  let resolveFinish: (text: string) => void = () => {};
  const session: AsrSession = {
    start: vi.fn(async () => {}),
    sendAudio: vi.fn(),
    finish: vi.fn(() => new Promise<string>((resolve) => { resolveFinish = resolve; })),
    stop: vi.fn(),
    dispose: vi.fn(),
  };

  return { session, resolveFinish: (text: string) => resolveFinish(text) };
}

describe("VoiceSession", () => {
  it("owns the audio turn lifecycle and only synthesizes one reply for duplicate turn ends", async () => {
    const first = createAsrSessionHarness();
    const second = createAsrSessionHarness();
    const sessions = [first.session, second.session];
    const events: VoiceSessionEvent[] = [];
    const generateReply = vi.fn(async (text: string) => `回复：${text}`);
    const synthesizeReply = vi.fn(async () => ({ audio: Buffer.from("audio"), format: "wav" as const }));

    const voiceSession = new VoiceSession({
      getAsrConfig: () => ({ engine: "local", language: "zh" }),
      createAsrSession: vi.fn(() => sessions.shift()!),
      generateReply,
      synthesizeReply,
      emit: (event) => events.push(event),
    });

    await voiceSession.start();
    voiceSession.pushAudio(Buffer.from("pcm"));

    const firstEnd = voiceSession.endTurn();
    const duplicateEnd = voiceSession.endTurn();
    expect(first.session.finish).toHaveBeenCalledTimes(1);
    expect(generateReply).not.toHaveBeenCalled();

    first.resolveFinish("你好");
    await Promise.all([firstEnd, duplicateEnd]);

    expect(generateReply).toHaveBeenCalledWith("你好");
    expect(synthesizeReply).toHaveBeenCalledWith("回复：你好");
    expect(events).toEqual(expect.arrayContaining([
      { type: "state", state: "ASR" },
      { type: "state", state: "LISTENING" },
      { type: "state", state: "THINKING" },
      { type: "turn", userText: "你好", assistantText: "回复：你好" },
      { type: "state", state: "SPEAKING" },
      { type: "audio", audio: Buffer.from("audio"), format: "wav" },
    ]));

    await voiceSession.onSpeechFinished();
    expect(second.session.start).toHaveBeenCalledTimes(1);
    expect(voiceSession.state).toBe("LISTENING");
  });

  it("does not emit stale replies after the call is stopped", async () => {
    const harness = createAsrSessionHarness();
    const synthesizeReply = vi.fn(async () => ({ audio: Buffer.from("audio"), format: "mp3" as const }));
    const events: VoiceSessionEvent[] = [];
    const voiceSession = new VoiceSession({
      getAsrConfig: () => ({ engine: "local", language: "zh" }),
      createAsrSession: () => harness.session,
      generateReply: vi.fn(async () => "reply"),
      synthesizeReply,
      emit: (event) => events.push(event),
    });

    await voiceSession.start();
    const endTurn = voiceSession.endTurn();
    voiceSession.stop();
    harness.resolveFinish("late input");
    await endTurn;

    expect(synthesizeReply).not.toHaveBeenCalled();
    expect(events.at(-1)).toEqual({ type: "state", state: "ENDED" });
  });
});
