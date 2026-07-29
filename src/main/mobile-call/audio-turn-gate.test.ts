import { describe, expect, it, vi } from "vitest";
import { AudioTurnGate } from "./audio-turn-gate";

function frame(level: number, samples = 320): Int16Array {
  return new Int16Array(samples).fill(Math.round(level * 32_768));
}

function createGate() {
  const onAudio = vi.fn();
  const onTurnEnd = vi.fn();
  const gate = new AudioTurnGate({
    sampleRate: 16_000,
    threshold: 0.01,
    silenceMs: 1_000,
    minimumSpeechMs: 200,
    preRollMs: 200,
  }, { onAudio, onTurnEnd });
  return { gate, onAudio, onTurnEnd };
}

describe("AudioTurnGate", () => {
  it("drops every frame until a Voice Conversation is selected", () => {
    const { gate, onAudio } = createGate();

    for (let index = 0; index < 20; index += 1) gate.push(frame(0.08));

    expect(onAudio).not.toHaveBeenCalled();
  });

  it("keeps short automatic noise out of ASR and forwards confirmed speech with pre-roll", () => {
    const { gate, onAudio } = createGate();
    gate.setConversationReady(true);

    for (let index = 0; index < 8; index += 1) gate.push(frame(0.001));
    for (let index = 0; index < 9; index += 1) gate.push(frame(0.04));
    gate.push(frame(0.001));
    expect(onAudio).not.toHaveBeenCalled();

    for (let index = 0; index < 5; index += 1) gate.push(frame(0.001));
    for (let index = 0; index < 10; index += 1) gate.push(frame(0.04));

    expect(onAudio).toHaveBeenCalled();
    expect(onAudio.mock.calls.length).toBeGreaterThanOrEqual(15);
  });

  it("commits an automatic turn after configured silence", () => {
    const { gate, onTurnEnd } = createGate();
    gate.setConversationReady(true);
    for (let index = 0; index < 10; index += 1) gate.push(frame(0.04));
    for (let index = 0; index < 50; index += 1) gate.push(frame(0.001));

    expect(onTurnEnd).toHaveBeenCalledOnce();
  });

  it("manual mode admits audio only between begin and commit", () => {
    const { gate, onAudio, onTurnEnd } = createGate();
    gate.setConversationReady(true);
    gate.setMode("manual");

    gate.push(frame(0.04));
    expect(onAudio).not.toHaveBeenCalled();

    expect(gate.beginManualTurn()).toBe(true);
    gate.push(frame(0.02));
    gate.push(frame(0.003));
    expect(onAudio).toHaveBeenCalledTimes(2);
    expect(gate.commitManualTurn()).toBe(true);
    expect(onTurnEnd).toHaveBeenCalledOnce();

    gate.push(frame(0.04));
    expect(onAudio).toHaveBeenCalledTimes(2);
  });
});
