import { describe, expect, it, vi } from "vitest";
import { DesktopRemoteCallCoordinator } from "./desktop-remote-call-coordinator";

describe("DesktopRemoteCallCoordinator", () => {
  it("confirms the pending call, consumes only the desktop grant, and reports secure media ready", async () => {
    const client = {
      readCurrentVoiceCall: vi.fn(async () => ({
        callId: "call-1",
        mobileDeviceId: "mobile-1",
        desktopDeviceId: "desktop-1",
        phase: "AWAITING_DESKTOP" as const,
        createdAt: "2026-07-23T00:00:00.000Z",
        desktopConfirmDeadline: "2026-07-23T00:00:10.000Z",
      })),
      confirmVoiceCall: vi.fn(async () => ({
        callId: "call-1",
        mobileDeviceId: "mobile-1",
        desktopDeviceId: "desktop-1",
        phase: "CONNECTING_MEDIA" as const,
        createdAt: "2026-07-23T00:00:00.000Z",
        desktopConfirmDeadline: "2026-07-23T00:00:10.000Z",
      })),
      takeMediaGrant: vi.fn(async () => ({
        callId: "call-1",
        endpointDeviceId: "desktop-1",
        participantIdentity: "desktop-participant",
        peerIdentity: "mobile-participant",
        serverUrl: "wss://media.example.test",
        participantToken: "desktop-token",
        e2eeKey: "A".repeat(43),
        expiresAt: "2026-07-23T00:05:00.000Z",
      })),
      reportMediaReady: vi.fn(async () => ({
        callId: "call-1",
        mobileDeviceId: "mobile-1",
        desktopDeviceId: "desktop-1",
        phase: "CONNECTING_MEDIA" as const,
        createdAt: "2026-07-23T00:00:00.000Z",
        desktopConfirmDeadline: "2026-07-23T00:00:10.000Z",
      })),
      endVoiceCall: vi.fn(async () => ({
        callId: "call-1",
        mobileDeviceId: "mobile-1",
        desktopDeviceId: "desktop-1",
        phase: "ENDED" as const,
        createdAt: "2026-07-23T00:00:00.000Z",
        desktopConfirmDeadline: "2026-07-23T00:00:10.000Z",
      })),
    };
    let onStatus: ((status: { state: string }) => void) | undefined;
    const coordinator = new DesktopRemoteCallCoordinator({
      client,
      getActiveCharacter: () => ({ id: "cyrene", displayName: "昔涟" }),
      assertReady: vi.fn(),
      startRemoteCall: vi.fn(async (_grant, callback) => {
        onStatus = callback;
      }),
      stopRemoteCall: vi.fn(async () => undefined),
    });

    await coordinator.pollNow();
    expect(client.confirmVoiceCall).toHaveBeenCalledWith({
      callId: "call-1",
      characterId: "cyrene",
      characterName: "昔涟",
    });
    expect(client.takeMediaGrant).toHaveBeenCalledWith("call-1");
    onStatus?.({ state: "connected" });
    await Promise.resolve();
    expect(client.reportMediaReady).toHaveBeenCalledWith("call-1");
  });

  it("reconciles a server-ended call before confirming the next immediate call", async () => {
    const pendingCalls = [
      {
        callId: "call-1",
        mobileDeviceId: "mobile-1",
        desktopDeviceId: "desktop-1",
        phase: "AWAITING_DESKTOP" as const,
        createdAt: "2026-07-23T00:00:00.000Z",
        desktopConfirmDeadline: "2026-07-23T00:00:10.000Z",
      },
      {
        callId: "call-2",
        mobileDeviceId: "mobile-1",
        desktopDeviceId: "desktop-1",
        phase: "AWAITING_DESKTOP" as const,
        createdAt: "2026-07-23T00:00:20.000Z",
        desktopConfirmDeadline: "2026-07-23T00:00:30.000Z",
      },
    ];
    const client = {
      readCurrentVoiceCall: vi.fn(async () => pendingCalls.shift() ?? null),
      confirmVoiceCall: vi.fn(async ({ callId }: { callId: string }) => ({
        callId,
        mobileDeviceId: "mobile-1",
        desktopDeviceId: "desktop-1",
        phase: "CONNECTING_MEDIA" as const,
        createdAt: "2026-07-23T00:00:00.000Z",
        desktopConfirmDeadline: "2026-07-23T00:00:10.000Z",
      })),
      takeMediaGrant: vi.fn(async (callId: string) => ({
        callId,
        endpointDeviceId: "desktop-1",
        participantIdentity: `desktop-${callId}`,
        peerIdentity: `mobile-${callId}`,
        serverUrl: "wss://media.example.test",
        participantToken: `desktop-token-${callId}`,
        e2eeKey: "A".repeat(43),
        expiresAt: "2026-07-23T00:05:00.000Z",
      })),
      reportMediaReady: vi.fn(),
      endVoiceCall: vi.fn(async () => undefined),
    };
    const stopRemoteCall = vi.fn(async () => undefined);
    const coordinator = new DesktopRemoteCallCoordinator({
      client,
      getActiveCharacter: () => ({ id: "cyrene", displayName: "昔涟" }),
      assertReady: vi.fn(),
      startRemoteCall: vi.fn(async () => undefined),
      stopRemoteCall,
    });

    await coordinator.pollNow();
    await coordinator.pollNow();

    expect(client.confirmVoiceCall).toHaveBeenNthCalledWith(2, {
      callId: "call-2",
      characterId: "cyrene",
      characterName: "昔涟",
    });
    expect(stopRemoteCall).toHaveBeenCalledTimes(1);
  });

  it("keeps healthy media running when current-call reconciliation briefly fails", async () => {
    const activeCall = {
      callId: "call-1",
      mobileDeviceId: "mobile-1",
      desktopDeviceId: "desktop-1",
      phase: "AWAITING_DESKTOP" as const,
      createdAt: "2026-07-23T00:00:00.000Z",
      desktopConfirmDeadline: "2026-07-23T00:00:10.000Z",
    };
    const client = {
      readCurrentVoiceCall: vi.fn()
        .mockResolvedValueOnce(activeCall)
        .mockRejectedValueOnce(new Error("temporary control-plane failure")),
      confirmVoiceCall: vi.fn(async () => ({
        ...activeCall,
        phase: "CONNECTING_MEDIA" as const,
      })),
      takeMediaGrant: vi.fn(async () => ({
        callId: "call-1",
        endpointDeviceId: "desktop-1",
        participantIdentity: "desktop-participant",
        peerIdentity: "mobile-participant",
        serverUrl: "wss://media.example.test",
        participantToken: "desktop-token",
        e2eeKey: "A".repeat(43),
        expiresAt: "2026-07-23T00:05:00.000Z",
      })),
      reportMediaReady: vi.fn(),
      endVoiceCall: vi.fn(),
    };
    const stopRemoteCall = vi.fn(async () => undefined);
    const coordinator = new DesktopRemoteCallCoordinator({
      client,
      getActiveCharacter: () => ({ id: "cyrene", displayName: "昔涟" }),
      assertReady: vi.fn(),
      startRemoteCall: vi.fn(async () => undefined),
      stopRemoteCall,
    });

    await coordinator.pollNow();
    await coordinator.pollNow();

    expect(stopRemoteCall).not.toHaveBeenCalled();
    expect(client.endVoiceCall).not.toHaveBeenCalled();
  });

  it("retries a transient media-ready report instead of timing out an encrypted call", async () => {
    const awaitingCall = {
      callId: "call-1",
      mobileDeviceId: "mobile-1",
      desktopDeviceId: "desktop-1",
      phase: "AWAITING_DESKTOP" as const,
      createdAt: "2026-07-23T00:00:00.000Z",
      desktopConfirmDeadline: "2026-07-23T00:00:10.000Z",
    };
    const connectingCall = {
      ...awaitingCall,
      phase: "CONNECTING_MEDIA" as const,
    };
    const client = {
      readCurrentVoiceCall: vi.fn()
        .mockResolvedValueOnce(awaitingCall)
        .mockResolvedValue(connectingCall),
      confirmVoiceCall: vi.fn(async () => connectingCall),
      takeMediaGrant: vi.fn(async () => ({
        callId: "call-1",
        endpointDeviceId: "desktop-1",
        participantIdentity: "desktop-participant",
        peerIdentity: "mobile-participant",
        serverUrl: "wss://media.example.test",
        participantToken: "desktop-token",
        e2eeKey: "A".repeat(43),
        expiresAt: "2026-07-23T00:05:00.000Z",
      })),
      reportMediaReady: vi.fn()
        .mockRejectedValueOnce(new Error("temporary control-plane failure"))
        .mockResolvedValueOnce(connectingCall),
      endVoiceCall: vi.fn(),
    };
    let onStatus: ((status: { state: string }) => void) | undefined;
    const stopRemoteCall = vi.fn(async () => undefined);
    const coordinator = new DesktopRemoteCallCoordinator({
      client,
      getActiveCharacter: () => ({ id: "cyrene", displayName: "昔涟" }),
      assertReady: vi.fn(),
      startRemoteCall: vi.fn(async (_grant, callback) => {
        onStatus = callback;
      }),
      stopRemoteCall,
    });

    await coordinator.pollNow();
    onStatus?.({ state: "connected" });
    await vi.waitFor(() => expect(client.reportMediaReady).toHaveBeenCalledTimes(1));
    await coordinator.pollNow();

    expect(client.reportMediaReady).toHaveBeenCalledTimes(2);
    expect(stopRemoteCall).not.toHaveBeenCalled();
    expect(client.endVoiceCall).not.toHaveBeenCalled();
  });

  it("reports a sanitized failure stage when desktop media startup fails", async () => {
    const client = {
      readCurrentVoiceCall: vi.fn(async () => ({
        callId: "call-1",
        mobileDeviceId: "mobile-1",
        desktopDeviceId: "desktop-1",
        phase: "AWAITING_DESKTOP" as const,
        createdAt: "2026-07-23T00:00:00.000Z",
        desktopConfirmDeadline: "2026-07-23T00:00:10.000Z",
      })),
      confirmVoiceCall: vi.fn(async () => ({
        callId: "call-1",
        mobileDeviceId: "mobile-1",
        desktopDeviceId: "desktop-1",
        phase: "CONNECTING_MEDIA" as const,
        createdAt: "2026-07-23T00:00:00.000Z",
        desktopConfirmDeadline: "2026-07-23T00:00:10.000Z",
      })),
      takeMediaGrant: vi.fn(async () => ({
        callId: "call-1",
        endpointDeviceId: "desktop-1",
        participantIdentity: "desktop-participant",
        peerIdentity: "mobile-participant",
        serverUrl: "wss://media.example.test",
        participantToken: "desktop-token",
        e2eeKey: "A".repeat(43),
        expiresAt: "2026-07-23T00:05:00.000Z",
      })),
      reportMediaReady: vi.fn(),
      endVoiceCall: vi.fn(async () => undefined),
    };
    const onFailure = vi.fn();
    const coordinator = new DesktopRemoteCallCoordinator({
      client,
      getActiveCharacter: () => ({ id: "cyrene", displayName: "昔涟" }),
      assertReady: vi.fn(),
      startRemoteCall: vi.fn(async () => {
        throw new Error("移动端通话连接失败：contains internal transport details");
      }),
      stopRemoteCall: vi.fn(async () => undefined),
      onFailure,
    });

    await coordinator.pollNow();

    expect(onFailure).toHaveBeenCalledWith({
      stage: "START_MEDIA",
      code: "MEDIA_START_FAILED",
    });
  });
});
