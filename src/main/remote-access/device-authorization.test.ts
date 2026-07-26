import { describe, expect, it } from "vitest";
import { InMemoryDeviceAuthorizationModule } from "./device-authorization";

describe("Device Authorization Module", () => {
  function pairMobile(
    authorization: InMemoryDeviceAuthorizationModule,
    desktopCredential: string,
    installationId: string,
  ): { deviceId: string; deviceCredential: string } {
    const invitation = authorization.beginPairing({
      authorizingCredential: desktopCredential,
      targetKind: "MOBILE",
    });
    const claim = authorization.claimPairing({
      invitation: invitation.invitation,
      candidate: {
        installationId,
        kind: "MOBILE",
        label: installationId,
      },
    });
    authorization.decidePairing({
      authorizingCredential: desktopCredential,
      challengeId: invitation.challengeId,
      allow: true,
    });
    const outcome = authorization.readPairingOutcome({
      challengeId: invitation.challengeId,
      candidateReceipt: claim.candidateReceipt,
    });
    if (outcome.status !== "APPROVED") throw new Error("expected approved mobile");
    return {
      deviceId: outcome.device.deviceId,
      deviceCredential: outcome.deviceCredential,
    };
  }

  it("rejects an immediate call when the desktop is unavailable and replays the same rejection", () => {
    const authorization = new InMemoryDeviceAuthorizationModule();
    const desktop = authorization.bootstrapOwner({ label: "家中 Mac" });
    const mobile = pairMobile(authorization, desktop.deviceCredential, "mobile-a");

    const first = authorization.requestVoiceCall({
      authorizingCredential: mobile.deviceCredential,
      idempotencyKey: "call-attempt-unavailable",
    });
    const replay = authorization.requestVoiceCall({
      authorizingCredential: mobile.deviceCredential,
      idempotencyKey: "call-attempt-unavailable",
    });

    expect(first).toEqual({ status: "REJECTED", reason: "DESKTOP_UNAVAILABLE" });
    expect(replay).toEqual(first);
    expect(authorization.exportPersistentState().voiceCalls).toEqual([]);
  });

  it("creates one call for the same mobile idempotency key and rejects a competing mobile as busy", () => {
    let now = Date.parse("2026-07-23T10:00:00.000Z");
    const authorization = new InMemoryDeviceAuthorizationModule({ now: () => now });
    const desktop = authorization.bootstrapOwner({ label: "家中 Mac" });
    const firstMobile = pairMobile(
      authorization,
      desktop.deviceCredential,
      "mobile-a",
    );
    const secondMobile = pairMobile(
      authorization,
      desktop.deviceCredential,
      "mobile-b",
    );
    authorization.reportDesktopAvailability({
      authorizingCredential: desktop.deviceCredential,
      available: true,
    });

    const first = authorization.requestVoiceCall({
      authorizingCredential: firstMobile.deviceCredential,
      idempotencyKey: "call-attempt-mobile-a",
    });
    const replay = authorization.requestVoiceCall({
      authorizingCredential: firstMobile.deviceCredential,
      idempotencyKey: "call-attempt-mobile-a",
    });
    const competing = authorization.requestVoiceCall({
      authorizingCredential: secondMobile.deviceCredential,
      idempotencyKey: "call-attempt-mobile-b",
    });

    expect(first).toMatchObject({
      status: "CALL_CREATED",
      call: {
        phase: "AWAITING_DESKTOP",
        mobileDeviceId: firstMobile.deviceId,
        desktopDeviceId: desktop.deviceId,
        desktopConfirmDeadline: new Date(now + 10_000).toISOString(),
      },
    });
    expect(replay).toEqual(first);
    expect(competing).toEqual({ status: "REJECTED", reason: "OWNER_BUSY" });
    expect(authorization.exportPersistentState().voiceCalls).toHaveLength(1);
  });

  it("lets only the selected desktop confirm and enforces the desktop and media deadlines", () => {
    let now = Date.parse("2026-07-23T11:00:00.000Z");
    const authorization = new InMemoryDeviceAuthorizationModule({ now: () => now });
    const desktop = authorization.bootstrapOwner({ label: "家中 Mac" });
    const mobile = pairMobile(authorization, desktop.deviceCredential, "mobile-a");
    authorization.reportDesktopAvailability({
      authorizingCredential: desktop.deviceCredential,
      available: true,
    });
    const created = authorization.requestVoiceCall({
      authorizingCredential: mobile.deviceCredential,
      idempotencyKey: "call-attempt-confirm",
    });
    if (created.status !== "CALL_CREATED") throw new Error("expected call");

    const confirmed = authorization.confirmVoiceCall({
      authorizingCredential: desktop.deviceCredential,
      callId: created.call.callId,
      characterId: "cyrene",
      characterName: "昔涟",
    });
    expect(confirmed).toMatchObject({
      phase: "CONNECTING_MEDIA",
      characterId: "cyrene",
      characterName: "昔涟",
      mediaConnectDeadline: new Date(now + 30_000).toISOString(),
    });
    expect(authorization.confirmVoiceCall({
      authorizingCredential: desktop.deviceCredential,
      callId: created.call.callId,
      characterId: "cyrene",
      characterName: "昔涟",
    })).toEqual(confirmed);

    now += 30_001;
    expect(authorization.readVoiceCall({
      authorizingCredential: mobile.deviceCredential,
      callId: created.call.callId,
    })).toMatchObject({
      phase: "ENDED",
      terminationReason: "MEDIA_CONNECT_TIMEOUT",
    });
  });

  it("recovers only after every desktop availability lease expires, revokes old desktops, and rotates the recovery key", () => {
    let now = Date.parse("2026-07-23T16:00:00.000Z");
    const authorization = new InMemoryDeviceAuthorizationModule({ now: () => now });
    const ownerDesktop = authorization.bootstrapOwner({ label: "旧 Mac" });
    authorization.confirmOwnerRecoveryKey({
      authorizingCredential: ownerDesktop.deviceCredential,
      ownerRecoveryKey: ownerDesktop.ownerRecoveryKey,
    });
    const mobileInvitation = authorization.beginPairing({
      authorizingCredential: ownerDesktop.deviceCredential,
      targetKind: "MOBILE",
    });
    const mobileClaim = authorization.claimPairing({
      invitation: mobileInvitation.invitation,
      candidate: {
        installationId: "mobile-installation-before-recovery",
        kind: "MOBILE",
        label: "保留的 Android",
      },
    });
    authorization.decidePairing({
      authorizingCredential: ownerDesktop.deviceCredential,
      challengeId: mobileInvitation.challengeId,
      allow: true,
    });
    const mobileOutcome = authorization.readPairingOutcome({
      challengeId: mobileInvitation.challengeId,
      candidateReceipt: mobileClaim.candidateReceipt,
    });
    if (mobileOutcome.status !== "APPROVED") {
      throw new Error("expected mobile approval before recovery");
    }
    authorization.reportDesktopAvailability({
      authorizingCredential: ownerDesktop.deviceCredential,
      available: true,
    });

    const recoveryInput = {
      ownerRecoveryKey: ownerDesktop.ownerRecoveryKey,
      recoveryReceipt:
        "cy_rr_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      label: "新 Mac",
    };
    expect(() => authorization.recoverOwner(recoveryInput))
      .toThrow("OWNER_RECOVERY_DESKTOP_AVAILABLE");

    now += 45_001;
    const recovered = authorization.recoverOwner(recoveryInput);
    const duplicate = authorization.recoverOwner(recoveryInput);

    expect(recovered).toEqual(duplicate);
    expect(recovered).toMatchObject({
      device: { kind: "DESKTOP", label: "新 Mac", status: "ACTIVE" },
      deviceCredential: expect.stringMatching(/^cy_dc_/),
      ownerRecoveryKey: expect.stringMatching(/^cy_rk_/),
    });
    expect(recovered.ownerRecoveryKey).not.toBe(ownerDesktop.ownerRecoveryKey);
    expect(() => authorization.authorizeDevice(ownerDesktop.deviceCredential))
      .toThrow("DEVICE_AUTHORIZATION_REVOKED");
    expect(authorization.authorizeDevice(recovered.deviceCredential))
      .toMatchObject({ deviceId: recovered.device.deviceId, status: "ACTIVE" });
    expect(authorization.authorizeDevice(mobileOutcome.deviceCredential))
      .toMatchObject({ kind: "MOBILE", status: "ACTIVE" });
    expect(authorization.exportPersistentState().devices).toContainEqual(
      expect.objectContaining({
        deviceId: mobileOutcome.device.deviceId,
        requiresReviewAfterRecovery: true,
      }),
    );
    expect(() => authorization.recoverOwner({
      ...recoveryInput,
      recoveryReceipt:
        "cy_rr_abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    })).toThrow("OWNER_RECOVERY_KEY_INVALID");
    expect(() => authorization.beginPairing({
      authorizingCredential: recovered.deviceCredential,
      targetKind: "DESKTOP",
    })).toThrow("OWNER_RECOVERY_KEY_CONFIRMATION_REQUIRED");
  });

  it("shows the Owner Recovery Key once and requires its confirmation before adding a desktop", () => {
    const authorization = new InMemoryDeviceAuthorizationModule();
    const ownerDesktop = authorization.bootstrapOwner({ label: "家中 Mac" });

    expect(ownerDesktop.ownerRecoveryKey).toMatch(/^cy_rk_[A-Za-z0-9_-]{40,}$/);
    expect(JSON.stringify(authorization.exportPersistentState()))
      .not.toContain(ownerDesktop.ownerRecoveryKey ?? "missing-recovery-key");

    expect(() => authorization.beginPairing({
      authorizingCredential: ownerDesktop.deviceCredential,
      targetKind: "DESKTOP",
    })).toThrow("OWNER_RECOVERY_KEY_CONFIRMATION_REQUIRED");

    expect(authorization.confirmOwnerRecoveryKey({
      authorizingCredential: ownerDesktop.deviceCredential,
      ownerRecoveryKey: ownerDesktop.ownerRecoveryKey,
    })).toMatchObject({ status: "CONFIRMED" });

    expect(authorization.beginPairing({
      authorizingCredential: ownerDesktop.deviceCredential,
      targetKind: "DESKTOP",
    })).toMatchObject({ targetKind: "DESKTOP" });
  });

  it("keeps a scanned mobile installation as a candidate until the desktop approves it", () => {
    const authorization = new InMemoryDeviceAuthorizationModule();
    const ownerDesktop = authorization.bootstrapOwner({ label: "家中 Mac" });

    const invitation = authorization.beginPairing({
      authorizingCredential: ownerDesktop.deviceCredential,
      targetKind: "MOBILE",
    });
    const claim = authorization.claimPairing({
      invitation: invitation.invitation,
      candidate: {
        installationId: "mobile-installation-1",
        kind: "MOBILE",
        label: "Kano 的 Android",
      },
    });

    expect(claim).toMatchObject({
      challengeId: invitation.challengeId,
      status: "CLAIMED",
      candidate: {
        installationId: "mobile-installation-1",
        kind: "MOBILE",
        label: "Kano 的 Android",
      },
    });
    expect(claim.verificationCode).toMatch(/^\d{3} \d{3}$/);
    expect(claim).not.toHaveProperty("deviceCredential");
    expect(
      authorization.getAuthorizationSnapshot(ownerDesktop.deviceCredential).devices,
    ).toHaveLength(1);
  });

  it("creates one mobile device only after approval and delivers its credential only to the candidate", () => {
    const authorization = new InMemoryDeviceAuthorizationModule();
    const ownerDesktop = authorization.bootstrapOwner({ label: "家中 Mac" });
    const invitation = authorization.beginPairing({
      authorizingCredential: ownerDesktop.deviceCredential,
      targetKind: "MOBILE",
    });
    const claim = authorization.claimPairing({
      invitation: invitation.invitation,
      candidate: {
        installationId: "mobile-installation-1",
        kind: "MOBILE",
        label: "Kano 的 Android",
      },
    });

    const firstApproval = authorization.decidePairing({
      authorizingCredential: ownerDesktop.deviceCredential,
      challengeId: invitation.challengeId,
      allow: true,
    });
    const duplicateApproval = authorization.decidePairing({
      authorizingCredential: ownerDesktop.deviceCredential,
      challengeId: invitation.challengeId,
      allow: true,
    });
    const candidateOutcome = authorization.readPairingOutcome({
      challengeId: invitation.challengeId,
      candidateReceipt: claim.candidateReceipt,
    });

    expect(firstApproval).toMatchObject({ status: "APPROVED" });
    expect(firstApproval).not.toHaveProperty("deviceCredential");
    expect(duplicateApproval).toEqual(firstApproval);
    expect(candidateOutcome.status).toBe("APPROVED");
    if (firstApproval.status !== "APPROVED" || candidateOutcome.status !== "APPROVED") {
      throw new Error("expected an approved pairing");
    }
    expect(candidateOutcome).toMatchObject({
      status: "APPROVED",
      device: firstApproval.device,
    });
    expect(candidateOutcome.deviceCredential).toMatch(/^cy_dc_[A-Za-z0-9_-]{40,}$/);
    expect(
      authorization.getAuthorizationSnapshot(ownerDesktop.deviceCredential).devices,
    ).toHaveLength(2);
  });

  it("invalidates an older desktop challenge and expires the replacement after two minutes", () => {
    let now = Date.parse("2026-07-23T04:00:00.000Z");
    const authorization = new InMemoryDeviceAuthorizationModule({ now: () => now });
    const ownerDesktop = authorization.bootstrapOwner({ label: "家中 Mac" });
    const first = authorization.beginPairing({
      authorizingCredential: ownerDesktop.deviceCredential,
      targetKind: "MOBILE",
    });
    const replacement = authorization.beginPairing({
      authorizingCredential: ownerDesktop.deviceCredential,
      targetKind: "MOBILE",
    });
    const candidate = {
      installationId: "mobile-installation-1",
      kind: "MOBILE" as const,
      label: "Kano 的 Android",
    };

    expect(() => authorization.claimPairing({
      invitation: first.invitation,
      candidate,
    })).toThrow("PAIRING_CHALLENGE_INVALIDATED");

    now += 120_001;
    expect(() => authorization.claimPairing({
      invitation: replacement.invitation,
      candidate,
    })).toThrow("PAIRING_CHALLENGE_EXPIRED");
  });

  it("ends a challenge after five incorrect manual short-code attempts", () => {
    const authorization = new InMemoryDeviceAuthorizationModule();
    const ownerDesktop = authorization.bootstrapOwner({ label: "家中 Mac" });
    const invitation = authorization.beginPairing({
      authorizingCredential: ownerDesktop.deviceCredential,
      targetKind: "MOBILE",
    });
    const candidate = {
      installationId: "mobile-installation-1",
      kind: "MOBILE" as const,
      label: "Kano 的 Android",
    };
    const finalDigit = invitation.shortCode.endsWith("0") ? "1" : "0";
    const incorrectCode = `${invitation.shortCode.slice(0, -1)}${finalDigit}`;

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect(() => authorization.claimPairingWithShortCode({
        shortCode: incorrectCode,
        candidate,
      })).toThrow("PAIRING_SHORT_CODE_INVALID");
    }
    expect(() => authorization.claimPairingWithShortCode({
      shortCode: incorrectCode,
      candidate,
    })).toThrow("PAIRING_ATTEMPT_LIMITED");
    expect(() => authorization.claimPairing({
      invitation: invitation.invitation,
      candidate,
    })).toThrow("PAIRING_ATTEMPT_LIMITED");
  });

  it("refuses a sixth mobile device without replacing an existing device", () => {
    const authorization = new InMemoryDeviceAuthorizationModule();
    const ownerDesktop = authorization.bootstrapOwner({ label: "家中 Mac" });

    for (let index = 1; index <= 5; index += 1) {
      const invitation = authorization.beginPairing({
        authorizingCredential: ownerDesktop.deviceCredential,
        targetKind: "MOBILE",
      });
      authorization.claimPairing({
        invitation: invitation.invitation,
        candidate: {
          installationId: `mobile-installation-${index}`,
          kind: "MOBILE",
          label: `Android ${index}`,
        },
      });
      authorization.decidePairing({
        authorizingCredential: ownerDesktop.deviceCredential,
        challengeId: invitation.challengeId,
        allow: true,
      });
    }

    const overflow = authorization.beginPairing({
      authorizingCredential: ownerDesktop.deviceCredential,
      targetKind: "MOBILE",
    });
    authorization.claimPairing({
      invitation: overflow.invitation,
      candidate: {
        installationId: "mobile-installation-6",
        kind: "MOBILE",
        label: "Android 6",
      },
    });

    expect(() => authorization.decidePairing({
      authorizingCredential: ownerDesktop.deviceCredential,
      challengeId: overflow.challengeId,
      allow: true,
    })).toThrow("DEVICE_LIMIT_REACHED");
    expect(
      authorization.getAuthorizationSnapshot(ownerDesktop.deviceCredential).devices,
    ).toHaveLength(6);
  });

  it("revokes one mobile credential without affecting another device", () => {
    const authorization = new InMemoryDeviceAuthorizationModule();
    const ownerDesktop = authorization.bootstrapOwner({ label: "家中 Mac" });
    const invitation = authorization.beginPairing({
      authorizingCredential: ownerDesktop.deviceCredential,
      targetKind: "MOBILE",
    });
    const claim = authorization.claimPairing({
      invitation: invitation.invitation,
      candidate: {
        installationId: "mobile-installation-1",
        kind: "MOBILE",
        label: "Kano 的 Android",
      },
    });
    const approval = authorization.decidePairing({
      authorizingCredential: ownerDesktop.deviceCredential,
      challengeId: invitation.challengeId,
      allow: true,
    });
    const outcome = authorization.readPairingOutcome({
      challengeId: invitation.challengeId,
      candidateReceipt: claim.candidateReceipt,
    });
    if (approval.status !== "APPROVED" || outcome.status !== "APPROVED") {
      throw new Error("expected an approved pairing");
    }

    expect(authorization.authorizeDevice(outcome.deviceCredential)).toMatchObject({
      deviceId: approval.device.deviceId,
      status: "ACTIVE",
    });
    authorization.revokeDevice({
      authorizingCredential: ownerDesktop.deviceCredential,
      deviceId: approval.device.deviceId,
    });

    expect(() => authorization.authorizeDevice(outcome.deviceCredential))
      .toThrow("DEVICE_AUTHORIZATION_REVOKED");
    expect(authorization.authorizeDevice(ownerDesktop.deviceCredential))
      .toMatchObject({ deviceId: ownerDesktop.deviceId, status: "ACTIVE" });
  });

  it("continues one pairing across process restarts without persisting plaintext secrets", () => {
    const firstProcess = new InMemoryDeviceAuthorizationModule();
    const ownerDesktop = firstProcess.bootstrapOwner({ label: "家中 Mac" });
    const invitation = firstProcess.beginPairing({
      authorizingCredential: ownerDesktop.deviceCredential,
      targetKind: "MOBILE",
    });
    const claim = firstProcess.claimPairing({
      invitation: invitation.invitation,
      candidateReceipt:
        "cy_pr_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      candidate: {
        installationId: "mobile-installation-1",
        kind: "MOBILE",
        label: "Kano 的 Android",
      },
    });
    const claimedState = firstProcess.exportPersistentState();
    expect(JSON.stringify(claimedState)).not.toContain(ownerDesktop.deviceCredential);
    expect(JSON.stringify(claimedState)).not.toContain(invitation.invitation);
    expect(JSON.stringify(claimedState)).not.toContain(claim.candidateReceipt);

    const approvalProcess = new InMemoryDeviceAuthorizationModule({
      persistentState: claimedState,
    });
    approvalProcess.decidePairing({
      authorizingCredential: ownerDesktop.deviceCredential,
      challengeId: invitation.challengeId,
      allow: true,
    });
    const approvedState = approvalProcess.exportPersistentState();
    expect(JSON.stringify(approvedState)).not.toContain(claim.verificationCode);
    expect(JSON.stringify(approvedState)).not.toContain(invitation.shortCode);

    const outcomeProcess = new InMemoryDeviceAuthorizationModule({
      persistentState: approvedState,
    });
    const outcome = outcomeProcess.readPairingOutcome({
      challengeId: invitation.challengeId,
      candidateReceipt: claim.candidateReceipt,
    });
    expect(outcome).toMatchObject({
      status: "APPROVED",
      device: { kind: "MOBILE", label: "Kano 的 Android" },
      deviceCredential: expect.stringMatching(/^cy_dc_/),
    });
    const issuedState = outcomeProcess.exportPersistentState();
    expect(JSON.stringify(issuedState)).not.toContain(
      outcome.status === "APPROVED" ? outcome.deviceCredential : "unexpected",
    );
    expect(JSON.stringify(issuedState)).not.toContain("encryptedCredential");
  });
});
