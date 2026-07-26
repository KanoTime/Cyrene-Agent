import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { CharacterRuntimeDiagnostic } from "./character-runtime";

export const CHARACTER_STATE_SCHEMA_VERSION = 1 as const;

export type CharacterStateLayout = Readonly<{
  root: string;
  chatsRoot: string;
  channelHistoryRoot: string;
  channelLogFile: string;
  memoryFile: string;
  entityGraphFile: string;
  memoryTraceFile: string;
  ragRoot: string;
  relationshipFile: string;
  worldbookStateFile: string;
  proactiveStateFile: string;
  ttsCacheRoot: string;
}>;

type MigrationPhase = "backup" | "staging";

export type CharacterStateMigrationResult = Readonly<{
  status: "migrated" | "already-migrated" | "not-applicable" | "failed";
  migratedEntries: number;
  diagnostics: readonly CharacterRuntimeDiagnostic[];
}>;

export interface MigrateLegacyCyreneStateOptions {
  userDataRoot: string;
  characterId: string;
  now?: () => number;
  copyEntry?: (
    sourcePath: string,
    targetPath: string,
    phase: MigrationPhase,
  ) => void | Promise<void>;
}

let configuredStateLayout: CharacterStateLayout | null = null;

export function configureActiveCharacterState(layout: CharacterStateLayout): void {
  configuredStateLayout = layout;
}

export function requireActiveCharacterState(): CharacterStateLayout {
  if (!configuredStateLayout) throw new Error("活动角色状态目录尚未就绪");
  return configuredStateLayout;
}

type LegacyStateEntry = Readonly<{
  legacyPath: string;
  relativeTarget: string;
}>;

export function resolveCharacterStateLayout(
  userDataRoot: string,
  characterId: string,
): CharacterStateLayout {
  const root = path.join(userDataRoot, "characters", characterId);
  return Object.freeze({
    root,
    chatsRoot: path.join(root, "chats"),
    channelHistoryRoot: path.join(root, "chats", "channels", "history"),
    channelLogFile: path.join(root, "chats", "channels", "log.jsonl"),
    memoryFile: path.join(root, "memory", "memory.json"),
    entityGraphFile: path.join(root, "memory", "entity-graph.json"),
    memoryTraceFile: path.join(root, "memory", "memory-trace.log"),
    ragRoot: path.join(root, "memory", "rag"),
    relationshipFile: path.join(root, "relationship", "relationship-log.json"),
    worldbookStateFile: path.join(root, "worldbook", "state.json"),
    proactiveStateFile: path.join(root, "proactive", "opener-state.json"),
    ttsCacheRoot: path.join(root, "tts", "cache"),
  });
}

function legacyStateEntries(userDataRoot: string): LegacyStateEntry[] {
  return [
    { legacyPath: path.join(userDataRoot, "cyrene-chats"), relativeTarget: "chats" },
    { legacyPath: path.join(userDataRoot, "channels", "history"), relativeTarget: path.join("chats", "channels", "history") },
    { legacyPath: path.join(userDataRoot, "channels", "log.jsonl"), relativeTarget: path.join("chats", "channels", "log.jsonl") },
    { legacyPath: path.join(userDataRoot, "memory.json"), relativeTarget: path.join("memory", "memory.json") },
    { legacyPath: path.join(userDataRoot, "entity-graph.json"), relativeTarget: path.join("memory", "entity-graph.json") },
    { legacyPath: path.join(userDataRoot, "memory-trace.log"), relativeTarget: path.join("memory", "memory-trace.log") },
    {
      legacyPath: path.join(userDataRoot, "rag-data", "memory-store.json"),
      relativeTarget: path.join("memory", "rag", "memory-store.json"),
    },
    { legacyPath: path.join(userDataRoot, "relationship-log.json"), relativeTarget: path.join("relationship", "relationship-log.json") },
    { legacyPath: path.join(userDataRoot, "worldbook-state.json"), relativeTarget: path.join("worldbook", "state.json") },
    { legacyPath: path.join(userDataRoot, "opener-state.json"), relativeTarget: path.join("proactive", "opener-state.json") },
    { legacyPath: path.join(userDataRoot, "cyrene-tts-cache"), relativeTarget: path.join("tts", "cache") },
  ];
}

function migrationMarkerPath(stateRoot: string): string {
  return path.join(stateRoot, "migration.json");
}

function hasCompletedMigration(stateRoot: string, characterId: string): boolean {
  const markerPath = migrationMarkerPath(stateRoot);
  if (!fs.existsSync(markerPath)) return false;
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8")) as Record<string, unknown>;
    return marker.schemaVersion === CHARACTER_STATE_SCHEMA_VERSION
      && marker.characterId === characterId;
  } catch {
    return false;
  }
}

async function defaultCopyEntry(sourcePath: string, targetPath: string): Promise<void> {
  await fs.promises.cp(sourcePath, targetPath, {
    recursive: true,
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
  });
}

export async function migrateLegacyCyreneState(
  options: MigrateLegacyCyreneStateOptions,
): Promise<CharacterStateMigrationResult> {
  if (options.characterId !== "cyrene") {
    return { status: "not-applicable", migratedEntries: 0, diagnostics: [] };
  }

  const layout = resolveCharacterStateLayout(options.userDataRoot, options.characterId);
  if (hasCompletedMigration(layout.root, options.characterId)) {
    return { status: "already-migrated", migratedEntries: 0, diagnostics: [] };
  }
  if (fs.existsSync(layout.root)) {
    return {
      status: "failed",
      migratedEntries: 0,
      diagnostics: [{
        code: "character.state_migration.incomplete_target",
        message: "昔涟状态目录已存在但缺少有效迁移标记，请从备份恢复后重试",
        characterId: options.characterId,
        resourcePath: layout.root,
      }],
    };
  }

  const entries = legacyStateEntries(options.userDataRoot).filter(({ legacyPath }) => fs.existsSync(legacyPath));
  const completedAt = (options.now ?? Date.now)();
  const backupRoot = path.join(
    options.userDataRoot,
    "character-state-migration-backups",
    options.characterId,
    String(completedAt),
  );
  const charactersRoot = path.dirname(layout.root);
  const stagingRoot = path.join(charactersRoot, `.migration-${options.characterId}-${randomUUID()}`);
  const copyEntry = options.copyEntry ?? defaultCopyEntry;
  let currentSource = layout.root;

  try {
    await fs.promises.mkdir(backupRoot, { recursive: true });
    for (const entry of entries) {
      currentSource = entry.legacyPath;
      const backupTarget = path.join(backupRoot, path.basename(entry.legacyPath));
      await copyEntry(entry.legacyPath, backupTarget, "backup");
    }

    await fs.promises.mkdir(stagingRoot, { recursive: true });
    for (const entry of entries) {
      currentSource = entry.legacyPath;
      const targetPath = path.join(stagingRoot, entry.relativeTarget);
      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
      await copyEntry(entry.legacyPath, targetPath, "staging");
    }

    for (const directory of [
      "chats", "memory", "relationship", "worldbook", "proactive", path.join("tts", "cache"),
    ]) {
      await fs.promises.mkdir(path.join(stagingRoot, directory), { recursive: true });
    }
    await fs.promises.writeFile(migrationMarkerPath(stagingRoot), `${JSON.stringify({
      schemaVersion: CHARACTER_STATE_SCHEMA_VERSION,
      characterId: options.characterId,
      completedAt,
      migratedLegacyEntries: entries.map(({ legacyPath }) => path.basename(legacyPath)),
    }, null, 2)}\n`, { flag: "wx" });
    await fs.promises.mkdir(charactersRoot, { recursive: true });
    await fs.promises.rename(stagingRoot, layout.root);

    return { status: "migrated", migratedEntries: entries.length, diagnostics: [] };
  } catch (error) {
    await fs.promises.rm(stagingRoot, { recursive: true, force: true });
    return {
      status: "failed",
      migratedEntries: 0,
      diagnostics: [{
        code: "character.state_migration.failed",
        message: `昔涟旧状态迁移失败：${error instanceof Error ? error.message : String(error)}`,
        characterId: options.characterId,
        resourcePath: currentSource,
      }],
    };
  }
}
