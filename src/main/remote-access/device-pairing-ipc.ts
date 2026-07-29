import { IPC } from "../../shared/ipc-channels";
import type {
  DesktopDeviceAuthorizationStatus,
  DesktopPairingChallengeDisplay,
  DesktopPairingReviewDisplay,
} from "../../shared/device-pairing";
import type { DesktopDeviceAuthorizationClient } from "./desktop-device-authorization-client";

interface IpcMainLike {
  handle(
    channel: string,
    handler: (event: unknown, input?: unknown) => Promise<unknown>,
  ): unknown;
}

type PairingClient = Pick<
  DesktopDeviceAuthorizationClient,
  | "getLocalStatus"
  | "bootstrapOwner"
  | "confirmOwnerRecoveryKey"
  | "recoverOwner"
  | "beginMobilePairing"
  | "reviewPairing"
  | "decidePairing"
>;

export function registerDevicePairingIpc(options: {
  ipcMain: IpcMainLike;
  client: PairingClient;
  toDataUrl(
    value: string,
    options: {
      width: number;
      margin: number;
      errorCorrectionLevel: string;
    },
  ): Promise<string>;
}): void {
  options.ipcMain.handle(
    IPC.DEVICE_AUTHORIZATION_STATUS,
    async (): Promise<DesktopDeviceAuthorizationStatus> =>
      options.client.getLocalStatus(),
  );
  options.ipcMain.handle(
    IPC.OWNER_BOOTSTRAP,
    async (_event, rawInput) => {
      const input = requireBootstrapInput(rawInput);
      return options.client.bootstrapOwner(input);
    },
  );
  options.ipcMain.handle(
    IPC.OWNER_RECOVERY_CONFIRM,
    async (_event, rawInput) => {
      const ownerRecoveryKey = requireOwnerRecoveryKey(rawInput);
      return options.client.confirmOwnerRecoveryKey(ownerRecoveryKey);
    },
  );
  options.ipcMain.handle(
    IPC.OWNER_RECOVER,
    async (_event, rawInput) => {
      const input = requireRecoveryInput(rawInput);
      return options.client.recoverOwner(input);
    },
  );
  options.ipcMain.handle(
    IPC.DEVICE_PAIRING_BEGIN,
    async (): Promise<DesktopPairingChallengeDisplay> => {
      const challenge = await options.client.beginMobilePairing();
      const qrDataUrl = await options.toDataUrl(challenge.pairingLink, {
        width: 260,
        margin: 1,
        errorCorrectionLevel: "M",
      });
      return {
        challengeId: challenge.challengeId,
        qrDataUrl,
        shortCode: challenge.shortCode,
        expiresAt: challenge.expiresAt,
      };
    },
  );
  options.ipcMain.handle(
    IPC.DEVICE_PAIRING_REVIEW,
    async (_event, rawInput): Promise<DesktopPairingReviewDisplay> => {
      const challengeId = requireChallengeId(rawInput);
      const review = await options.client.reviewPairing(challengeId);
      if (review.status !== "CLAIMED") return review;
      return {
        status: "CLAIMED",
        candidate: {
          kind: review.candidate.kind,
          label: review.candidate.label,
        },
        verificationCode: review.verificationCode,
        expiresAt: review.expiresAt,
      };
    },
  );
  options.ipcMain.handle(
    IPC.DEVICE_PAIRING_DECIDE,
    async (_event, rawInput) => {
      const input = requireDecision(rawInput);
      return options.client.decidePairing(input.challengeId, input.allow);
    },
  );
}

function requireBootstrapInput(input: unknown): {
  controlPlaneOrigin: string;
  deploymentBootstrapCode: string;
  label: string;
} {
  if (!input || typeof input !== "object") {
    throw new Error("OWNER_BOOTSTRAP_INPUT_INVALID");
  }
  const record = input as Record<string, unknown>;
  return {
    controlPlaneOrigin: requireInputString(
      record.controlPlaneOrigin,
      "CONTROL_PLANE_ORIGIN_INVALID",
    ),
    deploymentBootstrapCode: requireInputString(
      record.deploymentBootstrapCode,
      "DEPLOYMENT_BOOTSTRAP_CODE_INVALID",
    ),
    label: requireInputString(record.label, "DEVICE_LABEL_INVALID"),
  };
}

function requireOwnerRecoveryKey(input: unknown): string {
  if (!input || typeof input !== "object") {
    throw new Error("OWNER_RECOVERY_KEY_INVALID");
  }
  return requireInputString(
    (input as Record<string, unknown>).ownerRecoveryKey,
    "OWNER_RECOVERY_KEY_INVALID",
  );
}

function requireRecoveryInput(input: unknown): {
  controlPlaneOrigin: string;
  ownerRecoveryKey: string;
  label: string;
} {
  if (!input || typeof input !== "object") {
    throw new Error("OWNER_RECOVERY_INPUT_INVALID");
  }
  const record = input as Record<string, unknown>;
  return {
    controlPlaneOrigin: requireInputString(
      record.controlPlaneOrigin,
      "CONTROL_PLANE_ORIGIN_INVALID",
    ),
    ownerRecoveryKey: requireInputString(
      record.ownerRecoveryKey,
      "OWNER_RECOVERY_KEY_INVALID",
    ),
    label: requireInputString(record.label, "DEVICE_LABEL_INVALID"),
  };
}

function requireInputString(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
}

function requireChallengeId(input: unknown): string {
  if (!input || typeof input !== "object") {
    throw new Error("PAIRING_CHALLENGE_NOT_FOUND");
  }
  const challengeId = (input as Record<string, unknown>).challengeId;
  if (typeof challengeId !== "string" || !challengeId.trim()) {
    throw new Error("PAIRING_CHALLENGE_NOT_FOUND");
  }
  return challengeId.trim();
}

function requireDecision(input: unknown): {
  challengeId: string;
  allow: boolean;
} {
  const challengeId = requireChallengeId(input);
  const allow = (input as Record<string, unknown>).allow;
  if (typeof allow !== "boolean") throw new Error("PAIRING_DECISION_INVALID");
  return { challengeId, allow };
}
