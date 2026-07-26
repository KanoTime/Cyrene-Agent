const { app, net, safeStorage } = require("electron");
const { homedir } = require("node:os");
const path = require("node:path");
const {
  configureCyreneSafeStorageContext,
} = require("./cyrene-safe-storage-context.cjs");
const {
  createDesktopAuthorizationRequest,
  DesktopDeviceAuthorizationClient,
} = require("../dist/main/main/remote-access/desktop-device-authorization-client.js");
const {
  DesktopDeviceCredentialVault,
} = require("../dist/main/main/remote-access/desktop-device-credential-vault.js");

configureCyreneSafeStorageContext(app);

app.whenReady()
  .then(async () => {
    const vault = new DesktopDeviceCredentialVault({
      rootDir: path.join(
        homedir(),
        "Library",
        "Application Support",
        "live2d-cyrene",
        "remote-access",
      ),
      safeStorage,
    });
    const client = new DesktopDeviceAuthorizationClient({
      vault,
      request: createDesktopAuthorizationRequest(
        (url, request) => net.fetch(url, request),
      ),
    });
    const challenge = await client.beginMobilePairing();
    if (
      !/^[0-9a-f-]{36}$/i.test(challenge.challengeId)
      || !/^cyrene:\/\/pair\?/.test(challenge.pairingLink)
      || !challenge.shortCode
      || Date.parse(challenge.expiresAt) <= Date.now()
    ) {
      throw new Error("PAIRING_CHALLENGE_INVALID");
    }
    process.stdout.write(`${JSON.stringify({
      status: "VALID",
      pairingChallengeCreated: true,
      expiresAt: challenge.expiresAt,
      pairingSecretPrinted: false,
    })}\n`);
  })
  .then(() => app.exit(0))
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    app.exit(1);
  });
