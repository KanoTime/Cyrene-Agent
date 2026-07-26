import { describe, expect, it, vi } from "vitest";
import {
  enableE2eeBeforeConnect,
  observeEncryptedAudioPublication,
} from "../../../mobile/src/e2ee-session-readiness";
import {
  createCallTransportStateHandlers,
} from "../../../mobile/src/call-transport-state";

describe("Android LiveKit E2EE session readiness", () => {
  it("does not require room-level encryption confirmation before SignalConnected", async () => {
    const room = {
      isE2EEEnabled: false,
      setE2EEEnabled: vi.fn(async () => undefined),
    };

    await expect(enableE2eeBeforeConnect(room)).resolves.toBeUndefined();
    expect(room.setE2EEEnabled).toHaveBeenCalledWith(true);
  });

  it("reports secure readiness from encrypted audio publications without a peer encryption-status event", () => {
    const initial = {
      localEncryptedAudioPublished: false,
      peerEncryptedAudioSubscribed: false,
    };
    const local = observeEncryptedAudioPublication({
      current: initial,
      localIdentity: "mobile",
      peerIdentity: "desktop",
      participantIdentity: "mobile",
      kind: "audio",
      isEncrypted: true,
      isSubscribed: false,
    });
    expect(local).toEqual({
      next: {
        localEncryptedAudioPublished: true,
        peerEncryptedAudioSubscribed: false,
      },
      verdict: "WAITING",
    });

    const peer = observeEncryptedAudioPublication({
      current: local.next,
      localIdentity: "mobile",
      peerIdentity: "desktop",
      participantIdentity: "desktop",
      kind: "audio",
      isEncrypted: true,
      isSubscribed: true,
    });
    expect(peer).toEqual({
      next: {
        localEncryptedAudioPublished: true,
        peerEncryptedAudioSubscribed: true,
      },
      verdict: "READY",
    });
  });

  it("fails closed when either expected audio publication is not encrypted", () => {
    expect(observeEncryptedAudioPublication({
      current: {
        localEncryptedAudioPublished: true,
        peerEncryptedAudioSubscribed: false,
      },
      localIdentity: "mobile",
      peerIdentity: "desktop",
      participantIdentity: "desktop",
      kind: "audio",
      isEncrypted: false,
      isSubscribed: true,
    }).verdict).toBe("FAILED");
  });

  it("uses the latest secure-media readiness when Android resumes after the listener was registered", () => {
    const readiness = { current: false };
    const states: string[] = [];
    const handlers = createCallTransportStateHandlers(
      readiness,
      (state) => states.push(state),
    );

    readiness.current = true;
    handlers.onReconnected();

    expect(states).toEqual(["连接已恢复，正在聆听"]);
  });
});
