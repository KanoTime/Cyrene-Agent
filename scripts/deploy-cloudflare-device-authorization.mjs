import { createHash } from "node:crypto";
import { spawnSync, execFileSync } from "node:child_process";
import { userInfo } from "node:os";
import { fileURLToPath } from "node:url";

const KEYCHAIN_ACCOUNT = userInfo().username;
const KEYCHAIN_NAMESPACE =
  process.env.CYRENE_KEYCHAIN_NAMESPACE?.trim()
  || "cyrene-agent-production";
const CONFIG_PATH = fileURLToPath(
  new URL("../cloudflare/wrangler.jsonc", import.meta.url),
);
const WRANGLER_PATH = fileURLToPath(
  new URL("../node_modules/.bin/wrangler", import.meta.url),
);
const SERVICES = {
  deploymentBootstrapCode:
    process.env.CYRENE_DEPLOYMENT_BOOTSTRAP_KEYCHAIN_SERVICE?.trim()
    || `Cyrene Deployment Bootstrap Code - ${KEYCHAIN_NAMESPACE}`,
  liveKitServerUrl:
    process.env.CYRENE_LIVEKIT_SERVER_URL_KEYCHAIN_SERVICE?.trim()
    || `Cyrene LiveKit Server URL - ${KEYCHAIN_NAMESPACE}`,
  liveKitApiKey:
    process.env.CYRENE_LIVEKIT_API_KEY_KEYCHAIN_SERVICE?.trim()
    || `Cyrene LiveKit API Key - ${KEYCHAIN_NAMESPACE}`,
  liveKitApiSecret:
    process.env.CYRENE_LIVEKIT_API_SECRET_KEYCHAIN_SERVICE?.trim()
    || `Cyrene LiveKit API Secret - ${KEYCHAIN_NAMESPACE}`,
  mediaEnvelopeMasterKey:
    process.env.CYRENE_MEDIA_ENVELOPE_MASTER_KEY_KEYCHAIN_SERVICE?.trim()
    || `Cyrene Media Envelope Master Key - ${KEYCHAIN_NAMESPACE}`,
};

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

const deploymentBootstrapCode = readKeychainValue(
  SERVICES.deploymentBootstrapCode,
);
const liveKitServerUrl = readKeychainValue(SERVICES.liveKitServerUrl);
const liveKitApiKey = readKeychainValue(SERVICES.liveKitApiKey);
const liveKitApiSecret = readKeychainValue(SERVICES.liveKitApiSecret);
const mediaEnvelopeMasterKey = readKeychainValue(
  SERVICES.mediaEnvelopeMasterKey,
);

if (!/^cy_db_[A-Za-z0-9_-]{40,}$/.test(deploymentBootstrapCode)) {
  throw new Error("DEPLOYMENT_BOOTSTRAP_CODE_INVALID");
}
if (!liveKitServerUrl.startsWith("wss://") || !liveKitApiKey || !liveKitApiSecret) {
  throw new Error("LIVEKIT_SERVER_CONFIGURATION_REQUIRED");
}
if (!/^[A-Za-z0-9_-]{43}$/.test(mediaEnvelopeMasterKey)) {
  throw new Error("MEDIA_ENVELOPE_MASTER_KEY_INVALID");
}

const secrets = {
  CYRENE_DEPLOYMENT_BOOTSTRAP_CODE_HASH: createHash("sha256")
    .update(deploymentBootstrapCode)
    .digest("base64url"),
  CYRENE_LIVEKIT_SERVER_URL: liveKitServerUrl,
  CYRENE_LIVEKIT_API_KEY: liveKitApiKey,
  CYRENE_LIVEKIT_API_SECRET: liveKitApiSecret,
  CYRENE_MEDIA_ENVELOPE_MASTER_KEY: mediaEnvelopeMasterKey,
};

const initialDeploy = spawnSync(
  WRANGLER_PATH,
  ["deploy", "--config", CONFIG_PATH],
  { stdio: "inherit" },
);
if (initialDeploy.status !== 0) {
  throw new Error("CLOUDFLARE_INITIAL_DEPLOY_FAILED");
}

const secretUpload = spawnSync(
  WRANGLER_PATH,
  ["secret", "bulk", "--config", CONFIG_PATH],
  {
    input: `${JSON.stringify(secrets)}\n`,
    stdio: ["pipe", "inherit", "inherit"],
    encoding: "utf8",
  },
);
if (secretUpload.status !== 0) {
  throw new Error("CLOUDFLARE_SECRET_UPLOAD_FAILED");
}

process.stdout.write(`${JSON.stringify({
  status: "DEPLOYED",
  workerName: "cyrene-device-authorization",
  secretNames: Object.keys(secrets),
  secretPlaintextPrinted: false,
})}\n`);
