const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const outputRoot = process.argv.find((arg) => arg.startsWith("--output="))?.slice("--output=".length)
  || fs.mkdtempSync(path.join(os.tmpdir(), "cyrene-character-settings-visual-"));
const { IPC } = require(path.join(repoRoot, "dist", "main", "shared", "ipc-channels.js"));
let blockingActivities = [];
const rendererLogs = [];

const packages = [
  {
    id: "cyrene",
    displayName: "昔涟",
    version: "1.0.0",
    source: "builtin",
    readOnly: true,
    distributionStatus: "redistributable",
    capabilities: {
      worldbook: "available",
      live2d: "available",
      semanticActions: "available",
      voice: "available",
      stickers: "unavailable",
      openers: "unavailable",
    },
    health: { status: "healthy", diagnostics: [] },
  },
  {
    id: "fixture.lumen",
    displayName: "流明",
    version: "1.0.0",
    source: "local",
    readOnly: false,
    distributionStatus: "redistributable",
    capabilities: {
      worldbook: "available",
      live2d: "unavailable",
      semanticActions: "unavailable",
      voice: "available",
      stickers: "unavailable",
      openers: "unavailable",
    },
    health: { status: "healthy", diagnostics: [] },
  },
];

function register(channel, handler) {
  ipcMain.handle(channel, handler);
}

app.setPath("userData", path.join(outputRoot, "user-data"));
app.whenReady().then(async () => {
  fs.mkdirSync(outputRoot, { recursive: true });
  register(IPC.SETTINGS_GET_CONFIG, () => ({
    provider: "openai",
    baseUrl: "http://127.0.0.1:8080/v1",
    model: "qwen3.5-9b",
    apiKey: "",
    perProvider: {},
  }));
  register(IPC.SETTINGS_GET_GENERAL, () => ({}));
  register(IPC.CHARACTER_LIST, () => ({
    status: "ready",
    activeCharacter: { id: "cyrene", displayName: "昔涟" },
    packages,
    switching: { blockingActivities },
  }));
  register(IPC.CHARACTER_PICK_IMPORT_FOLDER, () => null);
  register(IPC.CHARACTER_IMPORT, () => ({ ok: false, diagnostics: [] }));
  register(IPC.CHARACTER_SWITCH, () => ({ ok: true, status: "relaunch-requested", unavailableCapabilities: [] }));
  register(IPC.CHARACTER_UNINSTALL, () => ({ ok: true, characterId: "fixture.lumen", state: "archived" }));
  register(IPC.CHARACTER_ARCHIVE_LIST, () => ([{
    characterId: "fixture.archived",
    displayName: "已归档角色",
    packageVersion: "0.9.0",
    archivedAt: "2026-07-16T00:00:00.000Z",
    fileCount: 12,
    totalBytes: 2048,
  }]));
  register(IPC.CHARACTER_ARCHIVE_DELETE, () => ({
    ok: true,
    characterId: "fixture.archived",
    deletedFiles: 12,
    deletedBytes: 2048,
  }));
  register(IPC.UI_THEME_GET, () => "dark");
  register(IPC.UI_FONT_GET, () => ({ kind: "system", family: "" }));

  const window = new BrowserWindow({
    width: 1120,
    height: 820,
    show: false,
    backgroundColor: "#17131f",
    webPreferences: {
      preload: path.join(repoRoot, "dist", "preload", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  window.webContents.on("console-message", (_event, level, message) => {
    rendererLogs.push({ level, message });
  });
  await window.loadFile(path.join(repoRoot, "dist", "renderer", "settings", "index.html"));
  const navigationState = await window.webContents.executeJavaScript(`(() => {
    const target = document.querySelector('[data-section="characters"]');
    if (!target) return { ok: false, body: document.body.innerText.slice(0, 1000) };
    target.click();
    return { ok: true };
  })()`);
  if (!navigationState.ok) {
    throw new Error(`找不到角色设置导航：${JSON.stringify({ navigationState, rendererLogs })}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 500));

  const readyState = await window.webContents.executeJavaScript(`({
    current: document.querySelector('#character-current-name')?.textContent,
    target: document.querySelector('[data-character-switch="fixture.lumen"]')?.textContent,
    disabled: document.querySelector('[data-character-switch="fixture.lumen"]')?.disabled,
    uninstall: document.querySelector('[data-character-uninstall="fixture.lumen"]')?.textContent,
    archived: document.querySelector('[data-character-archive-delete="fixture.archived"]')?.textContent,
  })`);
  fs.writeFileSync(path.join(outputRoot, "character-settings.png"), (await window.webContents.capturePage()).toPNG());

  await window.webContents.executeJavaScript(
    `document.querySelector('[data-character-switch="fixture.lumen"]').click()`,
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  const confirmationState = await window.webContents.executeJavaScript(`({
    title: document.querySelector('#cy-modal-title')?.textContent,
    message: document.querySelector('#cy-modal-message')?.textContent,
    confirm: document.querySelector('#cy-modal-confirm')?.textContent,
  })`);
  fs.writeFileSync(path.join(outputRoot, "character-switch-confirmation.png"), (await window.webContents.capturePage()).toPNG());
  await window.webContents.executeJavaScript(`document.querySelector('#cy-modal-cancel').click()`);

  await window.webContents.executeJavaScript(
    `document.querySelector('[data-character-uninstall="fixture.lumen"]').click()`,
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  const uninstallConfirmationState = await window.webContents.executeJavaScript(`({
    title: document.querySelector('#cy-modal-title')?.textContent,
    message: document.querySelector('#cy-modal-message')?.textContent,
    confirm: document.querySelector('#cy-modal-confirm')?.textContent,
    cancel: document.querySelector('#cy-modal-cancel')?.textContent,
  })`);
  fs.writeFileSync(
    path.join(outputRoot, "character-uninstall-confirmation.png"),
    (await window.webContents.capturePage()).toPNG(),
  );
  await window.webContents.executeJavaScript(`document.querySelector('#cy-modal-cancel').click()`);

  await window.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('[data-character-archive-delete="fixture.archived"]');
    button?.scrollIntoView({ block: "center" });
    button?.click();
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const archiveDeleteConfirmationState = await window.webContents.executeJavaScript(`({
    title: document.querySelector('#cy-input-title')?.textContent,
    message: document.querySelector('#cy-input-message')?.textContent,
    placeholder: document.querySelector('#cy-input-field')?.getAttribute('placeholder'),
    confirm: document.querySelector('#cy-input-confirm')?.textContent,
    confirmDanger: document.querySelector('#cy-input-confirm')?.classList.contains('is-danger'),
    cancel: document.querySelector('#cy-input-cancel')?.textContent,
  })`);
  fs.writeFileSync(
    path.join(outputRoot, "character-archive-delete-confirmation.png"),
    (await window.webContents.capturePage()).toPNG(),
  );
  await window.webContents.executeJavaScript(`document.querySelector('#cy-input-cancel').click()`);

  blockingActivities = [{ kind: "voice-call", reason: "语音通话正在进行" }];
  await new Promise((resolve) => setTimeout(resolve, 2_200));
  const busyState = await window.webContents.executeJavaScript(`({
    label: document.querySelector('[data-character-switch="fixture.lumen"]')?.textContent,
    disabled: document.querySelector('[data-character-switch="fixture.lumen"]')?.disabled,
    reason: document.querySelector('.character-switch-reason')?.textContent,
  })`);
  fs.writeFileSync(path.join(outputRoot, "character-switch-busy.png"), (await window.webContents.capturePage()).toPNG());

  const report = {
    ok: readyState.current === "昔涟"
      && readyState.target === "切换到流明"
      && readyState.disabled === false
      && readyState.uninstall === "卸载角色包"
      && readyState.archived === "永久删除状态"
      && confirmationState.title === "切换到「流明」？"
      && confirmationState.confirm === "切换并重启"
      && confirmationState.message.includes("Live2D、语义动作、表情包、主动开口")
      && uninstallConfirmationState.title === "卸载「流明」角色包？"
      && uninstallConfirmationState.confirm === "卸载并保留状态"
      && uninstallConfirmationState.cancel === "取消"
      && uninstallConfirmationState.message.includes("聊天、记忆、关系和语音缓存会保留为归档状态")
      && archiveDeleteConfirmationState.title === "永久删除角色状态"
      && archiveDeleteConfirmationState.placeholder === "fixture.archived"
      && archiveDeleteConfirmationState.confirm === "永久删除"
      && archiveDeleteConfirmationState.confirmDanger === true
      && archiveDeleteConfirmationState.cancel === "保留归档"
      && archiveDeleteConfirmationState.message.includes("无法撤销")
      && busyState.label === "暂不可切换"
      && busyState.disabled === true
      && busyState.reason === "语音通话正在进行",
    readyState,
    confirmationState,
    uninstallConfirmationState,
    archiveDeleteConfirmationState,
    busyState,
    screenshots: [
      path.join(outputRoot, "character-settings.png"),
      path.join(outputRoot, "character-switch-confirmation.png"),
      path.join(outputRoot, "character-uninstall-confirmation.png"),
      path.join(outputRoot, "character-archive-delete-confirmation.png"),
      path.join(outputRoot, "character-switch-busy.png"),
    ],
  };
  fs.writeFileSync(path.join(outputRoot, "visual-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  window.destroy();
  app.exit(report.ok ? 0 : 1);
}).catch((error) => {
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(path.join(outputRoot, "visual-report.json"), `${JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.stack : String(error),
    rendererLogs,
  }, null, 2)}\n`);
  app.exit(1);
});
