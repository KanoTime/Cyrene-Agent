const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const runtimeModule = path.join(repoRoot, "dist", "main", "main", "character", "character-runtime.js");
const fixtureRoot = path.join(repoRoot, "test-fixtures", "characters", "lumen");
const stage = process.argv.find((arg) => arg.startsWith("--stage="))?.slice("--stage=".length) ?? "first";
const suppliedRoot = process.argv.find((arg) => arg.startsWith("--root="))?.slice("--root=".length);
const userDataRoot = suppliedRoot || fs.mkdtempSync(path.join(os.tmpdir(), "cyrene-electron-character-switch-"));
const reportPath = path.join(userDataRoot, "electron-relaunch-report.json");
const lifecyclePath = path.join(userDataRoot, "electron-relaunch-lifecycle.json");

function readLifecycle() {
  try {
    return JSON.parse(fs.readFileSync(lifecyclePath, "utf8"));
  } catch {
    return { launches: [] };
  }
}

function writeLifecycle(lifecycle) {
  fs.mkdirSync(userDataRoot, { recursive: true });
  fs.writeFileSync(lifecyclePath, `${JSON.stringify(lifecycle, null, 2)}\n`);
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

app.setPath("userData", userDataRoot);

app.whenReady().then(async () => {
  const {
    createDefaultCharacterRuntime,
  } = require(runtimeModule);
  const lifecycle = readLifecycle();
  lifecycle.launches.push({ stage, pid: process.pid, startedAt: Date.now() });
  writeLifecycle(lifecycle);

  if (stage === "first") {
    const window = new BrowserWindow({ show: false });
    const firstWindowCount = BrowserWindow.getAllWindows().length;
    const runtime = createDefaultCharacterRuntime({
      appRoot: repoRoot,
      userDataRoot,
      appVersion: "0.1.0",
      switchAdapters: {
        getBlockingActivities: () => [],
        persistActiveState: () => {
          lifecycle.persisted = true;
          writeLifecycle(lifecycle);
        },
        shutdownActiveResources: () => {
          window.destroy();
          lifecycle.resourcesShutdown = true;
          writeLifecycle(lifecycle);
        },
        requestRelaunch: () => {
          lifecycle.relaunchRequested = true;
          lifecycle.firstWindowCount = firstWindowCount;
          writeLifecycle(lifecycle);
          app.relaunch({
            args: [
              __filename,
              "--stage=second",
              `--root=${userDataRoot}`,
            ],
          });
          app.exit(0);
        },
      },
    });
    await runtime.initialize();
    const imported = await runtime.importPackage(fixtureRoot);
    if (!imported.ok) {
      throw new Error(imported.diagnostics.map(({ message }) => message).join("；"));
    }
    const result = await runtime.requestSwitch("fixture.lumen");
    if (!result.ok || result.status !== "relaunch-requested") {
      throw new Error(`角色切换事务未请求重启：${JSON.stringify(result)}`);
    }
    return;
  }

  const runtime = createDefaultCharacterRuntime({
    appRoot: repoRoot,
    userDataRoot,
    appVersion: "0.1.0",
  });
  const snapshot = await runtime.initialize();
  const firstLaunch = lifecycle.launches.find((launch) => launch.stage === "first");
  const hiddenWindow = new BrowserWindow({ show: false });
  const secondWindowCount = BrowserWindow.getAllWindows().length;
  hiddenWindow.destroy();
  const runtimeState = JSON.parse(fs.readFileSync(
    path.join(userDataRoot, "character-packages", "runtime-state.json"),
    "utf8",
  ));
  const report = {
    ok: snapshot.activeCharacter?.id === "fixture.lumen"
      && runtimeState.activeCharacterId === "fixture.lumen"
      && !runtimeState.pendingCharacterId
      && lifecycle.launches.length === 2
      && lifecycle.persisted === true
      && lifecycle.resourcesShutdown === true
      && lifecycle.relaunchRequested === true
      && lifecycle.firstWindowCount === 1
      && secondWindowCount === 1
      && Boolean(firstLaunch)
      && !processExists(firstLaunch.pid),
    activeCharacterId: snapshot.activeCharacter?.id ?? null,
    runtimeState,
    launches: lifecycle.launches,
    firstProcessExited: firstLaunch ? !processExists(firstLaunch.pid) : false,
    firstWindowCount: lifecycle.firstWindowCount,
    secondWindowCount,
    persisted: lifecycle.persisted === true,
    resourcesShutdown: lifecycle.resourcesShutdown === true,
    relaunchRequested: lifecycle.relaunchRequested === true,
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  app.exit(report.ok ? 0 : 1);
}).catch((error) => {
  fs.mkdirSync(userDataRoot, { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.stack : String(error),
  }, null, 2)}\n`);
  app.exit(1);
});
