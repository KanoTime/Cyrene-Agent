import type { RemoteVoiceCall } from "./remote-call";

const DEFAULT_POLL_INTERVAL_MS = 1_500;

export async function monitorRemoteCallState(input: {
  read: () => Promise<RemoteVoiceCall>;
  isCurrent: () => boolean;
  onEnded: (call: RemoteVoiceCall) => void | Promise<void>;
  wait?: () => Promise<void>;
}): Promise<void> {
  const wait = input.wait ?? (() =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, DEFAULT_POLL_INTERVAL_MS);
    }));

  while (input.isCurrent()) {
    try {
      const call = await input.read();
      if (!input.isCurrent()) return;
      if (call.phase === "ENDED") {
        await input.onEnded(call);
        return;
      }
    } catch {
      // The control plane is authoritative, but a transient VPN or HTTPS
      // failure must not tear down an otherwise healthy E2EE media session.
    }
    if (!input.isCurrent()) return;
    await wait();
  }
}
