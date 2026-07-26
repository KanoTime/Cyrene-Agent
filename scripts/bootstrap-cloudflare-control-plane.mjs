import { createHmac } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { userInfo } from "node:os";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_CONTROL_PLANE_ORIGIN =
  "https://cyrene-device-authorization.cyrene-agent.workers.dev";
const ORIGIN = new URL(
  process.env.CYRENE_CONTROL_PLANE_ORIGIN?.trim()
  || DEFAULT_CONTROL_PLANE_ORIGIN,
).origin;
if (!ORIGIN.startsWith("https://")) {
  throw new Error("CONTROL_PLANE_ORIGIN_HTTPS_REQUIRED");
}
const KEYCHAIN_ACCOUNT = userInfo().username;
const KEYCHAIN_NAMESPACE =
  process.env.CYRENE_KEYCHAIN_NAMESPACE?.trim()
  || "cyrene-agent-d2gfztehj201e3df3";
const DESKTOP_LABEL =
  process.env.CYRENE_DESKTOP_LABEL?.trim() || "家中 Mac";
const BOOTSTRAP_SERVICE =
  process.env.CYRENE_DEPLOYMENT_BOOTSTRAP_KEYCHAIN_SERVICE?.trim()
  || `Cyrene Deployment Bootstrap Code - ${KEYCHAIN_NAMESPACE}`;
const RECOVERY_KEY_SERVICE =
  process.env.CYRENE_OWNER_RECOVERY_KEYCHAIN_SERVICE?.trim()
  || `Cyrene Owner Recovery Key - ${KEYCHAIN_NAMESPACE}`;
const ELECTRON_BINARY_PATH = fileURLToPath(
  new URL(
    "../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
    import.meta.url,
  ),
);
const SAVE_CREDENTIAL_SCRIPT = fileURLToPath(
  new URL("./save-cloudflare-desktop-credential.cjs", import.meta.url),
);

function readKeychainValue(service) {
  return execFileSync(
    "security",
    [
      "find-generic-password",
      "-w",
      "-a",
      KEYCHAIN_ACCOUNT,
      "-s",
      service,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
}

function request(pathname, authorization, body) {
  const config = [
    `url = "${ORIGIN}${pathname}"`,
    'request = "POST"',
    'header = "content-type: application/json"',
    `header = "authorization: ${authorization}"`,
    `data = ${JSON.stringify(JSON.stringify(body))}`,
    'write-out = "\\n%{http_code}"',
    "silent",
    "show-error",
    "max-time = 30",
  ].join("\n");
  const result = spawnSync("curl", ["--config", "-"], {
    input: `${config}\n`,
    encoding: "utf8",
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error("CONTROL_PLANE_REQUEST_FAILED");
  }
  const splitAt = result.stdout.lastIndexOf("\n");
  if (splitAt < 0) throw new Error("CONTROL_PLANE_RESPONSE_INVALID");
  const status = Number(result.stdout.slice(splitAt + 1));
  let payload;
  try {
    payload = JSON.parse(result.stdout.slice(0, splitAt));
  } catch {
    throw new Error("CONTROL_PLANE_RESPONSE_INVALID");
  }
  if (status < 200 || status >= 300) {
    throw new Error(
      typeof payload.code === "string"
        ? payload.code
        : "CONTROL_PLANE_REQUEST_FAILED",
    );
  }
  return payload;
}

const deploymentBootstrapCode = readKeychainValue(BOOTSTRAP_SERVICE);
if (!/^cy_db_[A-Za-z0-9_-]{40,}$/.test(deploymentBootstrapCode)) {
  throw new Error("DEPLOYMENT_BOOTSTRAP_CODE_INVALID");
}

let bootstrap;
try {
  bootstrap = request(
    "/v1/owner/bootstrap",
    `DeploymentBootstrap ${deploymentBootstrapCode}`,
    { label: DESKTOP_LABEL },
  );
} catch (error) {
  if (!(error instanceof Error) || error.message !== "OWNER_ALREADY_BOOTSTRAPPED") {
    throw error;
  }
  if (process.env.CYRENE_ALLOW_OWNER_RECOVERY !== "1") {
    throw new Error(
      "OWNER_ALREADY_BOOTSTRAPPED_RECOVERY_REQUIRES_EXPLICIT_OPT_IN",
    );
  }
  const recoveryKey = readKeychainValue(RECOVERY_KEY_SERVICE);
  if (!/^cy_rk_[A-Za-z0-9_-]{40,}$/.test(recoveryKey)) {
    throw new Error("OWNER_RECOVERY_KEY_INVALID");
  }
  const recoveryReceipt = `cy_rr_${createHmac("sha256", recoveryKey)
    .update(`cyrene-owner-recovery-receipt-v1:${ORIGIN}`)
    .digest("base64url")}`;
  const recovered = request(
    "/v1/owner/recover",
    `OwnerRecovery ${recoveryKey}`,
    { recoveryReceipt, label: DESKTOP_LABEL },
  );
  bootstrap = {
    deviceId: recovered.device?.deviceId,
    deviceCredential: recovered.deviceCredential,
    ownerRecoveryKey: recovered.ownerRecoveryKey,
  };
}
if (
  typeof bootstrap.deviceId !== "string"
  || !/^cy_dc_[A-Za-z0-9_-]{40,}$/.test(bootstrap.deviceCredential)
  || !/^cy_rk_[A-Za-z0-9_-]{40,}$/.test(bootstrap.ownerRecoveryKey)
) {
  throw new Error("OWNER_BOOTSTRAP_RESPONSE_INVALID");
}

execFileSync(
  "security",
  [
    "add-generic-password",
    "-U",
    "-a",
    KEYCHAIN_ACCOUNT,
    "-s",
    RECOVERY_KEY_SERVICE,
    "-w",
    bootstrap.ownerRecoveryKey,
  ],
  { stdio: "ignore" },
);

const confirmation = request(
  "/v1/owner/recovery-key/confirm",
  `DeviceCredential ${bootstrap.deviceCredential}`,
  { ownerRecoveryKey: bootstrap.ownerRecoveryKey },
);
if (confirmation.status !== "CONFIRMED") {
  throw new Error("OWNER_RECOVERY_KEY_CONFIRMATION_INVALID");
}

const temporaryDirectory = mkdtempSync(
  path.join(tmpdir(), "cyrene-cloudflare-bootstrap-"),
);
const credentialInputPath = path.join(temporaryDirectory, "desktop.json");
writeFileSync(
  credentialInputPath,
  JSON.stringify({
      controlPlaneOrigin: ORIGIN,
      deviceId: bootstrap.deviceId,
      deviceCredential: bootstrap.deviceCredential,
      savedAt: new Date().toISOString(),
  }),
  { encoding: "utf8", mode: 0o600 },
);
let saveResult;
try {
  saveResult = spawnSync(
    ELECTRON_BINARY_PATH,
    [SAVE_CREDENTIAL_SCRIPT, credentialInputPath],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
} finally {
  unlinkSync(credentialInputPath);
  rmdirSync(temporaryDirectory);
}
if (saveResult.status !== 0) {
  throw new Error("DESKTOP_CREDENTIAL_SAVE_FAILED");
}
const saved = JSON.parse(saveResult.stdout);

process.stdout.write(`${JSON.stringify({
  status: "BOOTSTRAPPED",
  origin: ORIGIN,
  recoveryKeyService: RECOVERY_KEY_SERVICE,
  recoveryKeyConfirmed: true,
  desktopCredentialSaved: saved.status === "SAVED",
  previousCredentialBackupCreated: saved.backupCreated,
  previousCredentialBackupPath: saved.backupPath,
  secretPlaintextPrinted: false,
})}\n`);
