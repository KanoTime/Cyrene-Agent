import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { fileURLToPath } from "node:url";

const ENV_ID = "cyrene-agent-d2gfztehj201e3df3";
const FUNCTION_NAME = "cyrene_device_authorization_control";
const KEYCHAIN_SERVICE = `Cyrene Deployment Bootstrap Code - ${ENV_ID}`;
const MEDIA_KEYCHAIN_SERVICE = `Cyrene Media Envelope Master Key - ${ENV_ID}`;
const LIVEKIT_URL_KEYCHAIN_SERVICE = `Cyrene LiveKit Server URL - ${ENV_ID}`;
const LIVEKIT_API_KEY_KEYCHAIN_SERVICE = `Cyrene LiveKit API Key - ${ENV_ID}`;
const LIVEKIT_API_SECRET_KEYCHAIN_SERVICE = `Cyrene LiveKit API Secret - ${ENV_ID}`;
const KEYCHAIN_ACCOUNT = userInfo().username;
const CONFIG_PATH = "/tmp/cyrene-device-authorization-cloudbaserc.json";
const SETTINGS_PATH = `${homedir()}/Library/Application Support/live2d-cyrene/app-settings.json`;
const functionRoot = "cloudbase";
const functionDir = fileURLToPath(
  new URL("../cloudbase/device-authorization", import.meta.url),
);
const requestedOrigin = process.argv[2] ?? "https://pending.invalid";
const publicOrigin = new URL(requestedOrigin);

if (publicOrigin.protocol !== "https:" || publicOrigin.pathname !== "/") {
  throw new Error("CYRENE_CONTROL_PLANE_PUBLIC_ORIGIN_INVALID");
}

let deploymentBootstrapCode;
try {
  deploymentBootstrapCode = execFileSync(
    "security",
    [
      "find-generic-password",
      "-w",
      "-a",
      KEYCHAIN_ACCOUNT,
      "-s",
      KEYCHAIN_SERVICE,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
} catch {
  deploymentBootstrapCode = `cy_db_${randomBytes(36).toString("base64url")}`;
  execFileSync(
    "security",
    [
      "add-generic-password",
      "-U",
      "-a",
      KEYCHAIN_ACCOUNT,
      "-s",
      KEYCHAIN_SERVICE,
      "-w",
      deploymentBootstrapCode,
    ],
    { stdio: "ignore" },
  );
}

if (!/^cy_db_[A-Za-z0-9_-]{40,}$/.test(deploymentBootstrapCode)) {
  throw new Error("DEPLOYMENT_BOOTSTRAP_CODE_INVALID");
}

function readKeychainValue(service) {
  try {
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
  } catch {
    return "";
  }
}

const settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
const liveKitServerUrl = readKeychainValue(LIVEKIT_URL_KEYCHAIN_SERVICE)
  || String(settings.mobileCallLiveKitUrl ?? "").trim();
const liveKitApiKey = readKeychainValue(LIVEKIT_API_KEY_KEYCHAIN_SERVICE)
  || String(settings.mobileCallLiveKitApiKey ?? "").trim();
const liveKitApiSecret = readKeychainValue(LIVEKIT_API_SECRET_KEYCHAIN_SERVICE)
  || String(settings.mobileCallLiveKitApiSecret ?? "").trim();
if (
  !liveKitServerUrl.startsWith("wss://")
  || !liveKitApiKey
  || !liveKitApiSecret
) {
  throw new Error("LIVEKIT_SERVER_CONFIGURATION_REQUIRED");
}

let mediaEnvelopeMasterKey;
try {
  mediaEnvelopeMasterKey = execFileSync(
    "security",
    [
      "find-generic-password",
      "-w",
      "-a",
      KEYCHAIN_ACCOUNT,
      "-s",
      MEDIA_KEYCHAIN_SERVICE,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
} catch {
  mediaEnvelopeMasterKey = randomBytes(32).toString("base64url");
  execFileSync(
    "security",
    [
      "add-generic-password",
      "-U",
      "-a",
      KEYCHAIN_ACCOUNT,
      "-s",
      MEDIA_KEYCHAIN_SERVICE,
      "-w",
      mediaEnvelopeMasterKey,
    ],
    { stdio: "ignore" },
  );
}
if (!/^[A-Za-z0-9_-]{43}$/.test(mediaEnvelopeMasterKey)) {
  throw new Error("MEDIA_ENVELOPE_MASTER_KEY_INVALID");
}

const deploymentBootstrapCodeHash = createHash("sha256")
  .update(deploymentBootstrapCode)
  .digest("base64url");

const config = {
  $schema: "https://static.cloudbase.net/cli/cloudbaserc.schema.json",
  envId: ENV_ID,
  functionRoot,
  functions: [
    {
      name: FUNCTION_NAME,
      dir: functionDir,
      runtime: "Nodejs20.19",
      handler: "entry.main",
      timeout: 5,
      memorySize: 128,
      installDependency: true,
      envVariables: {
        CYRENE_CONTROL_PLANE_PUBLIC_ORIGIN: publicOrigin.origin,
        CYRENE_DEPLOYMENT_BOOTSTRAP_CODE_HASH: deploymentBootstrapCodeHash,
        CYRENE_LIVEKIT_SERVER_URL: liveKitServerUrl,
        CYRENE_LIVEKIT_API_KEY: liveKitApiKey,
        CYRENE_LIVEKIT_API_SECRET: liveKitApiSecret,
        CYRENE_MEDIA_ENVELOPE_MASTER_KEY: mediaEnvelopeMasterKey,
      },
    },
  ],
};

writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
chmodSync(CONFIG_PATH, 0o600);

process.stdout.write(`${JSON.stringify({
  status: "READY",
  envId: ENV_ID,
  functionName: FUNCTION_NAME,
  publicOrigin: publicOrigin.origin,
  configPath: CONFIG_PATH,
  keychainService: KEYCHAIN_SERVICE,
  mediaKeychainService: MEDIA_KEYCHAIN_SERVICE,
  liveKitKeychainConfigured: Boolean(
    readKeychainValue(LIVEKIT_URL_KEYCHAIN_SERVICE)
    && readKeychainValue(LIVEKIT_API_KEY_KEYCHAIN_SERVICE)
    && readKeychainValue(LIVEKIT_API_SECRET_KEYCHAIN_SERVICE)
  ),
  liveKitConfigured: true,
  mediaEnvelopeConfigured: true,
  bootstrapPlaintextPrinted: false,
  secretPlaintextPrinted: false,
})}\n`);
