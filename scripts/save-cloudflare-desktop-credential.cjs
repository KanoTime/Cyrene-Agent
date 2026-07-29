const { app, safeStorage } = require("electron");
const {
  copyFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} = require("node:fs/promises");
const { constants } = require("node:fs");
const { homedir } = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const {
  configureCyreneSafeStorageContext,
} = require("./cyrene-safe-storage-context.cjs");

const ROOT_DIR = path.join(
  homedir(),
  "Library",
  "Application Support",
  "live2d-cyrene",
  "remote-access",
);
const FILE_PATH = path.join(ROOT_DIR, "desktop-device.enc");
const DEVICE_CREDENTIAL_PATTERN = /^cy_dc_[A-Za-z0-9_-]{40,}$/;

configureCyreneSafeStorageContext(app);

async function run() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("DESKTOP_SECURE_STORAGE_UNAVAILABLE");
  }
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error("DESKTOP_CREDENTIAL_INPUT_REQUIRED");
  const input = JSON.parse(await readFile(inputPath, "utf8"));
  const origin = new URL(input.controlPlaneOrigin);
  if (origin.protocol !== "https:" || origin.username || origin.password) {
    throw new Error("CONTROL_PLANE_HTTPS_REQUIRED");
  }
  if (typeof input.deviceId !== "string" || !input.deviceId.trim()) {
    throw new Error("DEVICE_ID_INVALID");
  }
  if (
    typeof input.deviceCredential !== "string"
    || !DEVICE_CREDENTIAL_PATTERN.test(input.deviceCredential.trim())
  ) {
    throw new Error("DEVICE_CREDENTIAL_INVALID");
  }
  const savedAt = new Date(input.savedAt);
  if (Number.isNaN(savedAt.getTime())) {
    throw new Error("DEVICE_CREDENTIAL_SAVED_AT_INVALID");
  }

  await mkdir(ROOT_DIR, { recursive: true, mode: 0o700 });
  let backupPath;
  try {
    await readFile(FILE_PATH);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    backupPath = `${FILE_PATH}.cloudbase-backup-${timestamp}`;
    await copyFile(FILE_PATH, backupPath, constants.COPYFILE_EXCL);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const record = {
    controlPlaneOrigin: origin.origin,
    deviceId: input.deviceId.trim(),
    deviceCredential: input.deviceCredential.trim(),
    savedAt: savedAt.toISOString(),
  };
  const encrypted = safeStorage.encryptString(JSON.stringify(record));
  const file = {
    version: 1,
    payload: encrypted.toString("base64"),
  };
  const temporaryPath = `${FILE_PATH}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(file), { mode: 0o600 });
  await rename(temporaryPath, FILE_PATH);
  process.stdout.write(`${JSON.stringify({
    status: "SAVED",
    backupCreated: Boolean(backupPath),
    backupPath,
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
