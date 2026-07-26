import type {
  AuthorizedDeviceSummary,
} from "../main/remote-access/device-authorization";

export type DesktopDeviceAuthorizationStatus =
  | { status: "not-paired" | "corrupt" }
  | { status: "paired"; deviceId: string; controlPlaneOrigin: string };

export interface DesktopOwnerBootstrapDisplay {
  deviceId: string;
  controlPlaneOrigin: string;
  ownerRecoveryKey: string;
}

export interface DesktopOwnerRecoveryConfirmation {
  status: "CONFIRMED";
  confirmedAt: string;
}

export interface DesktopPairingChallengeDisplay {
  challengeId: string;
  qrDataUrl: string;
  shortCode: string;
  expiresAt: string;
}

export type DesktopPairingReviewDisplay =
  | { status: "OPEN"; expiresAt: string }
  | {
    status: "CLAIMED";
    candidate: {
      kind: "DESKTOP" | "MOBILE";
      label: string;
    };
    verificationCode: string;
    expiresAt: string;
  }
  | { status: "APPROVED"; device: AuthorizedDeviceSummary }
  | { status: "REJECTED" | "EXPIRED" | "INVALIDATED" | "ATTEMPT_LIMITED" };
