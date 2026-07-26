import { describe, expect, it } from "vitest";
import {
  InMemoryDeviceAuthorizationAggregateStore,
  PersistentDeviceAuthorizationModule,
} from "./persistent-device-authorization";

describe("Persistent Device Authorization Module", () => {
  it("keeps pairing state across independent function instances and approves atomically", async () => {
    const store = new InMemoryDeviceAuthorizationAggregateStore();
    const bootstrapFunction = new PersistentDeviceAuthorizationModule({
      store,
    });
    const desktop = await bootstrapFunction.bootstrapOwner({ label: "家中 Mac" });
    const invitation = await bootstrapFunction.beginPairing({
      authorizingCredential: desktop.deviceCredential,
      targetKind: "MOBILE",
    });

    const claimFunction = new PersistentDeviceAuthorizationModule({
      store,
    });
    const claim = await claimFunction.claimPairing({
      challengeId: invitation.challengeId,
      invitation: invitation.invitation,
      candidateReceipt:
        "cy_pr_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      candidate: {
        installationId: "mobile-installation-1",
        kind: "MOBILE",
        label: "Kano 的 Android",
      },
    });

    const approvalFunctionA = new PersistentDeviceAuthorizationModule({
      store,
    });
    const approvalFunctionB = new PersistentDeviceAuthorizationModule({
      store,
    });
    const [first, retry] = await Promise.all([
      approvalFunctionA.decidePairing({
        authorizingCredential: desktop.deviceCredential,
        challengeId: invitation.challengeId,
        allow: true,
      }),
      approvalFunctionB.decidePairing({
        authorizingCredential: desktop.deviceCredential,
        challengeId: invitation.challengeId,
        allow: true,
      }),
    ]);
    expect(retry).toEqual(first);

    const outcomeFunction = new PersistentDeviceAuthorizationModule({
      store,
    });
    const outcome = await outcomeFunction.readPairingOutcome({
      challengeId: invitation.challengeId,
      candidateReceipt: claim.candidateReceipt,
    });
    expect(outcome).toMatchObject({
      status: "APPROVED",
      device: { kind: "MOBILE", label: "Kano 的 Android" },
      deviceCredential: expect.stringMatching(/^cy_dc_/),
    });
    const snapshot = await outcomeFunction.getAuthorizationSnapshot(
      desktop.deviceCredential,
    );
    expect(snapshot.devices).toHaveLength(2);
  });
});
