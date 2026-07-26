import type { MobileCallStatus } from "../../shared/mobile-call-status";
import type { MediaJoinGrant } from "./media-grant-envelope";
import type { DesktopDeviceAuthorizationClient } from "./desktop-device-authorization-client";

type RemoteCallClient = Pick<
  DesktopDeviceAuthorizationClient,
  | "readCurrentVoiceCall"
  | "confirmVoiceCall"
  | "takeMediaGrant"
  | "reportMediaReady"
  | "endVoiceCall"
>;

export type DesktopRemoteCallFailureStage =
  | "ASSERT_READY"
  | "CONFIRM_CALL"
  | "TAKE_GRANT"
  | "START_MEDIA";

export interface DesktopRemoteCallFailure {
  stage: DesktopRemoteCallFailureStage;
  code: string;
}

const FALLBACK_FAILURE_CODES: Record<DesktopRemoteCallFailureStage, string> = {
  ASSERT_READY: "READINESS_CHECK_FAILED",
  CONFIRM_CALL: "CALL_CONFIRM_FAILED",
  TAKE_GRANT: "MEDIA_GRANT_FAILED",
  START_MEDIA: "MEDIA_START_FAILED",
};

function sanitizeFailureCode(
  stage: DesktopRemoteCallFailureStage,
  error: unknown,
): string {
  const message = error instanceof Error ? error.message : "";
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(message)
    ? message
    : FALLBACK_FAILURE_CODES[stage];
}

export class DesktopRemoteCallCoordinator {
  readonly #client: RemoteCallClient;
  readonly #getActiveCharacter: () => { id: string; displayName: string };
  readonly #assertReady: () => void;
  readonly #startRemoteCall: (
    grant: MediaJoinGrant,
    onStatus: (status: MobileCallStatus) => void,
  ) => Promise<void>;
  readonly #stopRemoteCall: () => Promise<void>;
  readonly #onFailure?: (failure: DesktopRemoteCallFailure) => void;
  readonly #pollIntervalMs: number;
  #timer: ReturnType<typeof setInterval> | null = null;
  #polling = false;
  #suspended = false;
  #currentCallId: string | null = null;
  #mediaConnected = false;
  #mediaReadyReported = false;
  #mediaReadyReportInFlight = false;

  constructor(options: {
    client: RemoteCallClient;
    getActiveCharacter: () => { id: string; displayName: string };
    assertReady: () => void;
    startRemoteCall: (
      grant: MediaJoinGrant,
      onStatus: (status: MobileCallStatus) => void,
    ) => Promise<void>;
    stopRemoteCall: () => Promise<void>;
    onFailure?: (failure: DesktopRemoteCallFailure) => void;
    pollIntervalMs?: number;
  }) {
    this.#client = options.client;
    this.#getActiveCharacter = options.getActiveCharacter;
    this.#assertReady = options.assertReady;
    this.#startRemoteCall = options.startRemoteCall;
    this.#stopRemoteCall = options.stopRemoteCall;
    this.#onFailure = options.onFailure;
    this.#pollIntervalMs = options.pollIntervalMs ?? 1_000;
  }

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => void this.pollNow(), this.#pollIntervalMs);
    void this.pollNow();
  }

  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    await this.#endCurrentCall();
  }

  async suspend(): Promise<void> {
    this.#suspended = true;
    await this.#endCurrentCall();
  }

  resume(): void {
    this.#suspended = false;
    void this.pollNow();
  }

  async pollNow(): Promise<void> {
    if (this.#suspended || this.#polling) return;
    this.#polling = true;
    let claimedCallThisPoll = false;
    let stage: DesktopRemoteCallFailureStage = "ASSERT_READY";
    try {
      const pending = await this.#client.readCurrentVoiceCall();
      if (this.#currentCallId) {
        if (pending?.callId === this.#currentCallId) {
          if (pending.phase === "ACTIVE") this.#mediaReadyReported = true;
          await this.#ensureMediaReadyReported();
          return;
        }
        await this.#clearCurrentCallLocally();
      }
      if (!pending || pending.phase !== "AWAITING_DESKTOP") return;
      this.#currentCallId = pending.callId;
      claimedCallThisPoll = true;
      stage = "ASSERT_READY";
      this.#assertReady();
      const character = this.#getActiveCharacter();
      stage = "CONFIRM_CALL";
      const confirmed = await this.#client.confirmVoiceCall({
        callId: pending.callId,
        characterId: character.id,
        characterName: character.displayName,
      });
      if (confirmed.phase !== "CONNECTING_MEDIA") return;
      stage = "TAKE_GRANT";
      const grant = await this.#client.takeMediaGrant(confirmed.callId);
      this.#mediaConnected = false;
      this.#mediaReadyReported = false;
      this.#mediaReadyReportInFlight = false;
      stage = "START_MEDIA";
      await this.#startRemoteCall(grant, (status) => {
        if (status.state === "connected") {
          this.#mediaConnected = true;
          void this.#ensureMediaReadyReported();
        }
        if (status.state === "ended" || status.state === "error") {
          void this.#endCurrentCall();
        }
      });
    } catch (error) {
      if (claimedCallThisPoll) {
        try {
          this.#onFailure?.({
            stage,
            code: sanitizeFailureCode(stage, error),
          });
        } catch {
          // Diagnostics must never change call cleanup behavior.
        }
        await this.#endCurrentCall();
      }
    } finally {
      this.#polling = false;
    }
  }

  async #clearCurrentCallLocally(): Promise<void> {
    this.#currentCallId = null;
    this.#mediaConnected = false;
    this.#mediaReadyReported = false;
    this.#mediaReadyReportInFlight = false;
    await this.#stopRemoteCall().catch(() => undefined);
  }

  async #ensureMediaReadyReported(): Promise<void> {
    const callId = this.#currentCallId;
    if (
      !callId
      || !this.#mediaConnected
      || this.#mediaReadyReported
      || this.#mediaReadyReportInFlight
    ) {
      return;
    }
    this.#mediaReadyReportInFlight = true;
    try {
      await this.#client.reportMediaReady(callId);
      if (this.#currentCallId === callId) this.#mediaReadyReported = true;
    } catch {
      // A connected call remains eligible for retry on the next reconciliation
      // poll. Never acknowledge readiness before the control plane confirms it.
    } finally {
      this.#mediaReadyReportInFlight = false;
    }
  }

  async #endCurrentCall(): Promise<void> {
    const callId = this.#currentCallId;
    await this.#clearCurrentCallLocally();
    if (callId) {
      await this.#client.endVoiceCall(
        callId,
        "PARTICIPANT_HUNG_UP",
      ).catch(() => undefined);
    }
  }
}
