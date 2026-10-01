import { confirmForkDialog as showModal, inputForkDialog as showInputModal } from "../../react/features/settings/ForkDialogs";
import {
  buildCharacterReplacementConfirmation,
  buildCharacterSwitchConfirmation,
  renderArchivedCharacterStates,
  renderCharacterPackages,
  type CharacterSettingsSnapshot,
} from "../character-settings-view";
import type { SettingsApi } from "../shared/types";


export function initializeCharacterPanel(root: HTMLElement): () => void {
const currentName = root.querySelector("#character-current-name") as HTMLElement;
const currentMeta = root.querySelector("#character-current-meta") as HTMLElement;
const packageList = root.querySelector("#character-package-list") as HTMLElement;
const count = root.querySelector("#character-count") as HTMLElement;
const importButton = root.querySelector("#character-import-btn") as HTMLButtonElement;
const importStatus = root.querySelector("#character-import-status") as HTMLElement;
const archiveList = root.querySelector("#character-archive-list") as HTMLElement;
const archiveCount = root.querySelector("#character-archive-count") as HTMLElement;

function settingsApi(): SettingsApi {
  return (window as unknown as { settings: SettingsApi }).settings;
}

let currentSnapshot: CharacterSettingsSnapshot | null = null;
let switchInProgress = false;

function showSnapshot(snapshot: CharacterSettingsSnapshot): void {
  currentSnapshot = snapshot;
  const active = snapshot.activeCharacter;
  currentName.textContent = active?.displayName ?? "当前角色不可用";
  currentMeta.textContent = active
    ? `${active.id} · 重启后仍会恢复此角色`
    : "请根据下方诊断修复角色包";
  count.textContent = `${snapshot.packages.length} 个`;
  packageList.innerHTML = renderCharacterPackages(snapshot);
}

async function loadCharacterPackages(): Promise<void> {
  try {
    const [snapshot, archives] = await Promise.all([
      settingsApi().listCharacters(),
      settingsApi().listArchivedCharacterStates(),
    ]);
    showSnapshot(snapshot);
    archiveCount.textContent = `${archives.length} 个`;
    archiveList.innerHTML = renderArchivedCharacterStates(archives);
  } catch (error) {
    packageList.innerHTML = '<div class="character-empty">角色列表读取失败，请稍后重试。</div>';
    archiveList.innerHTML = '<div class="character-empty">归档状态读取失败，请稍后重试。</div>';
    importStatus.textContent = error instanceof Error ? error.message : String(error);
    importStatus.className = "character-import-status is-error";
  }
}

importButton.addEventListener("click", async () => {
  const sourcePath = await settingsApi().pickCharacterImportFolder();
  if (!sourcePath) return;
  importButton.disabled = true;
  importStatus.textContent = "正在检查并安装角色包…";
  importStatus.className = "character-import-status";
  try {
    let result = await settingsApi().importCharacter(sourcePath);
    if (!result.ok && result.status === "confirmation-required") {
      const confirmation = buildCharacterReplacementConfirmation(result.replacement);
      const confirmed = await showModal({
        title: confirmation.title,
        message: confirmation.message,
        icon: "📦",
        confirmText: confirmation.confirmLabel,
        cancelText: "保留现有版本",
      });
      if (!confirmed) {
        importStatus.textContent = "已取消角色包替换，现有版本保持不变。";
        return;
      }
      importStatus.textContent = "正在备份现有角色包并应用新内容…";
      result = await settingsApi().importCharacter(sourcePath, true);
    }
    if (result.ok) {
      await loadCharacterPackages();
      const action = result.operation === "installed"
        ? "安装"
        : result.operation === "upgraded"
          ? "升级"
          : result.operation === "repaired"
            ? "修复"
          : "替换";
      importStatus.textContent = `已安全${action}「${result.package.displayName}」，角色私有状态保持不变。`;
      importStatus.className = "character-import-status is-success";
    } else {
      importStatus.textContent = result.diagnostics.map(({ message }) => message).join("；") || "角色包未通过检查";
      importStatus.className = "character-import-status is-error";
    }
  } catch (error) {
    importStatus.textContent = `导入失败：${error instanceof Error ? error.message : String(error)}`;
    importStatus.className = "character-import-status is-error";
  } finally {
    importButton.disabled = false;
  }
});

packageList.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof Element) || switchInProgress) return;
  const button = target.closest<HTMLButtonElement>("[data-character-uninstall]");
  if (!button) return;
  const characterPackage = currentSnapshot?.packages.find(({ id }) => id === button.dataset.characterUninstall);
  if (!characterPackage) return;
  const confirmed = await showModal({
    title: `卸载「${characterPackage.displayName}」角色包？`,
    message: `只会移除角色包资源。聊天、记忆、关系和语音缓存会保留为归档状态；以后重装角色 ID「${characterPackage.id}」即可恢复。`,
    icon: "📦",
    confirmText: "卸载并保留状态",
    cancelText: "取消",
  });
  if (!confirmed) return;
  button.disabled = true;
  importStatus.textContent = `正在卸载「${characterPackage.displayName}」并归档状态…`;
  importStatus.className = "character-import-status";
  try {
    const result = await settingsApi().uninstallCharacter(characterPackage.id);
    if (result.ok) {
      importStatus.textContent = result.state === "archived"
        ? `已卸载「${characterPackage.displayName}」，私有状态已归档。`
        : `已卸载「${characterPackage.displayName}」，该角色没有已创建的私有状态。`;
      importStatus.className = "character-import-status is-success";
      await loadCharacterPackages();
    } else {
      importStatus.textContent = result.diagnostics.map(({ message }) => message).join("；");
      importStatus.className = "character-import-status is-error";
      button.disabled = false;
    }
  } catch (error) {
    importStatus.textContent = `卸载失败：${error instanceof Error ? error.message : String(error)}`;
    importStatus.className = "character-import-status is-error";
    button.disabled = false;
  }
});

archiveList.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest<HTMLButtonElement>("[data-character-archive-delete]");
  const characterId = button?.dataset.characterArchiveDelete;
  if (!button || !characterId) return;
  const confirmation = await showInputModal({
    title: "永久删除角色状态",
    message: `这会永久删除该角色的聊天、记忆、关系和缓存，无法撤销。请输入角色 ID「${characterId}」继续。`,
    placeholder: characterId,
    icon: "⚠️",
    confirmText: "永久删除",
    cancelText: "保留归档",
    danger: true,
  });
  if (confirmation === null) return;
  button.disabled = true;
  try {
    const result = await settingsApi().deleteArchivedCharacterState(characterId, confirmation.trim());
    if (result.ok) {
      importStatus.textContent = `已永久删除 ${result.deletedFiles} 个归档文件。`;
      importStatus.className = "character-import-status is-success";
      await loadCharacterPackages();
    } else {
      importStatus.textContent = result.diagnostics.map(({ message }) => message).join("；");
      importStatus.className = "character-import-status is-error";
      button.disabled = false;
    }
  } catch (error) {
    importStatus.textContent = `永久删除失败：${error instanceof Error ? error.message : String(error)}`;
    importStatus.className = "character-import-status is-error";
    button.disabled = false;
  }
});

packageList.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof Element) || switchInProgress) return;
  const button = target.closest<HTMLButtonElement>("[data-character-switch]");
  if (!button || button.disabled || !currentSnapshot) return;
  const characterPackage = currentSnapshot.packages.find(({ id }) => id === button.dataset.characterSwitch);
  if (!characterPackage) return;

  const confirmation = buildCharacterSwitchConfirmation(characterPackage);
  const confirmed = await showModal({
    title: confirmation.title,
    message: confirmation.message,
    icon: "🎭",
    confirmText: confirmation.confirmLabel,
    cancelText: "保持当前角色",
  });
  if (!confirmed) return;

  switchInProgress = true;
  importButton.disabled = true;
  packageList.querySelectorAll<HTMLButtonElement>("[data-character-switch]")
    .forEach((switchButton) => { switchButton.disabled = true; });
  importStatus.textContent = `正在保存当前状态，并切换到「${characterPackage.displayName}」…`;
  importStatus.className = "character-import-status";

  try {
    const result = await settingsApi().switchCharacter(characterPackage.id);
    if (result.ok) {
      importStatus.textContent = result.status === "already-active"
        ? `「${characterPackage.displayName}」已经是当前角色。`
        : `正在重启并启用「${characterPackage.displayName}」…`;
      importStatus.className = "character-import-status is-success";
      if (result.status === "already-active") await loadCharacterPackages();
      return;
    }

    const reasons = result.blockingActivities?.map(({ reason }) => reason) ?? [];
    const diagnostics = result.diagnostics.map(({ message }) => message);
    importStatus.textContent = [...reasons, ...diagnostics].filter(Boolean).join("；") || "角色切换失败";
    importStatus.className = "character-import-status is-error";
    await loadCharacterPackages();
  } catch (error) {
    importStatus.textContent = `切换失败：${error instanceof Error ? error.message : String(error)}`;
    importStatus.className = "character-import-status is-error";
  } finally {
    switchInProgress = false;
    importButton.disabled = false;
  }
});

void loadCharacterPackages();
return () => {};
}
