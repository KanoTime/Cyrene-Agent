export interface PreconnectE2eeRoom {
  readonly isE2EEEnabled: boolean;
  setE2EEEnabled(enabled: boolean): Promise<void>;
}

export async function enableE2eeBeforeConnect(
  room: PreconnectE2eeRoom,
): Promise<void> {
  await room.setE2EEEnabled(true);
}

export interface EncryptedAudioPublicationReadiness {
  localEncryptedAudioPublished: boolean;
  peerEncryptedAudioSubscribed: boolean;
}

export type EncryptedAudioPublicationVerdict =
  | "IGNORED"
  | "WAITING"
  | "READY"
  | "FAILED";

export function observeEncryptedAudioPublication(input: {
  current: EncryptedAudioPublicationReadiness;
  localIdentity: string;
  peerIdentity: string;
  participantIdentity: string;
  kind: string;
  isEncrypted: boolean;
  isSubscribed: boolean;
}): {
  next: EncryptedAudioPublicationReadiness;
  verdict: EncryptedAudioPublicationVerdict;
} {
  if (input.kind !== "audio") {
    return { next: input.current, verdict: "IGNORED" };
  }
  const isLocal = input.participantIdentity === input.localIdentity;
  const isPeer = input.participantIdentity === input.peerIdentity;
  if (!isLocal && !isPeer) {
    return { next: input.current, verdict: "IGNORED" };
  }
  if (isPeer && !input.isSubscribed) {
    return { next: input.current, verdict: "WAITING" };
  }
  if (!input.isEncrypted) {
    return { next: input.current, verdict: "FAILED" };
  }
  const next = {
    localEncryptedAudioPublished:
      input.current.localEncryptedAudioPublished || isLocal,
    peerEncryptedAudioSubscribed:
      input.current.peerEncryptedAudioSubscribed || isPeer,
  };
  return {
    next,
    verdict:
      next.localEncryptedAudioPublished
      && next.peerEncryptedAudioSubscribed
        ? "READY"
        : "WAITING",
  };
}
