import type { MobileCallStatus } from "../../../shared/mobile-call-status";
import type {
  DesktopOwnerBootstrapDisplay,
  DesktopPairingReviewDisplay,
} from "../../../shared/device-pairing";
import type { SettingsApi, GeneralSettings } from "../shared/types";

export function initializeMobileCallPanel(root: HTMLElement): () => void {
const api = window.settings as unknown as SettingsApi | undefined;
let disposed = false;
const byId = <T extends HTMLElement>(id: string): T | null =>
  root.querySelector(`#${id}`) as T | null;
const hide = (element: HTMLElement | null): void => element?.setAttribute("hidden", "");
const show = (element: HTMLElement | null): void => element?.removeAttribute("hidden");
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);

// Long-lived device authorization. Pairing links and raw device credentials
// never enter this module; renderer receives only QR images and review fields.
const pairingState = byId<HTMLSpanElement>("device-pairing-state");
const pairingStatus = byId<HTMLSpanElement>("device-pairing-status");
const pairingBegin = byId<HTMLButtonElement>("device-pairing-begin");
const pairingInvitation = byId<HTMLDivElement>("device-pairing-invitation");
const pairingQr = byId<HTMLImageElement>("device-pairing-qr");
const pairingExpiry = byId<HTMLSpanElement>("device-pairing-expiry");
const pairingShortCode = byId<HTMLElement>("device-pairing-short-code");
const pairingReview = byId<HTMLDivElement>("device-pairing-review");
const pairingCandidate = byId<HTMLElement>("device-pairing-candidate");
const pairingVerificationCode = byId<HTMLElement>("device-pairing-verification-code");
const pairingAllow = byId<HTMLButtonElement>("device-pairing-allow");
const pairingReject = byId<HTMLButtonElement>("device-pairing-reject");

const ownerBootstrapPanel = byId<HTMLDivElement>("owner-bootstrap-panel");
const ownerBootstrapOrigin = byId<HTMLInputElement>("owner-bootstrap-origin");
const ownerBootstrapLabel = byId<HTMLInputElement>("owner-bootstrap-label");
const ownerBootstrapCode = byId<HTMLInputElement>("owner-bootstrap-code");
const ownerBootstrapSubmit = byId<HTMLButtonElement>("owner-bootstrap-submit");
const ownerRecoveryOpen = byId<HTMLButtonElement>("owner-recovery-open");
const ownerRecoverStart = byId<HTMLButtonElement>("owner-recover-start");
const ownerRecoverPanel = byId<HTMLDivElement>("owner-recover-panel");
const ownerRecoverOrigin = byId<HTMLInputElement>("owner-recover-origin");
const ownerRecoverLabel = byId<HTMLInputElement>("owner-recover-label");
const ownerRecoverKey = byId<HTMLInputElement>("owner-recover-key");
const ownerRecoverSubmit = byId<HTMLButtonElement>("owner-recover-submit");
const ownerRecoverCancel = byId<HTMLButtonElement>("owner-recover-cancel");
const ownerRecoveryPanel = byId<HTMLDivElement>("owner-recovery-panel");
const ownerRecoveryGuidance = byId<HTMLParagraphElement>("owner-recovery-guidance");
const ownerRecoveryKeyDisplay = byId<HTMLElement>("owner-recovery-key");
const ownerRecoveryConfirmLabel = byId<HTMLSpanElement>("owner-recovery-confirm-label");
const ownerRecoveryConfirmInput = byId<HTMLInputElement>("owner-recovery-confirm-input");
const ownerRecoveryConfirm = byId<HTMLButtonElement>("owner-recovery-confirm");
const ownerRecoveryCancel = byId<HTMLButtonElement>("owner-recovery-cancel");

let activeChallengeId: string | null = null;
let pairingPollTimer: number | undefined;
let pairingPollInFlight = false;
let pendingRecoveryKey: string | null = null;
let expectedRecoveryFragment: string | null = null;

function setPairingMessage(
  message: string,
  state: "idle" | "ok" | "error" = "idle",
): void {
  if (!pairingStatus) return;
  pairingStatus.textContent = message;
  pairingStatus.className = `save-status${state === "ok" ? " is-ok" : state === "error" ? " is-error" : ""}`;
}

function stopPairingPoll(): void {
  if (pairingPollTimer === undefined) return;
  window.clearInterval(pairingPollTimer);
  pairingPollTimer = undefined;
}

function resetPairingDisplay(): void {
  hide(pairingInvitation);
  hide(pairingReview);
  pairingQr?.removeAttribute("src");
  activeChallengeId = null;
  stopPairingPoll();
}

function clearRecoverySecret(): void {
  pendingRecoveryKey = null;
  expectedRecoveryFragment = null;
  if (ownerRecoveryKeyDisplay) {
    ownerRecoveryKeyDisplay.textContent = "";
    hide(ownerRecoveryKeyDisplay);
  }
  if (ownerRecoveryConfirmInput) ownerRecoveryConfirmInput.value = "";
}

function createFragmentCheck(key: string): { positions: number[]; expected: string } {
  const body = key.slice("cy_rk_".length);
  const positions = new Set<number>();
  while (positions.size < Math.min(4, body.length)) {
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    positions.add(random[0] % body.length);
  }
  const sorted = [...positions].sort((left, right) => left - right);
  return {
    positions: sorted.map((index) => index + 1),
    expected: sorted.map((index) => body[index]).join(""),
  };
}

function showReplacementRecoveryKey(
  result: DesktopOwnerBootstrapDisplay,
  successMessage: string,
): void {
  pendingRecoveryKey = result.ownerRecoveryKey;
  const check = createFragmentCheck(result.ownerRecoveryKey);
  expectedRecoveryFragment = check.expected;
  if (ownerRecoveryKeyDisplay) {
    ownerRecoveryKeyDisplay.textContent = result.ownerRecoveryKey;
    show(ownerRecoveryKeyDisplay);
  }
  if (ownerRecoveryGuidance) {
    ownerRecoveryGuidance.textContent =
      "立即保存到应用之外。按下方随机位置从已保存副本中找出字符；确认后页面会永久清除明文。";
  }
  if (ownerRecoveryConfirmLabel) {
    ownerRecoveryConfirmLabel.textContent = `依次输入密钥正文第 ${check.positions.join("、")} 位字符`;
  }
  show(ownerRecoveryPanel);
  if (pairingState) {
    pairingState.textContent = "等待确认恢复密钥";
    pairingState.className = "device-pairing-state";
  }
  setPairingMessage(successMessage, "ok");
  ownerRecoveryConfirmInput?.focus();
}

function terminalPairingMessage(status: DesktopPairingReviewDisplay["status"]): string {
  switch (status) {
    case "APPROVED": return "手机已获得独立设备授权";
    case "REJECTED": return "已拒绝这台手机";
    case "EXPIRED": return "配对挑战已过期，请重新生成";
    case "INVALIDATED": return "该挑战已被新的配对请求替代";
    case "ATTEMPT_LIMITED": return "备用短码错误次数过多，请重新生成";
    default: return "等待手机扫码";
  }
}

async function pollPairingReview(): Promise<void> {
  if (disposed || !activeChallengeId || !api?.reviewDevicePairing || pairingPollInFlight) return;
  pairingPollInFlight = true;
  try {
    const review = await api.reviewDevicePairing(activeChallengeId);
    if (review.status === "OPEN") {
      setPairingMessage("等待手机扫码…");
      return;
    }
    if (review.status === "CLAIMED") {
      if (pairingCandidate) {
        const kind = review.candidate.kind === "MOBILE" ? "Android 手机" : "桌面设备";
        pairingCandidate.textContent = `${review.candidate.label} · ${kind}`;
      }
      if (pairingVerificationCode) pairingVerificationCode.textContent = review.verificationCode;
      show(pairingReview);
      setPairingMessage("请核对两端校验码后决定", "ok");
      return;
    }
    setPairingMessage(
      terminalPairingMessage(review.status),
      review.status === "APPROVED" ? "ok" : "error",
    );
    resetPairingDisplay();
    if (pairingBegin) pairingBegin.disabled = false;
  } catch (error) {
    setPairingMessage(`读取配对状态失败：${errorText(error)}`, "error");
  } finally {
    pairingPollInFlight = false;
  }
}

async function loadAuthorizationStatus(): Promise<void> {
  if (!api?.getDeviceAuthorizationStatus) {
    if (pairingState) {
      pairingState.textContent = "当前版本不可用";
      pairingState.className = "device-pairing-state is-error";
    }
    return;
  }
  try {
    const status = await api.getDeviceAuthorizationStatus();
    if (status.status === "paired") {
      hide(ownerBootstrapPanel);
      hide(ownerRecoverPanel);
      hide(ownerRecoverStart);
      show(ownerRecoveryOpen);
      if (pairingState) {
        pairingState.textContent = "桌面已授权";
        pairingState.className = "device-pairing-state is-ready";
      }
      if (pairingBegin) pairingBegin.disabled = false;
      setPairingMessage("可以配对新手机");
      return;
    }
    hide(ownerRecoveryOpen);
    show(ownerRecoverStart);
    status.status === "corrupt" ? hide(ownerBootstrapPanel) : show(ownerBootstrapPanel);
    if (pairingState) {
      pairingState.textContent = status.status === "corrupt" ? "本机凭据损坏" : "等待公网初始化";
      pairingState.className = "device-pairing-state is-error";
    }
    setPairingMessage(
      status.status === "corrupt"
        ? "桌面授权凭据无法解密，需要走恢复或重新初始化"
        : "正式控制面尚未向本桌面签发设备授权",
      "error",
    );
  } catch (error) {
    if (pairingState) {
      pairingState.textContent = "状态读取失败";
      pairingState.className = "device-pairing-state is-error";
    }
    setPairingMessage(errorText(error), "error");
  }
}

ownerBootstrapSubmit?.addEventListener("click", async () => {
  if (!api?.bootstrapOwner || !ownerBootstrapOrigin || !ownerBootstrapLabel || !ownerBootstrapCode) return;
  ownerBootstrapSubmit.disabled = true;
  setPairingMessage("正在初始化首台桌面并写入钥匙串…");
  try {
    const result = await api.bootstrapOwner({
      controlPlaneOrigin: ownerBootstrapOrigin.value,
      deploymentBootstrapCode: ownerBootstrapCode.value,
      label: ownerBootstrapLabel.value,
    });
    ownerBootstrapCode.value = "";
    hide(ownerBootstrapPanel);
    showReplacementRecoveryKey(result, "桌面凭据已安全保存；请完成恢复密钥确认");
  } catch (error) {
    setPairingMessage(`初始化失败：${errorText(error)}`, "error");
  } finally {
    ownerBootstrapSubmit.disabled = false;
  }
});

ownerRecoverStart?.addEventListener("click", () => {
  hide(ownerBootstrapPanel);
  show(ownerRecoverPanel);
  ownerRecoverOrigin?.focus();
});
ownerRecoverCancel?.addEventListener("click", () => {
  if (ownerRecoverKey) ownerRecoverKey.value = "";
  hide(ownerRecoverPanel);
  void loadAuthorizationStatus();
});
ownerRecoverSubmit?.addEventListener("click", async () => {
  if (!api?.recoverOwner || !ownerRecoverOrigin || !ownerRecoverLabel || !ownerRecoverKey) return;
  ownerRecoverSubmit.disabled = true;
  setPairingMessage("正在验证恢复密钥并撤销旧桌面…");
  try {
    const result = await api.recoverOwner({
      controlPlaneOrigin: ownerRecoverOrigin.value,
      ownerRecoveryKey: ownerRecoverKey.value,
      label: ownerRecoverLabel.value,
    });
    ownerRecoverKey.value = "";
    hide(ownerRecoverPanel);
    showReplacementRecoveryKey(result, "Owner 已恢复，旧桌面已撤销；请保存并确认新的恢复密钥");
  } catch (error) {
    setPairingMessage(`恢复失败：${errorText(error)}`, "error");
  } finally {
    ownerRecoverSubmit.disabled = false;
  }
});

ownerRecoveryOpen?.addEventListener("click", () => {
  clearRecoverySecret();
  if (ownerRecoveryGuidance) {
    ownerRecoveryGuidance.textContent = "输入你已保存在应用之外的完整恢复密钥。确认成功后，控制面仍只保存验证哈希。";
  }
  if (ownerRecoveryConfirmLabel) ownerRecoveryConfirmLabel.textContent = "完整 Owner Recovery Key";
  show(ownerRecoveryPanel);
  ownerRecoveryConfirmInput?.focus();
});
ownerRecoveryCancel?.addEventListener("click", () => {
  clearRecoverySecret();
  hide(ownerRecoveryPanel);
  void loadAuthorizationStatus();
  setPairingMessage("恢复密钥尚未确认；新增桌面将被拒绝", "error");
});
ownerRecoveryConfirm?.addEventListener("click", async () => {
  if (!api?.confirmOwnerRecoveryKey || !ownerRecoveryConfirmInput) return;
  const entered = ownerRecoveryConfirmInput.value.trim();
  if (expectedRecoveryFragment && entered !== expectedRecoveryFragment) {
    setPairingMessage("随机片段不匹配，请检查已保存的恢复密钥", "error");
    return;
  }
  ownerRecoveryConfirm.disabled = true;
  setPairingMessage("正在确认恢复密钥…");
  try {
    await api.confirmOwnerRecoveryKey(pendingRecoveryKey ?? entered);
    clearRecoverySecret();
    hide(ownerRecoveryPanel);
    setPairingMessage("恢复密钥已确认，可以配对新设备", "ok");
    await loadAuthorizationStatus();
  } catch (error) {
    setPairingMessage(`确认失败：${errorText(error)}`, "error");
  } finally {
    ownerRecoveryConfirm.disabled = false;
  }
});

pairingBegin?.addEventListener("click", async () => {
  if (!api?.beginDevicePairing) return;
  resetPairingDisplay();
  pairingBegin.disabled = true;
  setPairingMessage("正在创建 2 分钟配对挑战…");
  try {
    const challenge = await api.beginDevicePairing();
    activeChallengeId = challenge.challengeId;
    if (pairingQr) pairingQr.src = challenge.qrDataUrl;
    if (pairingShortCode) pairingShortCode.textContent = challenge.shortCode;
    if (pairingExpiry) {
      pairingExpiry.textContent = `有效至 ${new Date(challenge.expiresAt).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })}`;
    }
    show(pairingInvitation);
    setPairingMessage("等待手机扫码…", "ok");
    if (disposed) return;
    pairingPollTimer = window.setInterval(() => void pollPairingReview(), 1_500);
    void pollPairingReview();
  } catch (error) {
    setPairingMessage(`创建失败：${errorText(error)}`, "error");
    pairingBegin.disabled = false;
  }
});

async function decidePairing(allow: boolean): Promise<void> {
  if (!activeChallengeId || !api?.decideDevicePairing) return;
  if (pairingAllow) pairingAllow.disabled = true;
  if (pairingReject) pairingReject.disabled = true;
  setPairingMessage(allow ? "正在批准…" : "正在拒绝…");
  try {
    const result = await api.decideDevicePairing(activeChallengeId, allow);
    setPairingMessage(
      result.status === "APPROVED" ? "手机已获得独立设备授权" : "已拒绝这台手机",
      result.status === "APPROVED" ? "ok" : "error",
    );
    resetPairingDisplay();
    if (pairingBegin) pairingBegin.disabled = false;
  } catch (error) {
    setPairingMessage(`决定失败：${errorText(error)}`, "error");
  } finally {
    if (pairingAllow) pairingAllow.disabled = false;
    if (pairingReject) pairingReject.disabled = false;
  }
}
pairingAllow?.addEventListener("click", () => void decidePairing(true));
pairingReject?.addEventListener("click", () => void decidePairing(false));
void loadAuthorizationStatus();

// Beta manual QR call. The API secret is persisted only by the main process;
// renderer receives a rendered QR image, never the embedded participant token.
const liveKitUrl = byId<HTMLInputElement>("mobile-call-livekit-url");
const liveKitKey = byId<HTMLInputElement>("mobile-call-livekit-key");
const liveKitSecret = byId<HTMLInputElement>("mobile-call-livekit-secret");
const mobileStart = byId<HTMLButtonElement>("mobile-call-start");
const mobileStop = byId<HTMLButtonElement>("mobile-call-stop");
const mobileStatus = byId<HTMLSpanElement>("mobile-call-status");
const mobilePairing = byId<HTMLDivElement>("mobile-call-pairing");
const mobileQr = byId<HTMLImageElement>("mobile-call-qr");
const mobileExpiry = byId<HTMLSpanElement>("mobile-call-expiry");
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function setMobileStatus(message: string, state: "default" | "ok" | "error" = "default"): void {
  if (!mobileStatus) return;
  mobileStatus.textContent = message;
  mobileStatus.className = `save-status${state === "ok" ? " is-ok" : state === "error" ? " is-error" : ""}`;
}

function applyMobileStatus(status: MobileCallStatus): void {
  const active = ["connecting", "waiting-for-mobile", "connected", "reconnecting"].includes(status.state);
  if (mobileStart) mobileStart.disabled = active;
  if (mobileStop) mobileStop.disabled = status.state === "connecting" || !active;
  if (status.state === "connected" || status.state === "error" || status.state === "ended") {
    hide(mobilePairing);
    mobileQr?.removeAttribute("src");
  } else if (status.state === "waiting-for-mobile" && mobileQr?.getAttribute("src")) {
    show(mobilePairing);
  }
  const messages: Record<MobileCallStatus["state"], string> = {
    idle: "",
    connecting: "正在连接 LiveKit 房间…",
    "waiting-for-mobile": "桌面端已就绪，等待手机加入",
    connected: "手机已加入，语音通话进行中",
    reconnecting: "网络暂时中断，正在自动重连…",
    ended: "手机通话已结束",
    error: status.message ?? "手机通话连接失败",
  };
  setMobileStatus(
    messages[status.state],
    status.state === "error" ? "error" : ["waiting-for-mobile", "connected", "ended"].includes(status.state) ? "ok" : "default",
  );
}
const unsubscribe = api?.onMobileCallStatus?.(applyMobileStatus);

function currentLiveKitSettings(): Partial<GeneralSettings> {
  return {
    mobileCallLiveKitUrl: liveKitUrl?.value.trim() ?? "",
    mobileCallLiveKitApiKey: liveKitKey?.value.trim() ?? "",
    mobileCallLiveKitApiSecret: liveKitSecret?.value.trim() ?? "",
  };
}
async function saveLiveKitSettings(): Promise<void> {
  await api?.saveGeneral(currentLiveKitSettings());
}
for (const field of [liveKitUrl, liveKitKey, liveKitSecret]) {
  field?.addEventListener("input", () => {
    clearTimeout(saveTimer);
    setMobileStatus("有未保存的连接配置");
    saveTimer = setTimeout(() => {
      void saveLiveKitSettings()
        .then(() => setMobileStatus("连接配置已保存", "ok"))
        .catch((error) => setMobileStatus(`保存失败：${errorText(error)}`, "error"));
    }, 700);
  });
}

async function loadLiveKitSettings(): Promise<void> {
  try {
    const settings = await api?.getGeneral();
    if (!settings) return;
    if (liveKitUrl) liveKitUrl.value = settings.mobileCallLiveKitUrl ?? "";
    if (liveKitKey) liveKitKey.value = settings.mobileCallLiveKitApiKey ?? "";
    if (liveKitSecret) liveKitSecret.value = settings.mobileCallLiveKitApiSecret ?? "";
  } catch (error) {
    console.warn("[mobile-call] 读取 LiveKit 配置失败", error);
    setMobileStatus("无法读取手机通话配置", "error");
  }
}

mobileStart?.addEventListener("click", async () => {
  if (!api?.startMobileCall) {
    setMobileStatus("当前桌面版本不支持手机通话配对", "error");
    return;
  }
  clearTimeout(saveTimer);
  mobileStart.disabled = true;
  setMobileStatus("正在创建短时配对房间…");
  let started = false;
  try {
    await saveLiveKitSettings();
    const pairing = await api.startMobileCall();
    if (mobileQr) mobileQr.src = pairing.qrDataUrl;
    if (mobileExpiry) {
      mobileExpiry.textContent = `请在 ${new Date(pairing.expiresAt).toLocaleString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      })} 前扫码`;
    }
    show(mobilePairing);
    if (mobileStop) mobileStop.disabled = false;
    setMobileStatus("桌面端已就绪，等待手机加入", "ok");
    started = true;
  } catch (error) {
    hide(mobilePairing);
    setMobileStatus(`配对失败：${errorText(error)}`, "error");
  } finally {
    if (!started) mobileStart.disabled = false;
  }
});
mobileStop?.addEventListener("click", async () => {
  if (!api?.stopMobileCall) return;
  mobileStop.disabled = true;
  setMobileStatus("正在结束手机通话…");
  try {
    await api.stopMobileCall();
    hide(mobilePairing);
    mobileQr?.removeAttribute("src");
    if (mobileStart) mobileStart.disabled = false;
    setMobileStatus("手机通话已结束", "ok");
  } catch (error) {
    mobileStop.disabled = false;
    setMobileStatus(`结束失败：${errorText(error)}`, "error");
  }
});
void loadLiveKitSettings();

return () => { disposed = true; stopPairingPoll(); clearTimeout(saveTimer); unsubscribe?.(); clearRecoverySecret(); };
}
