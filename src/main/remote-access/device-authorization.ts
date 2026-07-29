import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
} from "node:crypto";
import type { EncryptedMediaGrantEnvelope } from "./media-grant-envelope";

export type DeviceKind = "DESKTOP" | "MOBILE";

export interface AuthorizedDeviceSummary {
  deviceId: string;
  kind: DeviceKind;
  label: string;
  status: "ACTIVE" | "REVOKED" | "EXPIRED" | "INVALIDATED";
  pairedAt: string;
}

export interface PairingCandidateSummary {
  installationId: string;
  kind: DeviceKind;
  label: string;
}

export interface PairingInvitation {
  challengeId: string;
  invitation: string;
  shortCode: string;
  targetKind: DeviceKind;
  expiresAt: string;
}

export interface PairingClaim {
  challengeId: string;
  status: "CLAIMED";
  candidate: PairingCandidateSummary;
  verificationCode: string;
  expiresAt: string;
  candidateReceipt: string;
}

export type PairingReview =
  | { status: "OPEN"; expiresAt: string }
  | {
    status: "CLAIMED";
    candidate: PairingCandidateSummary;
    verificationCode: string;
    expiresAt: string;
  }
  | { status: "APPROVED"; device: AuthorizedDeviceSummary }
  | { status: "REJECTED" | "EXPIRED" | "INVALIDATED" | "ATTEMPT_LIMITED" };

export interface AuthorizedDeviceRecord extends AuthorizedDeviceSummary {
  credentialHash?: string;
  availableUntilMs?: number;
  requiresReviewAfterRecovery?: boolean;
}

export interface LastOwnerRecoveryRecord {
  usedRecoveryKeyHash: string;
  recoveryReceiptHash: string;
  recoveredDesktopId: string;
}

export interface PairingChallengeRecord {
  challengeId: string;
  creatorDesktopId: string;
  invitationHash?: string;
  targetKind: DeviceKind;
  status:
    | "OPEN"
    | "CLAIMED"
    | "APPROVED"
    | "REJECTED"
    | "EXPIRED"
    | "INVALIDATED"
    | "ATTEMPT_LIMITED";
  expiresAtMs: number;
  shortCodeRoute: string;
  shortCodeHash?: string;
  incorrectShortCodeAttempts: number;
  candidate?: PairingCandidateSummary;
  verificationCode?: string;
  candidateReceiptHash?: string;
  approvedDeviceId?: string;
}

export type VoiceCallPhase =
  | "AWAITING_DESKTOP"
  | "CONNECTING_MEDIA"
  | "ACTIVE"
  | "RECONNECTING"
  | "ENDED";

export type CallRejectionReason =
  | "DEVICE_NOT_AUTHORIZED"
  | "DESKTOP_UNAVAILABLE"
  | "OWNER_BUSY"
  | "COST_PROTECTION"
  | "MEDIA_CAPACITY_UNAVAILABLE";

export type CallTerminationReason =
  | "CALLER_CANCELLED"
  | "PARTICIPANT_HUNG_UP"
  | "REPLACED_BY_SAME_DEVICE"
  | "DESKTOP_CONFIRM_TIMEOUT"
  | "DESKTOP_UNAVAILABLE"
  | "MEDIA_CONNECT_TIMEOUT"
  | "E2EE_REQUIRED"
  | "MEDIA_CAPACITY_UNAVAILABLE"
  | "RECONNECT_TIMEOUT"
  | "DEVICE_REVOKED"
  | "AUTHORIZATION_REBOOTSTRAP"
  | "BACKGROUND_TIMEOUT"
  | "IDLE_TIMEOUT"
  | "MAX_DURATION"
  | "RUNTIME_FAILURE_LIMIT";

export interface VoiceCallRecord {
  callId: string;
  mobileDeviceId: string;
  desktopDeviceId: string;
  phase: VoiceCallPhase;
  createdAtMs: number;
  desktopConfirmDeadlineMs: number;
  mediaConnectDeadlineMs?: number;
  activeAtMs?: number;
  reconnectDeadlineMs?: number;
  lastValidVoiceInteractionAtMs?: number;
  characterId?: string;
  characterName?: string;
  terminationReason?: CallTerminationReason;
  endedAtMs?: number;
  mediaGrantExpiresAtMs?: number;
  mobileMediaGrantEnvelope?: EncryptedMediaGrantEnvelope;
  desktopMediaGrantEnvelope?: EncryptedMediaGrantEnvelope;
  mobileMediaReady?: boolean;
  desktopMediaReady?: boolean;
}

export interface VoiceCallIdempotencyRecord {
  mobileDeviceId: string;
  idempotencyKeyHash: string;
  createdAtMs: number;
  callId?: string;
  rejectionReason?: CallRejectionReason;
}

export interface VoiceCallView {
  callId: string;
  mobileDeviceId: string;
  desktopDeviceId: string;
  phase: VoiceCallPhase;
  createdAt: string;
  desktopConfirmDeadline: string;
  mediaConnectDeadline?: string;
  activeAt?: string;
  reconnectDeadline?: string;
  characterId?: string;
  characterName?: string;
  terminationReason?: CallTerminationReason;
  endedAt?: string;
}

export type VoiceCallRequestResult =
  | { status: "REJECTED"; reason: CallRejectionReason }
  | { status: "CALL_CREATED"; call: VoiceCallView };

export interface DeviceAuthorizationPersistentState {
  version: 1;
  revision: number;
  ownerBootstrapped: boolean;
  ownerRecoveryKeyHash?: string;
  ownerRecoveryKeyConfirmedAt?: string;
  lastOwnerRecovery?: LastOwnerRecoveryRecord;
  devices: AuthorizedDeviceRecord[];
  challenges: PairingChallengeRecord[];
  voiceCalls?: VoiceCallRecord[];
  voiceCallIdempotency?: VoiceCallIdempotencyRecord[];
}

const PAIRING_TTL_MS = 2 * 60 * 1000;
const DESKTOP_AVAILABILITY_TTL_MS = 45 * 1000;
const DESKTOP_CONFIRM_TTL_MS = 10 * 1000;
const MEDIA_CONNECT_TTL_MS = 30 * 1000;

function hashSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

function createSecret(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

function normalizeLabel(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 64) {
    throw new Error("DEVICE_LABEL_INVALID");
  }
  return normalized;
}

function normalizeInstallationId(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 128) {
    throw new Error("INSTALLATION_ID_INVALID");
  }
  return normalized;
}

function normalizeIdempotencyKey(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 16
    || normalized.length > 128
    || !/^[A-Za-z0-9._:-]+$/.test(normalized)
  ) {
    throw new Error("CALL_IDEMPOTENCY_KEY_INVALID");
  }
  return normalized;
}

function normalizeCharacterField(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 128) throw new Error(code);
  return normalized;
}

export class InMemoryDeviceAuthorizationModule {
  private readonly now: () => number;
  private readonly devices = new Map<string, AuthorizedDeviceRecord>();
  private readonly deviceIdByCredentialHash = new Map<string, string>();
  private readonly challenges = new Map<string, PairingChallengeRecord>();
  private readonly voiceCalls = new Map<string, VoiceCallRecord>();
  private readonly voiceCallIdempotency = new Map<string, VoiceCallIdempotencyRecord>();
  private ownerBootstrapped = false;
  private ownerRecoveryKeyHash?: string;
  private ownerRecoveryKeyConfirmedAt?: string;
  private lastOwnerRecovery?: LastOwnerRecoveryRecord;
  private persistentRevision = 0;

  constructor(options: {
    now?: () => number;
    persistentState?: DeviceAuthorizationPersistentState;
  } = {}) {
    this.now = options.now ?? Date.now;
    if (options.persistentState) {
      this.restorePersistentState(options.persistentState);
    }
  }

  bootstrapOwner(input: { label: string }): AuthorizedDeviceSummary & {
    deviceCredential: string;
    ownerRecoveryKey: string;
  } {
    if (this.ownerBootstrapped) {
      throw new Error("OWNER_ALREADY_BOOTSTRAPPED");
    }
    const deviceCredential = createSecret("cy_dc");
    const ownerRecoveryKey = createSecret("cy_rk");
    const device: AuthorizedDeviceRecord = {
      deviceId: randomUUID(),
      kind: "DESKTOP",
      label: normalizeLabel(input.label),
      status: "ACTIVE",
      pairedAt: new Date(this.now()).toISOString(),
      credentialHash: hashSecret(deviceCredential),
    };
    this.ownerBootstrapped = true;
    this.ownerRecoveryKeyHash = hashSecret(ownerRecoveryKey);
    this.devices.set(device.deviceId, device);
    this.deviceIdByCredentialHash.set(hashSecret(deviceCredential), device.deviceId);
    return {
      deviceId: device.deviceId,
      kind: device.kind,
      label: device.label,
      status: device.status,
      pairedAt: device.pairedAt,
      deviceCredential,
      ownerRecoveryKey,
    };
  }

  confirmOwnerRecoveryKey(input: {
    authorizingCredential: string;
    ownerRecoveryKey: string;
  }): { status: "CONFIRMED"; confirmedAt: string } {
    this.requireActiveDesktop(input.authorizingCredential);
    if (
      !this.ownerRecoveryKeyHash
      || hashSecret(input.ownerRecoveryKey) !== this.ownerRecoveryKeyHash
    ) {
      throw new Error("OWNER_RECOVERY_KEY_INVALID");
    }
    this.ownerRecoveryKeyConfirmedAt ??= new Date(this.now()).toISOString();
    this.lastOwnerRecovery = undefined;
    return {
      status: "CONFIRMED",
      confirmedAt: this.ownerRecoveryKeyConfirmedAt,
    };
  }

  reportDesktopAvailability(input: {
    authorizingCredential: string;
    available: boolean;
  }): { status: "AVAILABLE" | "UNAVAILABLE"; availableUntil?: string } {
    const desktop = this.requireActiveDesktop(input.authorizingCredential);
    if (!input.available) {
      desktop.availableUntilMs = undefined;
      return { status: "UNAVAILABLE" };
    }
    desktop.availableUntilMs = this.now() + DESKTOP_AVAILABILITY_TTL_MS;
    return {
      status: "AVAILABLE",
      availableUntil: new Date(desktop.availableUntilMs).toISOString(),
    };
  }

  requestVoiceCall(input: {
    authorizingCredential: string;
    idempotencyKey: string;
    replaceOwnedCall?: boolean;
  }): VoiceCallRequestResult {
    this.sweepVoiceCallDeadlines();
    const mobile = this.requireActiveMobile(input.authorizingCredential);
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
    const idempotencyKeyHash = hashSecret(idempotencyKey);
    const replayKey = `${mobile.deviceId}:${idempotencyKeyHash}`;
    const replay = this.voiceCallIdempotency.get(replayKey);
    if (replay?.callId) {
      const call = this.voiceCalls.get(replay.callId);
      if (!call) throw new Error("VOICE_CALL_STATE_INVALID");
      return { status: "CALL_CREATED", call: this.toVoiceCallView(call) };
    }
    if (replay?.rejectionReason) {
      return { status: "REJECTED", reason: replay.rejectionReason };
    }

    const rememberRejection = (
      reason: CallRejectionReason,
    ): VoiceCallRequestResult => {
      this.voiceCallIdempotency.set(replayKey, {
        mobileDeviceId: mobile.deviceId,
        idempotencyKeyHash,
        createdAtMs: this.now(),
        rejectionReason: reason,
      });
      return { status: "REJECTED", reason };
    };

    if (mobile.requiresReviewAfterRecovery) {
      return rememberRejection("DEVICE_NOT_AUTHORIZED");
    }
    const activeCalls = [...this.voiceCalls.values()].filter(
      (call) => call.phase !== "ENDED",
    );
    if (activeCalls.length > 0) {
      const canReplaceOwnedCalls = input.replaceOwnedCall === true
        && activeCalls.every((call) => call.mobileDeviceId === mobile.deviceId);
      if (!canReplaceOwnedCalls) return rememberRejection("OWNER_BUSY");
      for (const call of activeCalls) {
        this.endVoiceCall(call, "REPLACED_BY_SAME_DEVICE");
      }
    }

    const desktop = [...this.devices.values()].find(
      (device) =>
        device.kind === "DESKTOP"
        && device.status === "ACTIVE"
        && typeof device.availableUntilMs === "number"
        && device.availableUntilMs > this.now(),
    );
    if (!desktop) return rememberRejection("DESKTOP_UNAVAILABLE");

    const call: VoiceCallRecord = {
      callId: randomUUID(),
      mobileDeviceId: mobile.deviceId,
      desktopDeviceId: desktop.deviceId,
      phase: "AWAITING_DESKTOP",
      createdAtMs: this.now(),
      desktopConfirmDeadlineMs: this.now() + DESKTOP_CONFIRM_TTL_MS,
    };
    this.voiceCalls.set(call.callId, call);
    this.voiceCallIdempotency.set(replayKey, {
      mobileDeviceId: mobile.deviceId,
      idempotencyKeyHash,
      createdAtMs: this.now(),
      callId: call.callId,
    });
    return { status: "CALL_CREATED", call: this.toVoiceCallView(call) };
  }

  confirmVoiceCall(input: {
    authorizingCredential: string;
    callId: string;
    characterId: string;
    characterName: string;
  }): VoiceCallView {
    this.sweepVoiceCallDeadlines();
    const desktop = this.requireActiveDesktop(input.authorizingCredential);
    const call = this.voiceCalls.get(input.callId);
    if (!call || call.desktopDeviceId !== desktop.deviceId) {
      throw new Error("VOICE_CALL_NOT_FOUND");
    }
    if (call.phase !== "AWAITING_DESKTOP") {
      return this.toVoiceCallView(call);
    }
    if (
      typeof desktop.availableUntilMs !== "number"
      || desktop.availableUntilMs <= this.now()
    ) {
      this.endVoiceCall(call, "DESKTOP_UNAVAILABLE");
      return this.toVoiceCallView(call);
    }
    call.phase = "CONNECTING_MEDIA";
    call.characterId = normalizeCharacterField(input.characterId, "CHARACTER_ID_INVALID");
    call.characterName = normalizeCharacterField(
      input.characterName,
      "CHARACTER_NAME_INVALID",
    );
    call.mediaConnectDeadlineMs = this.now() + MEDIA_CONNECT_TTL_MS;
    return this.toVoiceCallView(call);
  }

  readVoiceCall(input: {
    authorizingCredential: string;
    callId: string;
  }): VoiceCallView {
    this.sweepVoiceCallDeadlines();
    const device = this.requireActiveDevice(input.authorizingCredential);
    const call = this.voiceCalls.get(input.callId);
    if (
      !call
      || (call.mobileDeviceId !== device.deviceId
        && call.desktopDeviceId !== device.deviceId)
    ) {
      throw new Error("VOICE_CALL_NOT_FOUND");
    }
    return this.toVoiceCallView(call);
  }

  readPendingDesktopVoiceCall(input: {
    authorizingCredential: string;
  }): VoiceCallView | null {
    this.sweepVoiceCallDeadlines();
    const desktop = this.requireActiveDesktop(input.authorizingCredential);
    const call = [...this.voiceCalls.values()].find(
      (candidate) =>
        candidate.desktopDeviceId === desktop.deviceId
        && candidate.phase !== "ENDED",
    );
    return call ? this.toVoiceCallView(call) : null;
  }

  attachMediaGrantEnvelopes(input: {
    authorizingCredential: string;
    callId: string;
    expiresAtMs: number;
    mobileEnvelope: EncryptedMediaGrantEnvelope;
    desktopEnvelope: EncryptedMediaGrantEnvelope;
  }): VoiceCallView {
    this.sweepVoiceCallDeadlines();
    const desktop = this.requireActiveDesktop(input.authorizingCredential);
    const call = this.voiceCalls.get(input.callId);
    if (!call || call.desktopDeviceId !== desktop.deviceId) {
      throw new Error("VOICE_CALL_NOT_FOUND");
    }
    if (call.phase !== "CONNECTING_MEDIA") {
      throw new Error("MEDIA_GRANT_NOT_AVAILABLE");
    }
    if (call.mobileMediaGrantEnvelope || call.desktopMediaGrantEnvelope) {
      return this.toVoiceCallView(call);
    }
    if (
      !Number.isSafeInteger(input.expiresAtMs)
      || input.expiresAtMs <= this.now()
      || (typeof call.mediaConnectDeadlineMs === "number"
        && input.expiresAtMs > call.mediaConnectDeadlineMs)
      || input.mobileEnvelope.expiresAtMs !== input.expiresAtMs
      || input.desktopEnvelope.expiresAtMs !== input.expiresAtMs
    ) {
      throw new Error("MEDIA_GRANT_ENVELOPE_INVALID");
    }
    call.mediaGrantExpiresAtMs = input.expiresAtMs;
    call.mobileMediaGrantEnvelope = structuredClone(input.mobileEnvelope);
    call.desktopMediaGrantEnvelope = structuredClone(input.desktopEnvelope);
    return this.toVoiceCallView(call);
  }

  takeMediaGrantEnvelope(input: {
    authorizingCredential: string;
    callId: string;
  }): {
    callId: string;
    endpointDeviceId: string;
    endpointKind: DeviceKind;
    expiresAtMs: number;
    envelope: EncryptedMediaGrantEnvelope;
  } {
    this.sweepVoiceCallDeadlines();
    const device = this.requireActiveDevice(input.authorizingCredential);
    const call = this.voiceCalls.get(input.callId);
    if (
      !call
      || (call.mobileDeviceId !== device.deviceId
        && call.desktopDeviceId !== device.deviceId)
    ) {
      throw new Error("VOICE_CALL_NOT_FOUND");
    }
    if (
      call.phase !== "CONNECTING_MEDIA"
      || typeof call.mediaGrantExpiresAtMs !== "number"
      || call.mediaGrantExpiresAtMs <= this.now()
    ) {
      throw new Error("MEDIA_GRANT_NOT_AVAILABLE");
    }
    const envelope = device.kind === "MOBILE"
      ? call.mobileMediaGrantEnvelope
      : call.desktopMediaGrantEnvelope;
    if (!envelope) throw new Error("MEDIA_GRANT_ALREADY_CLAIMED");
    if (device.kind === "MOBILE") {
      call.mobileMediaGrantEnvelope = undefined;
    } else {
      call.desktopMediaGrantEnvelope = undefined;
    }
    return {
      callId: call.callId,
      endpointDeviceId: device.deviceId,
      endpointKind: device.kind,
      expiresAtMs: call.mediaGrantExpiresAtMs,
      envelope: structuredClone(envelope),
    };
  }

  reportVoiceCallMediaReady(input: {
    authorizingCredential: string;
    callId: string;
  }): VoiceCallView {
    this.sweepVoiceCallDeadlines();
    const device = this.requireActiveDevice(input.authorizingCredential);
    const call = this.voiceCalls.get(input.callId);
    if (
      !call
      || (call.mobileDeviceId !== device.deviceId
        && call.desktopDeviceId !== device.deviceId)
    ) {
      throw new Error("VOICE_CALL_NOT_FOUND");
    }
    if (call.phase === "ACTIVE") return this.toVoiceCallView(call);
    if (call.phase !== "CONNECTING_MEDIA") {
      throw new Error("VOICE_CALL_MEDIA_STATE_INVALID");
    }
    if (device.kind === "MOBILE") call.mobileMediaReady = true;
    else call.desktopMediaReady = true;
    if (call.mobileMediaReady && call.desktopMediaReady) {
      call.phase = "ACTIVE";
      call.activeAtMs = this.now();
      call.lastValidVoiceInteractionAtMs = this.now();
      call.mobileMediaGrantEnvelope = undefined;
      call.desktopMediaGrantEnvelope = undefined;
      call.mediaGrantExpiresAtMs = undefined;
    }
    return this.toVoiceCallView(call);
  }

  terminateVoiceCall(input: {
    authorizingCredential: string;
    callId: string;
    reason: CallTerminationReason;
  }): VoiceCallView {
    const device = this.requireActiveDevice(input.authorizingCredential);
    const call = this.voiceCalls.get(input.callId);
    if (
      !call
      || (call.mobileDeviceId !== device.deviceId
        && call.desktopDeviceId !== device.deviceId)
    ) {
      throw new Error("VOICE_CALL_NOT_FOUND");
    }
    this.endVoiceCall(call, input.reason);
    return this.toVoiceCallView(call);
  }

  recoverOwner(input: {
    ownerRecoveryKey: string;
    recoveryReceipt: string;
    label: string;
  }): {
    device: AuthorizedDeviceSummary;
    deviceCredential: string;
    ownerRecoveryKey: string;
  } {
    const ownerRecoveryKey = requireSecret(
      input.ownerRecoveryKey,
      /^cy_rk_[A-Za-z0-9_-]{40,}$/,
      "OWNER_RECOVERY_KEY_INVALID",
    );
    const recoveryReceipt = requireSecret(
      input.recoveryReceipt,
      /^cy_rr_[A-Za-z0-9_-]{40,}$/,
      "OWNER_RECOVERY_RECEIPT_INVALID",
    );
    const usedRecoveryKeyHash = hashSecret(ownerRecoveryKey);
    const recoveryReceiptHash = hashSecret(recoveryReceipt);

    if (
      this.lastOwnerRecovery
      && this.lastOwnerRecovery.usedRecoveryKeyHash === usedRecoveryKeyHash
      && this.lastOwnerRecovery.recoveryReceiptHash === recoveryReceiptHash
    ) {
      return this.ownerRecoveryResult(
        ownerRecoveryKey,
        recoveryReceipt,
        this.lastOwnerRecovery.recoveredDesktopId,
      );
    }
    if (
      !this.ownerBootstrapped
      || !this.ownerRecoveryKeyConfirmedAt
      || !this.ownerRecoveryKeyHash
      || this.ownerRecoveryKeyHash !== usedRecoveryKeyHash
    ) {
      throw new Error("OWNER_RECOVERY_KEY_INVALID");
    }
    const hasAvailableDesktop = [...this.devices.values()].some(
      (device) =>
        device.kind === "DESKTOP"
        && device.status === "ACTIVE"
        && typeof device.availableUntilMs === "number"
        && device.availableUntilMs > this.now(),
    );
    if (hasAvailableDesktop) {
      throw new Error("OWNER_RECOVERY_DESKTOP_AVAILABLE");
    }

    for (const device of this.devices.values()) {
      if (device.kind === "DESKTOP" && device.status === "ACTIVE") {
        device.status = "REVOKED";
        device.availableUntilMs = undefined;
      }
      if (device.kind === "MOBILE" && device.status === "ACTIVE") {
        device.requiresReviewAfterRecovery = true;
      }
    }
    for (const challenge of this.challenges.values()) {
      if (challenge.status === "OPEN" || challenge.status === "CLAIMED") {
        challenge.status = "INVALIDATED";
        this.clearTerminalPairingSecrets(challenge);
      }
    }

    const deviceId = randomUUID();
    const result = this.ownerRecoveryResult(
      ownerRecoveryKey,
      recoveryReceipt,
      deviceId,
      normalizeLabel(input.label),
    );
    const credentialHash = hashSecret(result.deviceCredential);
    this.devices.set(deviceId, {
      ...result.device,
      credentialHash,
    });
    this.deviceIdByCredentialHash.set(credentialHash, deviceId);
    this.ownerRecoveryKeyHash = hashSecret(result.ownerRecoveryKey);
    this.ownerRecoveryKeyConfirmedAt = undefined;
    this.lastOwnerRecovery = {
      usedRecoveryKeyHash,
      recoveryReceiptHash,
      recoveredDesktopId: deviceId,
    };
    return result;
  }

  beginPairing(input: {
    authorizingCredential: string;
    targetKind: DeviceKind;
  }): PairingInvitation {
    const creator = this.requireActiveDesktop(input.authorizingCredential);
    if (input.targetKind === "DESKTOP" && !this.ownerRecoveryKeyConfirmedAt) {
      throw new Error("OWNER_RECOVERY_KEY_CONFIRMATION_REQUIRED");
    }
    for (const challenge of this.challenges.values()) {
      if (
        challenge.creatorDesktopId === creator.deviceId
        && (challenge.status === "OPEN" || challenge.status === "CLAIMED")
      ) {
        challenge.status = "INVALIDATED";
      }
    }
    const invitation = createSecret("cy_pi");
    const challengeId = randomUUID();
    const shortCodeRoute = challengeId.replaceAll("-", "").slice(0, 6).toUpperCase();
    const shortCodeSecret = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const shortCode = `CYR-${shortCodeRoute}-${shortCodeSecret}`;
    const expiresAtMs = this.now() + PAIRING_TTL_MS;
    this.challenges.set(challengeId, {
      challengeId,
      creatorDesktopId: creator.deviceId,
      invitationHash: hashSecret(invitation),
      targetKind: input.targetKind,
      status: "OPEN",
      expiresAtMs,
      shortCodeRoute,
      shortCodeHash: hashSecret(shortCode),
      incorrectShortCodeAttempts: 0,
    });
    return {
      challengeId,
      invitation,
      shortCode,
      targetKind: input.targetKind,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  claimPairing(input: {
    challengeId?: string;
    invitation: string;
    candidate: PairingCandidateSummary;
    candidateReceipt?: string;
  }): PairingClaim {
    const invitationHash = hashSecret(input.invitation);
    const challenge = [...this.challenges.values()].find(
      (candidate) => candidate.invitationHash === invitationHash,
    );
    if (!challenge) {
      throw new Error("PAIRING_INVITATION_INVALID");
    }
    if (input.challengeId && input.challengeId !== challenge.challengeId) {
      throw new Error("PAIRING_INVITATION_INVALID");
    }
    if (challenge.status === "INVALIDATED") {
      throw new Error("PAIRING_CHALLENGE_INVALIDATED");
    }
    if (challenge.status === "ATTEMPT_LIMITED") {
      throw new Error("PAIRING_ATTEMPT_LIMITED");
    }
    if (challenge.status !== "OPEN") {
      throw new Error("PAIRING_INVITATION_INVALID");
    }
    return this.claimOpenChallenge(challenge, input.candidate, input.candidateReceipt);
  }

  claimPairingWithShortCode(input: {
    shortCode: string;
    candidate: PairingCandidateSummary;
    candidateReceipt?: string;
  }): PairingClaim {
    const shortCode = input.shortCode.trim().toUpperCase();
    const match = /^CYR-([A-F0-9]{6})-(\d{6})$/.exec(shortCode);
    if (!match) throw new Error("PAIRING_SHORT_CODE_INVALID");
    const challenge = [...this.challenges.values()].find(
      (candidate) => candidate.shortCodeRoute === match[1],
    );
    if (!challenge) throw new Error("PAIRING_SHORT_CODE_INVALID");
    if (challenge.status === "ATTEMPT_LIMITED") {
      throw new Error("PAIRING_ATTEMPT_LIMITED");
    }
    if (challenge.status === "INVALIDATED") {
      throw new Error("PAIRING_CHALLENGE_INVALIDATED");
    }
    if (challenge.status !== "OPEN") {
      throw new Error("PAIRING_SHORT_CODE_INVALID");
    }
    if (challenge.expiresAtMs <= this.now()) {
      challenge.status = "EXPIRED";
      throw new Error("PAIRING_CHALLENGE_EXPIRED");
    }
    if (!challenge.shortCodeHash || hashSecret(shortCode) !== challenge.shortCodeHash) {
      challenge.incorrectShortCodeAttempts += 1;
      if (challenge.incorrectShortCodeAttempts >= 5) {
        challenge.status = "ATTEMPT_LIMITED";
        throw new Error("PAIRING_ATTEMPT_LIMITED");
      }
      throw new Error("PAIRING_SHORT_CODE_INVALID");
    }
    return this.claimOpenChallenge(challenge, input.candidate, input.candidateReceipt);
  }

  private claimOpenChallenge(
    challenge: PairingChallengeRecord,
    inputCandidate: PairingCandidateSummary,
    suppliedCandidateReceipt?: string,
  ): PairingClaim {
    if (challenge.expiresAtMs <= this.now()) {
      challenge.status = "EXPIRED";
      throw new Error("PAIRING_CHALLENGE_EXPIRED");
    }
    if (challenge.targetKind !== inputCandidate.kind) {
      throw new Error("PAIRING_DEVICE_KIND_MISMATCH");
    }
    const candidate: PairingCandidateSummary = {
      installationId: normalizeInstallationId(inputCandidate.installationId),
      kind: inputCandidate.kind,
      label: normalizeLabel(inputCandidate.label),
    };
    const digits = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const verificationCode = `${digits.slice(0, 3)} ${digits.slice(3)}`;
    const candidateReceipt = suppliedCandidateReceipt ?? createSecret("cy_pr");
    if (!/^cy_pr_[A-Za-z0-9_-]{40,}$/.test(candidateReceipt)) {
      throw new Error("PAIRING_CANDIDATE_RECEIPT_INVALID");
    }
    challenge.status = "CLAIMED";
    challenge.candidate = candidate;
    challenge.verificationCode = verificationCode;
    challenge.candidateReceiptHash = hashSecret(candidateReceipt);
    return {
      challengeId: challenge.challengeId,
      status: "CLAIMED",
      candidate,
      verificationCode,
      expiresAt: new Date(challenge.expiresAtMs).toISOString(),
      candidateReceipt,
    };
  }

  decidePairing(input: {
    authorizingCredential: string;
    challengeId: string;
    allow: boolean;
  }):
    | { status: "APPROVED"; device: AuthorizedDeviceSummary }
    | { status: "REJECTED" } {
    const approver = this.requireActiveDesktop(input.authorizingCredential);
    const challenge = this.challenges.get(input.challengeId);
    if (!challenge || challenge.creatorDesktopId !== approver.deviceId) {
      throw new Error("PAIRING_CHALLENGE_NOT_FOUND");
    }
    if (challenge.status === "APPROVED") {
      const approvedDevice = challenge.approvedDeviceId
        ? this.devices.get(challenge.approvedDeviceId)
        : undefined;
      if (!approvedDevice) throw new Error("PAIRING_APPROVAL_INCONSISTENT");
      return { status: "APPROVED", device: this.toDeviceSummary(approvedDevice) };
    }
    if (challenge.status === "REJECTED") {
      return { status: "REJECTED" };
    }
    if (challenge.expiresAtMs <= this.now()) {
      throw new Error("PAIRING_CHALLENGE_EXPIRED");
    }
    if (challenge.status !== "CLAIMED" || !challenge.candidate) {
      throw new Error("PAIRING_CANDIDATE_REQUIRED");
    }
    if (!input.allow) {
      challenge.status = "REJECTED";
      this.clearTerminalPairingSecrets(challenge);
      return { status: "REJECTED" };
    }
    const deviceLimit = challenge.candidate.kind === "MOBILE" ? 5 : 3;
    const activeDeviceCount = [...this.devices.values()].filter(
      (device) => device.kind === challenge.candidate?.kind && device.status === "ACTIVE",
    ).length;
    if (activeDeviceCount >= deviceLimit) {
      throw new Error("DEVICE_LIMIT_REACHED");
    }

    const device: AuthorizedDeviceRecord = {
      deviceId: randomUUID(),
      kind: challenge.candidate.kind,
      label: challenge.candidate.label,
      status: "ACTIVE",
      pairedAt: new Date(this.now()).toISOString(),
    };
    this.devices.set(device.deviceId, device);
    challenge.status = "APPROVED";
    challenge.approvedDeviceId = device.deviceId;
    this.clearTerminalPairingSecrets(challenge);
    return { status: "APPROVED", device: this.toDeviceSummary(device) };
  }

  exportPersistentState(): DeviceAuthorizationPersistentState {
    this.persistentRevision += 1;
    return {
      version: 1,
      revision: this.persistentRevision,
      ownerBootstrapped: this.ownerBootstrapped,
      ownerRecoveryKeyHash: this.ownerRecoveryKeyHash,
      ownerRecoveryKeyConfirmedAt: this.ownerRecoveryKeyConfirmedAt,
      lastOwnerRecovery: this.lastOwnerRecovery
        ? { ...this.lastOwnerRecovery }
        : undefined,
      devices: [...this.devices.values()].map((device) => ({ ...device })),
      challenges: [...this.challenges.values()].map((challenge) => ({
        ...challenge,
        candidate: challenge.candidate ? { ...challenge.candidate } : undefined,
      })),
      voiceCalls: [...this.voiceCalls.values()].map((call) => ({ ...call })),
      voiceCallIdempotency: [...this.voiceCallIdempotency.values()].map(
        (record) => ({ ...record }),
      ),
    };
  }

  getPairingReview(input: {
    authorizingCredential: string;
    challengeId: string;
  }): PairingReview {
    const approver = this.requireActiveDesktop(input.authorizingCredential);
    const challenge = this.challenges.get(input.challengeId);
    if (!challenge || challenge.creatorDesktopId !== approver.deviceId) {
      throw new Error("PAIRING_CHALLENGE_NOT_FOUND");
    }
    if (
      challenge.expiresAtMs <= this.now()
      && (challenge.status === "OPEN" || challenge.status === "CLAIMED")
    ) {
      challenge.status = "EXPIRED";
    }
    if (challenge.status === "OPEN") {
      return {
        status: "OPEN",
        expiresAt: new Date(challenge.expiresAtMs).toISOString(),
      };
    }
    if (
      challenge.status === "CLAIMED"
      && challenge.candidate
      && challenge.verificationCode
    ) {
      return {
        status: "CLAIMED",
        candidate: { ...challenge.candidate },
        verificationCode: challenge.verificationCode,
        expiresAt: new Date(challenge.expiresAtMs).toISOString(),
      };
    }
    if (challenge.status === "APPROVED" && challenge.approvedDeviceId) {
      const device = this.devices.get(challenge.approvedDeviceId);
      if (!device) throw new Error("PAIRING_APPROVAL_INCONSISTENT");
      return { status: "APPROVED", device: this.toDeviceSummary(device) };
    }
    if (
      challenge.status === "REJECTED"
      || challenge.status === "EXPIRED"
      || challenge.status === "INVALIDATED"
      || challenge.status === "ATTEMPT_LIMITED"
    ) {
      return { status: challenge.status };
    }
    throw new Error("PAIRING_CHALLENGE_INCONSISTENT");
  }

  readPairingOutcome(input: {
    challengeId: string;
    candidateReceipt: string;
  }):
    | { status: "CLAIMED"; verificationCode: string; expiresAt: string }
    | { status: "REJECTED" }
    | {
      status: "APPROVED";
      device: AuthorizedDeviceSummary;
      deviceCredential: string;
    } {
    const challenge = this.challenges.get(input.challengeId);
    if (
      !challenge
      || !challenge.candidateReceiptHash
      || hashSecret(input.candidateReceipt) !== challenge.candidateReceiptHash
    ) {
      throw new Error("PAIRING_CANDIDATE_RECEIPT_INVALID");
    }
    if (challenge.status === "REJECTED") {
      return { status: "REJECTED" };
    }
    if (
      challenge.status === "APPROVED"
      && challenge.approvedDeviceId
    ) {
      const device = this.devices.get(challenge.approvedDeviceId);
      if (!device) throw new Error("PAIRING_APPROVAL_INCONSISTENT");
      const deviceCredential = deriveCandidateDeviceCredential(
        input.candidateReceipt,
        device.deviceId,
      );
      const credentialHash = hashSecret(deviceCredential);
      if (device.credentialHash && device.credentialHash !== credentialHash) {
        throw new Error("PAIRING_APPROVAL_INCONSISTENT");
      }
      device.credentialHash = credentialHash;
      this.deviceIdByCredentialHash.set(credentialHash, device.deviceId);
      return {
        status: "APPROVED",
        device: this.toDeviceSummary(device),
        deviceCredential,
      };
    }
    if (challenge.status !== "CLAIMED" || !challenge.verificationCode) {
      throw new Error("PAIRING_CANDIDATE_REQUIRED");
    }
    return {
      status: "CLAIMED",
      verificationCode: challenge.verificationCode,
      expiresAt: new Date(challenge.expiresAtMs).toISOString(),
    };
  }

  getAuthorizationSnapshot(authorizingCredential: string): {
    devices: AuthorizedDeviceSummary[];
  } {
    this.requireActiveDesktop(authorizingCredential);
    return {
      devices: [...this.devices.values()].map((device) => this.toDeviceSummary(device)),
    };
  }

  authorizeDevice(deviceCredential: string): AuthorizedDeviceSummary {
    const deviceId = this.deviceIdByCredentialHash.get(hashSecret(deviceCredential));
    const device = deviceId ? this.devices.get(deviceId) : undefined;
    if (!device) throw new Error("DEVICE_AUTHORIZATION_INVALID");
    if (device.status === "REVOKED") throw new Error("DEVICE_AUTHORIZATION_REVOKED");
    if (device.status !== "ACTIVE") throw new Error("DEVICE_AUTHORIZATION_INACTIVE");
    return this.toDeviceSummary(device);
  }

  revokeDevice(input: {
    authorizingCredential: string;
    deviceId: string;
  }): AuthorizedDeviceSummary {
    this.requireActiveDesktop(input.authorizingCredential);
    const device = this.devices.get(input.deviceId);
    if (!device) throw new Error("DEVICE_NOT_FOUND");
    if (device.status === "REVOKED") return this.toDeviceSummary(device);
    if (device.status !== "ACTIVE") throw new Error("DEVICE_AUTHORIZATION_INACTIVE");
    device.status = "REVOKED";
    if (device.kind === "DESKTOP") {
      for (const challenge of this.challenges.values()) {
        if (
          challenge.creatorDesktopId === device.deviceId
          && (challenge.status === "OPEN" || challenge.status === "CLAIMED")
        ) {
          challenge.status = "INVALIDATED";
        }
      }
    }
    return this.toDeviceSummary(device);
  }

  private toDeviceSummary(device: AuthorizedDeviceRecord): AuthorizedDeviceSummary {
    return {
      deviceId: device.deviceId,
      kind: device.kind,
      label: device.label,
      status: device.status,
      pairedAt: device.pairedAt,
    };
  }

  private requireActiveDesktop(credential: string): AuthorizedDeviceRecord {
    const device = this.requireActiveDevice(credential);
    if (!device || device.kind !== "DESKTOP" || device.status !== "ACTIVE") {
      throw new Error("DESKTOP_AUTHORIZATION_REQUIRED");
    }
    return device;
  }

  private requireActiveMobile(credential: string): AuthorizedDeviceRecord {
    const device = this.requireActiveDevice(credential);
    if (device.kind !== "MOBILE") {
      throw new Error("DEVICE_AUTHORIZATION_INVALID");
    }
    return device;
  }

  private requireActiveDevice(credential: string): AuthorizedDeviceRecord {
    const deviceId = this.deviceIdByCredentialHash.get(hashSecret(credential));
    const device = deviceId ? this.devices.get(deviceId) : undefined;
    if (!device) throw new Error("DEVICE_AUTHORIZATION_INVALID");
    if (device.status === "REVOKED") throw new Error("DEVICE_AUTHORIZATION_REVOKED");
    if (device.status !== "ACTIVE") throw new Error("DEVICE_AUTHORIZATION_INACTIVE");
    return device;
  }

  private restorePersistentState(state: DeviceAuthorizationPersistentState): void {
    if (
      state.version !== 1
      || !Number.isSafeInteger(state.revision)
      || state.revision < 0
      || !Array.isArray(state.devices)
      || !Array.isArray(state.challenges)
    ) {
      throw new Error("DEVICE_AUTHORIZATION_STATE_INVALID");
    }
    this.ownerBootstrapped = Boolean(state.ownerBootstrapped);
    this.ownerRecoveryKeyHash = state.ownerRecoveryKeyHash;
    this.ownerRecoveryKeyConfirmedAt = state.ownerRecoveryKeyConfirmedAt;
    this.lastOwnerRecovery = state.lastOwnerRecovery
      ? { ...state.lastOwnerRecovery }
      : undefined;
    this.persistentRevision = state.revision;
    for (const input of state.devices) {
      const device = { ...input };
      if (!device.deviceId) {
        throw new Error("DEVICE_AUTHORIZATION_STATE_INVALID");
      }
      this.devices.set(device.deviceId, device);
      if (device.credentialHash) {
        this.deviceIdByCredentialHash.set(device.credentialHash, device.deviceId);
      }
    }
    for (const input of state.challenges) {
      const challenge = {
        ...input,
        candidate: input.candidate ? { ...input.candidate } : undefined,
      };
      if (!challenge.challengeId || !challenge.creatorDesktopId) {
        throw new Error("DEVICE_AUTHORIZATION_STATE_INVALID");
      }
      this.challenges.set(challenge.challengeId, challenge);
    }
    for (const input of state.voiceCalls ?? []) {
      if (!input.callId || !input.mobileDeviceId || !input.desktopDeviceId) {
        throw new Error("DEVICE_AUTHORIZATION_STATE_INVALID");
      }
      this.voiceCalls.set(input.callId, { ...input });
    }
    for (const input of state.voiceCallIdempotency ?? []) {
      if (!input.mobileDeviceId || !input.idempotencyKeyHash) {
        throw new Error("DEVICE_AUTHORIZATION_STATE_INVALID");
      }
      this.voiceCallIdempotency.set(
        `${input.mobileDeviceId}:${input.idempotencyKeyHash}`,
        { ...input },
      );
    }
  }

  private sweepVoiceCallDeadlines(): void {
    for (const call of this.voiceCalls.values()) {
      if (
        call.phase === "AWAITING_DESKTOP"
        && call.desktopConfirmDeadlineMs <= this.now()
      ) {
        this.endVoiceCall(call, "DESKTOP_CONFIRM_TIMEOUT");
      } else if (
        call.phase === "CONNECTING_MEDIA"
        && typeof call.mediaConnectDeadlineMs === "number"
        && call.mediaConnectDeadlineMs <= this.now()
      ) {
        this.endVoiceCall(call, "MEDIA_CONNECT_TIMEOUT");
      } else if (
        call.phase === "RECONNECTING"
        && typeof call.reconnectDeadlineMs === "number"
        && call.reconnectDeadlineMs <= this.now()
      ) {
        this.endVoiceCall(call, "RECONNECT_TIMEOUT");
      } else if (
        call.phase === "ACTIVE"
        && typeof call.activeAtMs === "number"
        && call.activeAtMs + 4 * 60 * 60 * 1000 <= this.now()
      ) {
        this.endVoiceCall(call, "MAX_DURATION");
      } else if (
        call.phase === "ACTIVE"
        && typeof call.lastValidVoiceInteractionAtMs === "number"
        && call.lastValidVoiceInteractionAtMs + 10 * 60 * 1000 <= this.now()
      ) {
        this.endVoiceCall(call, "IDLE_TIMEOUT");
      }
    }
  }

  private endVoiceCall(
    call: VoiceCallRecord,
    reason: CallTerminationReason,
  ): void {
    if (call.phase === "ENDED") return;
    call.phase = "ENDED";
    call.terminationReason = reason;
    call.endedAtMs = this.now();
    call.mobileMediaGrantEnvelope = undefined;
    call.desktopMediaGrantEnvelope = undefined;
    call.mediaGrantExpiresAtMs = undefined;
  }

  private toVoiceCallView(call: VoiceCallRecord): VoiceCallView {
    return {
      callId: call.callId,
      mobileDeviceId: call.mobileDeviceId,
      desktopDeviceId: call.desktopDeviceId,
      phase: call.phase,
      createdAt: new Date(call.createdAtMs).toISOString(),
      desktopConfirmDeadline: new Date(call.desktopConfirmDeadlineMs).toISOString(),
      ...(typeof call.mediaConnectDeadlineMs === "number"
        ? { mediaConnectDeadline: new Date(call.mediaConnectDeadlineMs).toISOString() }
        : {}),
      ...(typeof call.activeAtMs === "number"
        ? { activeAt: new Date(call.activeAtMs).toISOString() }
        : {}),
      ...(typeof call.reconnectDeadlineMs === "number"
        ? { reconnectDeadline: new Date(call.reconnectDeadlineMs).toISOString() }
        : {}),
      ...(call.characterId ? { characterId: call.characterId } : {}),
      ...(call.characterName ? { characterName: call.characterName } : {}),
      ...(call.terminationReason
        ? { terminationReason: call.terminationReason }
        : {}),
      ...(typeof call.endedAtMs === "number"
        ? { endedAt: new Date(call.endedAtMs).toISOString() }
        : {}),
    };
  }

  private clearTerminalPairingSecrets(challenge: PairingChallengeRecord): void {
    challenge.invitationHash = undefined;
    challenge.shortCodeHash = undefined;
    challenge.verificationCode = undefined;
  }

  private ownerRecoveryResult(
    usedOwnerRecoveryKey: string,
    recoveryReceipt: string,
    deviceId: string,
    label?: string,
  ): {
    device: AuthorizedDeviceSummary;
    deviceCredential: string;
    ownerRecoveryKey: string;
  } {
    const existing = this.devices.get(deviceId);
    const device = existing
      ? this.toDeviceSummary(existing)
      : {
        deviceId,
        kind: "DESKTOP" as const,
        label: label ?? "Recovered Desktop",
        status: "ACTIVE" as const,
        pairedAt: new Date(this.now()).toISOString(),
      };
    return {
      device,
      deviceCredential: deriveOwnerRecoverySecret(
        usedOwnerRecoveryKey,
        recoveryReceipt,
        deviceId,
        "device-credential",
        "cy_dc",
      ),
      ownerRecoveryKey: deriveOwnerRecoverySecret(
        usedOwnerRecoveryKey,
        recoveryReceipt,
        deviceId,
        "next-recovery-key",
        "cy_rk",
      ),
    };
  }
}

function deriveCandidateDeviceCredential(
  candidateReceipt: string,
  deviceId: string,
): string {
  const digest = createHmac("sha256", candidateReceipt)
    .update(`cyrene-device-credential-v1:${deviceId}`, "utf8")
    .digest("base64url");
  return `cy_dc_${digest}`;
}

function deriveOwnerRecoverySecret(
  usedOwnerRecoveryKey: string,
  recoveryReceipt: string,
  deviceId: string,
  purpose: string,
  prefix: "cy_dc" | "cy_rk",
): string {
  const digest = createHmac("sha256", usedOwnerRecoveryKey)
    .update(
      `cyrene-owner-recovery-v1:${purpose}:${deviceId}:${recoveryReceipt}`,
      "utf8",
    )
    .digest("base64url");
  return `${prefix}_${digest}`;
}

function requireSecret(value: string, pattern: RegExp, code: string): string {
  const normalized = value.trim();
  if (!pattern.test(normalized)) throw new Error(code);
  return normalized;
}
