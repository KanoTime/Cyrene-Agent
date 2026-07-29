import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InMemoryDeviceAuthorizationModule } from "./device-authorization";
import { createDeviceAuthorizationHttpHandler } from "./device-authorization-http";
import {
  InMemoryDeviceAuthorizationAggregateStore,
  PersistentDeviceAuthorizationModule,
} from "./persistent-device-authorization";
import { LiveKitMediaGrantService } from "./livekit-media-grant-service";

describe("Device Authorization HTTP adapter", () => {
  async function pairMobileOverHttp(
    handle: ReturnType<typeof createDeviceAuthorizationHttpHandler>,
    desktopCredential: string,
  ): Promise<string> {
    const begun = await handle({
      method: "POST",
      pathname: "/v1/pairing/begin",
      authorization: `DeviceCredential ${desktopCredential}`,
      body: { targetKind: "MOBILE" },
    });
    const candidateReceipt =
      "cy_pr_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    await handle({
      method: "POST",
      pathname: "/v1/pairing/claim",
      body: {
        challengeId: begun.body.challengeId,
        invitation: begun.body.invitation,
        candidateReceipt,
        candidate: {
          installationId: "mobile-installation-http",
          kind: "MOBILE",
          label: "Android 手机",
        },
      },
    });
    await handle({
      method: "POST",
      pathname: "/v1/pairing/decide",
      authorization: `DeviceCredential ${desktopCredential}`,
      body: { challengeId: begun.body.challengeId, allow: true },
    });
    const outcome = await handle({
      method: "POST",
      pathname: "/v1/pairing/outcome",
      body: { challengeId: begun.body.challengeId, candidateReceipt },
    });
    if (typeof outcome.body.deviceCredential !== "string") {
      throw new Error("expected mobile credential");
    }
    return outcome.body.deviceCredential;
  }

  it("exposes authenticated immediate-call request, desktop polling, confirmation, and status", async () => {
    const nowMs = Date.parse("2026-07-23T10:00:00.000Z");
    const authorization = new InMemoryDeviceAuthorizationModule({
      now: () => nowMs,
    });
    const desktop = authorization.bootstrapOwner({ label: "家中 Mac" });
    const handle = createDeviceAuthorizationHttpHandler({
      authorization,
      publicOrigin: "https://control.example.test",
      mediaGrantService: new LiveKitMediaGrantService({
        serverUrl: "https://example.livekit.cloud",
        apiKey: "api-key",
        apiSecret: "api-secret",
        envelopeMasterKey: randomBytes(32),
        now: () => nowMs,
      }),
    });
    const mobileCredential = await pairMobileOverHttp(
      handle,
      desktop.deviceCredential,
    );
    await handle({
      method: "POST",
      pathname: "/v1/desktop/availability",
      authorization: `DeviceCredential ${desktop.deviceCredential}`,
      body: { available: true },
    });

    const requested = await handle({
      method: "POST",
      pathname: "/v1/calls/request",
      authorization: `DeviceCredential ${mobileCredential}`,
      body: { idempotencyKey: "mobile-http-call-attempt-0001" },
    });
    expect(requested).toMatchObject({
      status: 200,
      body: {
        status: "CALL_CREATED",
        call: { phase: "AWAITING_DESKTOP" },
      },
    });
    const requestedCall = requested.body.call as Record<string, unknown>;
    const callId = requestedCall.callId;
    if (typeof callId !== "string") throw new Error("expected call id");

    const current = await handle({
      method: "POST",
      pathname: "/v1/desktop/calls/current",
      authorization: `DeviceCredential ${desktop.deviceCredential}`,
      body: {},
    });
    expect(current.body).toMatchObject({
      call: {
        callId,
        phase: "AWAITING_DESKTOP",
      },
    });

    const confirmed = await handle({
      method: "POST",
      pathname: "/v1/desktop/calls/confirm",
      authorization: `DeviceCredential ${desktop.deviceCredential}`,
      body: {
        callId,
        characterId: "cyrene",
        characterName: "昔涟",
      },
    });
    expect(confirmed.body).toMatchObject({
      call: {
        phase: "CONNECTING_MEDIA",
        characterName: "昔涟",
      },
    });

    const mobileGrant = await handle({
      method: "POST",
      pathname: "/v1/calls/media-grant",
      authorization: `DeviceCredential ${mobileCredential}`,
      body: { callId },
    });
    const desktopGrant = await handle({
      method: "POST",
      pathname: "/v1/calls/media-grant",
      authorization: `DeviceCredential ${desktop.deviceCredential}`,
      body: { callId },
    });
    expect(mobileGrant).toMatchObject({
      status: 200,
      body: {
        grant: {
          callId,
          serverUrl: "wss://example.livekit.cloud",
          participantToken: expect.any(String),
          e2eeKey: expect.any(String),
        },
      },
    });
    expect(desktopGrant).toMatchObject({
      status: 200,
      body: {
        grant: {
          callId,
          serverUrl: "wss://example.livekit.cloud",
          participantToken: expect.any(String),
          e2eeKey: (mobileGrant.body.grant as Record<string, unknown>).e2eeKey,
        },
      },
    });
    expect(await handle({
      method: "POST",
      pathname: "/v1/calls/media-grant",
      authorization: `DeviceCredential ${mobileCredential}`,
      body: { callId },
    })).toMatchObject({
      status: 400,
      body: { code: "MEDIA_GRANT_ALREADY_CLAIMED" },
    });

    const desktopReady = await handle({
      method: "POST",
      pathname: "/v1/calls/media-ready",
      authorization: `DeviceCredential ${desktop.deviceCredential}`,
      body: { callId },
    });
    expect(desktopReady.body).toMatchObject({
      call: { phase: "CONNECTING_MEDIA" },
    });
    const mobileReady = await handle({
      method: "POST",
      pathname: "/v1/calls/media-ready",
      authorization: `DeviceCredential ${mobileCredential}`,
      body: { callId },
    });
    expect(mobileReady.body).toMatchObject({
      call: { phase: "ACTIVE" },
    });

    const status = await handle({
      method: "POST",
      pathname: "/v1/calls/status",
      authorization: `DeviceCredential ${mobileCredential}`,
      body: { callId },
    });
    expect(status.body).toEqual(mobileReady.body);

    const replacement = await handle({
      method: "POST",
      pathname: "/v1/calls/request",
      authorization: `DeviceCredential ${mobileCredential}`,
      body: {
        idempotencyKey: "mobile-http-call-attempt-replacement",
        replaceOwnedCall: true,
      },
    });
    expect(replacement).toMatchObject({
      status: 200,
      body: {
        status: "CALL_CREATED",
        call: { phase: "AWAITING_DESKTOP" },
      },
    });
    expect((replacement.body.call as Record<string, unknown>).callId)
      .not.toBe(callId);
    expect((await handle({
      method: "POST",
      pathname: "/v1/calls/status",
      authorization: `DeviceCredential ${mobileCredential}`,
      body: { callId },
    })).body).toMatchObject({
      call: {
        phase: "ENDED",
        terminationReason: "REPLACED_BY_SAME_DEVICE",
      },
    });
  });

  it("does not reject media envelopes when issuance starts after the media deadline was established", async () => {
    const nowMs = Date.parse("2026-07-23T12:06:09.000Z");
    const authorization = new InMemoryDeviceAuthorizationModule({
      now: () => nowMs,
    });
    const desktop = authorization.bootstrapOwner({ label: "家中 Mac" });
    const handle = createDeviceAuthorizationHttpHandler({
      authorization,
      publicOrigin: "https://control.example.test",
      mediaGrantService: new LiveKitMediaGrantService({
        serverUrl: "https://example.livekit.cloud",
        apiKey: "api-key",
        apiSecret: "api-secret",
        envelopeMasterKey: randomBytes(32),
        now: () => nowMs + 1,
      }),
    });
    const mobileCredential = await pairMobileOverHttp(
      handle,
      desktop.deviceCredential,
    );
    await handle({
      method: "POST",
      pathname: "/v1/desktop/availability",
      authorization: `DeviceCredential ${desktop.deviceCredential}`,
      body: { available: true },
    });
    const requested = await handle({
      method: "POST",
      pathname: "/v1/calls/request",
      authorization: `DeviceCredential ${mobileCredential}`,
      body: { idempotencyKey: "mobile-http-call-deadline-race" },
    });
    const callId = (requested.body.call as Record<string, unknown>).callId;
    if (typeof callId !== "string") throw new Error("expected call id");

    const confirmed = await handle({
      method: "POST",
      pathname: "/v1/desktop/calls/confirm",
      authorization: `DeviceCredential ${desktop.deviceCredential}`,
      body: {
        callId,
        characterId: "cyrene",
        characterName: "昔涟",
      },
    });

    expect(confirmed.body).toMatchObject({
      call: { callId, phase: "CONNECTING_MEDIA" },
    });
  });

  it("allows a deployment bootstrap code only for the first Owner and confirms recovery over desktop auth", async () => {
    const authorization = new InMemoryDeviceAuthorizationModule();
    const handle = createDeviceAuthorizationHttpHandler({
      authorization,
      publicOrigin: "https://control.example.test",
      deploymentBootstrapCodeHash: "7TOwM_UD4fTws95ghFfuy2Rn2XlORkLN492fil5-PPk",
    });

    const denied = await handle({
      method: "POST",
      pathname: "/v1/owner/bootstrap",
      authorization: "DeploymentBootstrap cy_db_wrong",
      body: { label: "家中 Mac" },
    });
    expect(denied).toMatchObject({
      status: 401,
      body: { code: "DEPLOYMENT_BOOTSTRAP_REQUIRED" },
    });

    const bootstrapped = await handle({
      method: "POST",
      pathname: "/v1/owner/bootstrap",
      authorization: "DeploymentBootstrap cy_db_0123456789abcdef0123456789abcdef0123456789abcdef",
      body: { label: "家中 Mac" },
    });
    expect(bootstrapped).toMatchObject({
      status: 200,
      body: {
        deviceCredential: expect.stringMatching(/^cy_dc_/),
        ownerRecoveryKey: expect.stringMatching(/^cy_rk_/),
      },
    });

    const confirmed = await handle({
      method: "POST",
      pathname: "/v1/owner/recovery-key/confirm",
      authorization: `DeviceCredential ${bootstrapped.body.deviceCredential}`,
      body: { ownerRecoveryKey: bootstrapped.body.ownerRecoveryKey },
    });
    expect(confirmed).toMatchObject({
      status: 200,
      body: { status: "CONFIRMED" },
    });

    const recovered = await handle({
      method: "POST",
      pathname: "/v1/owner/recover",
      authorization: `OwnerRecovery ${bootstrapped.body.ownerRecoveryKey}`,
      body: {
        recoveryReceipt:
          "cy_rr_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        label: "恢复后的 Mac",
      },
    });
    expect(recovered).toMatchObject({
      status: 200,
      body: {
        device: {
          kind: "DESKTOP",
          label: "恢复后的 Mac",
          status: "ACTIVE",
        },
        deviceCredential: expect.stringMatching(/^cy_dc_/),
        ownerRecoveryKey: expect.stringMatching(/^cy_rk_/),
      },
    });

    const replay = await handle({
      method: "POST",
      pathname: "/v1/owner/bootstrap",
      authorization: "DeploymentBootstrap cy_db_0123456789abcdef0123456789abcdef0123456789abcdef",
      body: { label: "另一台 Mac" },
    });
    expect(replay).toMatchObject({
      status: 400,
      body: { code: "OWNER_ALREADY_BOOTSTRAPPED" },
    });
  });

  it("keeps the credential out of desktop responses and delivers it only to the approved candidate", async () => {
    const authorization = new InMemoryDeviceAuthorizationModule();
    const desktop = authorization.bootstrapOwner({ label: "家中 Mac" });
    const handle = createDeviceAuthorizationHttpHandler({
      authorization,
      publicOrigin: "https://control.example.test",
    });

    const begun = await handle({
      method: "POST",
      pathname: "/v1/pairing/begin",
      authorization: `DeviceCredential ${desktop.deviceCredential}`,
      body: { targetKind: "MOBILE" },
    });
    expect(begun.status).toBe(200);
    expect(begun.body).not.toHaveProperty("deviceCredential");
    expect(begun.body.pairingLink).toMatch(/^cyrene:\/\/pair\?/);

    const claimed = await handle({
      method: "POST",
      pathname: "/v1/pairing/claim",
      body: {
        challengeId: begun.body.challengeId,
        invitation: begun.body.invitation,
        candidateReceipt: "cy_pr_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        candidate: {
          installationId: "mobile-installation-1",
          kind: "MOBILE",
          label: "Kano 的 Android",
        },
      },
    });
    expect(claimed).toMatchObject({
      status: 200,
      body: { status: "CLAIMED" },
    });
    expect(claimed.body).not.toHaveProperty("deviceCredential");

    const review = await handle({
      method: "POST",
      pathname: "/v1/pairing/review",
      authorization: `DeviceCredential ${desktop.deviceCredential}`,
      body: { challengeId: begun.body.challengeId },
    });
    expect(review).toMatchObject({
      status: 200,
      body: {
        status: "CLAIMED",
        candidate: {
          installationId: "mobile-installation-1",
          kind: "MOBILE",
          label: "Kano 的 Android",
        },
        verificationCode: expect.stringMatching(/^\d{3} \d{3}$/),
      },
    });
    expect(review.body).not.toHaveProperty("candidateReceipt");
    expect(review.body).not.toHaveProperty("deviceCredential");

    const approved = await handle({
      method: "POST",
      pathname: "/v1/pairing/decide",
      authorization: `DeviceCredential ${desktop.deviceCredential}`,
      body: { challengeId: begun.body.challengeId, allow: true },
    });
    expect(approved).toMatchObject({
      status: 200,
      body: { status: "APPROVED" },
    });
    expect(approved.body).not.toHaveProperty("deviceCredential");

    const outcome = await handle({
      method: "POST",
      pathname: "/v1/pairing/outcome",
      body: {
        challengeId: begun.body.challengeId,
        candidateReceipt: "cy_pr_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      },
    });
    expect(outcome).toMatchObject({
      status: 200,
      body: {
        status: "APPROVED",
        deviceId: expect.any(String),
        deviceCredential: expect.stringMatching(/^cy_dc_/),
      },
    });
  });

  it("supports an asynchronous transaction-backed authorization service", async () => {
    const authorization = new PersistentDeviceAuthorizationModule({
      store: new InMemoryDeviceAuthorizationAggregateStore(),
    });
    const desktop = await authorization.bootstrapOwner({ label: "家中 Mac" });
    const handle = createDeviceAuthorizationHttpHandler({
      authorization,
      publicOrigin: "https://control.example.test",
    });

    const begun = await handle({
      method: "POST",
      pathname: "/v1/pairing/begin",
      authorization: `DeviceCredential ${desktop.deviceCredential}`,
      body: { targetKind: "MOBILE" },
    });

    expect(begun).toMatchObject({
      status: 200,
      body: {
        challengeId: expect.any(String),
        pairingLink: expect.stringMatching(/^cyrene:\/\/pair\?/),
      },
    });
  });

  it("preserves a safe CloudBase code when the SDK rejects with a plain object", async () => {
    const authorization = new PersistentDeviceAuthorizationModule({
      store: {
        transact: async () => Promise.reject({
          code: "DATABASE_PERMISSION_DENIED",
          message: "sensitive vendor diagnostic",
        }),
      },
    });
    const handle = createDeviceAuthorizationHttpHandler({
      authorization,
      publicOrigin: "https://control.example.test",
      deploymentBootstrapCodeHash: "7TOwM_UD4fTws95ghFfuy2Rn2XlORkLN492fil5-PPk",
    });

    const response = await handle({
      method: "POST",
      pathname: "/v1/owner/bootstrap",
      authorization:
        "DeploymentBootstrap cy_db_0123456789abcdef0123456789abcdef0123456789abcdef",
      body: { label: "家中 Mac" },
    });

    expect(response).toEqual({
      status: 500,
      body: { code: "DATABASE_PERMISSION_DENIED" },
    });
  });
});
