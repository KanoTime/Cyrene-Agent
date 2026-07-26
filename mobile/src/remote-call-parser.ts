import type { RemoteVoiceCall } from "./remote-call";

export function parseRemoteVoiceCall(value: unknown): RemoteVoiceCall {
  if (!value || typeof value !== "object") {
    throw new Error("REMOTE_CALL_RESPONSE_INVALID");
  }
  const input = value as Record<string, unknown>;
  if (
    typeof input.callId !== "string"
    || (
      input.phase !== "AWAITING_DESKTOP"
      && input.phase !== "CONNECTING_MEDIA"
      && input.phase !== "ACTIVE"
      && input.phase !== "RECONNECTING"
      && input.phase !== "ENDED"
    )
  ) {
    throw new Error("REMOTE_CALL_RESPONSE_INVALID");
  }
  return {
    callId: input.callId,
    phase: input.phase,
    ...(typeof input.characterId === "string"
      ? { characterId: input.characterId }
      : {}),
    ...(typeof input.characterName === "string"
      ? { characterName: input.characterName }
      : {}),
    ...(typeof input.terminationReason === "string"
      ? { terminationReason: input.terminationReason }
      : {}),
  };
}
