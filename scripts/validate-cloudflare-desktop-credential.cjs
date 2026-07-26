const { app, safeStorage } = require("electron");
const { readFile } = require("node:fs/promises");
const { spawnSync } = require("node:child_process");
const { homedir } = require("node:os");
const path = require("node:path");
const {
  configureCyreneSafeStorageContext,
} = require("./cyrene-safe-storage-context.cjs");

const FILE_PATH = path.join(
  homedir(),
  "Library",
  "Application Support",
  "live2d-cyrene",
  "remote-access",
  "desktop-device.enc",
);
const EXPECTED_ORIGIN =
  "https://cyrene-device-authorization.cyrene-agent.workers.dev";

configureCyreneSafeStorageContext(app);

async function run() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("DESKTOP_SECURE_STORAGE_UNAVAILABLE");
  }
  const file = JSON.parse(await readFile(FILE_PATH, "utf8"));
  if (file.version !== 1 || typeof file.payload !== "string") {
    throw new Error("DESKTOP_DEVICE_CREDENTIAL_CORRUPT");
  }
  const record = JSON.parse(safeStorage.decryptString(
    Buffer.from(file.payload, "base64"),
  ));
  if (
    record.controlPlaneOrigin !== EXPECTED_ORIGIN
    || typeof record.deviceId !== "string"
    || !/^cy_dc_[A-Za-z0-9_-]{40,}$/.test(record.deviceCredential)
  ) {
    throw new Error("DESKTOP_DEVICE_CREDENTIAL_INVALID");
  }

  const config = [
    `url = "${EXPECTED_ORIGIN}/v1/desktop/calls/current"`,
    'request = "POST"',
    'header = "content-type: application/json"',
    `header = "authorization: DeviceCredential ${record.deviceCredential}"`,
    'data = "{}"',
    'write-out = "\\n%{http_code}"',
    "silent",
    "show-error",
    "max-time = 30",
  ].join("\n");
  const response = spawnSync("curl", ["--config", "-"], {
    input: `${config}\n`,
    encoding: "utf8",
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const splitAt = response.stdout.lastIndexOf("\n");
  const status = splitAt >= 0
    ? Number(response.stdout.slice(splitAt + 1))
    : 0;
  const body = splitAt >= 0
    ? JSON.parse(response.stdout.slice(0, splitAt))
    : {};
  if (
    response.status !== 0
    || status !== 200
    || !Object.prototype.hasOwnProperty.call(body, "call")
  ) {
    throw new Error("DESKTOP_DEVICE_CREDENTIAL_REJECTED");
  }

  process.stdout.write(`${JSON.stringify({
    status: "VALID",
    origin: record.controlPlaneOrigin,
    encryptedVaultReadable: true,
    deviceCredentialAccepted: true,
    secretPlaintextPrinted: false,
  })}\n`);
}

app.whenReady()
  .then(run)
  .then(() => app.exit(0))
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    app.exit(1);
  });
