import fs from "fs";
import path from "path";
import { createHash, randomUUID } from "crypto";
import {
  migrateLegacyCyreneState,
  resolveCharacterStateLayout,
  type CharacterStateLayout,
} from "./character-state";
import { readSemanticActionMapping } from "./character-visual";
import {
  createSpeechRecognitionHints,
  readVoiceProfile,
  type CharacterVoiceProfile,
  type SpeechRecognitionHints,
} from "./character-speech";

export const CHARACTER_PACKAGE_SCHEMA_VERSION = 1 as const;
export const BUILT_IN_CYRENE_ID = "cyrene" as const;

export type CharacterCapabilityName =
  | "worldbook"
  | "live2d"
  | "semanticActions"
  | "voice"
  | "stickers"
  | "openers";

export type CharacterPackageManifest = Readonly<{
  schemaVersion: typeof CHARACTER_PACKAGE_SCHEMA_VERSION;
  id: string;
  version: string;
  displayName: string;
  distributionStatus: "redistributable" | "local-only";
  compatibility: Readonly<{
    minimumAppVersion: string;
    maximumAppVersion?: string;
  }>;
  assetProvenance: readonly Readonly<{
    assetClass: "character-content" | "avatar" | "live2d" | "voice" | "stickers" | "other";
    source: string;
    license: string;
    distributionStatus: "redistributable" | "local-only";
  }>[];
  content: Readonly<{
    identity: string;
    soul: string;
    avatar: string;
    examples?: string;
    canonQuotes?: string;
    toneRules?: string;
    stylesDirectory?: string;
    scenesDirectory?: string;
    phoneIdentity?: string;
    phoneStyle?: string;
  }>;
  speechRecognitionHints?: Readonly<{
    aliases?: readonly string[];
    terms?: readonly string[];
  }>;
  capabilities?: Readonly<{
    worldbook?: Readonly<{ directory: string }>;
    live2d?: Readonly<{ model: string }>;
    semanticActions?: Readonly<{ mapping: string }>;
    voice?: Readonly<{ profile: string }>;
    stickers?: Readonly<{ directory: string }>;
    openers?: Readonly<{ directory: string }>;
  }>;
}>;

export type CharacterRuntimeDiagnostic = Readonly<{
  code: string;
  message: string;
  characterId?: string;
  field?: string;
  resourcePath?: string;
  capability?: CharacterCapabilityName;
}>;

type UnavailableCapability = Readonly<{ status: "unavailable" }>;
type WorldbookCapability = Readonly<{ status: "available"; directoryPath: string }>;
type Live2dCapability = Readonly<{ status: "available"; modelPath: string }>;
type FileCapability = Readonly<{ status: "available"; filePath: string }>;
type DirectoryCapability = Readonly<{ status: "available"; directoryPath: string }>;
type VoiceCapability = Readonly<{
  status: "available";
  filePath: string;
  profile: CharacterVoiceProfile;
}>;

export type ActiveCharacterContext = Readonly<{
  id: string;
  displayName: string;
  version: string;
  source: "builtin" | "local";
  readOnly: boolean;
  distributionStatus: "redistributable" | "local-only";
  packageRoot: string;
  content: Readonly<{
    identityPath: string;
    soulPath: string;
    avatarPath: string;
    examplesPath?: string;
    canonQuotesPath?: string;
    toneRulesPath?: string;
    stylesDirectoryPath?: string;
    scenesDirectoryPath?: string;
    phoneIdentityPath?: string;
    phoneStylePath?: string;
  }>;
  stateRoot: string;
  state: CharacterStateLayout;
  speechRecognitionHints: SpeechRecognitionHints;
  capabilities: Readonly<{
    worldbook: WorldbookCapability | UnavailableCapability;
    live2d: Live2dCapability | UnavailableCapability;
    semanticActions: FileCapability | UnavailableCapability;
    voice: VoiceCapability | UnavailableCapability;
    stickers: DirectoryCapability | UnavailableCapability;
    openers: DirectoryCapability | UnavailableCapability;
  }>;
}>;

export type CharacterPackageHealth = Readonly<{
  status: "healthy" | "unhealthy";
  diagnostics: readonly CharacterRuntimeDiagnostic[];
}>;

export type CharacterPackageSnapshot = Readonly<{
  id: string;
  displayName: string;
  version: string;
  source: "builtin" | "local";
  readOnly: boolean;
  packageRoot: string;
  distributionStatus: "redistributable" | "local-only";
  compatibility: CharacterPackageManifest["compatibility"];
  assetProvenance: CharacterPackageManifest["assetProvenance"];
  digest?: string;
  capabilities: Readonly<Record<CharacterCapabilityName, "available" | "unavailable">>;
  health: CharacterPackageHealth;
}>;

export type CharacterRuntimeSnapshot = Readonly<{
  status: "ready" | "safe-mode" | "failed";
  activeCharacter: ActiveCharacterContext | null;
  packages: readonly CharacterPackageSnapshot[];
  diagnostics: readonly CharacterRuntimeDiagnostic[];
}>;

export type CharacterPackageSource = Readonly<{
  source: "builtin" | "local";
  rootPath: string;
  manifest: CharacterPackageManifest;
  digest?: string;
  loadDiagnostics?: readonly CharacterRuntimeDiagnostic[];
}>;

export type CharacterImportResult =
  | Readonly<{
      ok: true;
      operation: "installed" | "upgraded" | "modified" | "repaired";
      package: CharacterPackageSnapshot;
      snapshot: CharacterRuntimeSnapshot;
    }>
  | Readonly<{
      ok: false;
      status: "confirmation-required";
      replacement: CharacterReplacementPlan;
      diagnostics: readonly CharacterRuntimeDiagnostic[];
    }>
  | Readonly<{
      ok: false;
      status?: "failed";
      diagnostics: readonly CharacterRuntimeDiagnostic[];
    }>;

export type CharacterReplacementPlan = Readonly<{
  kind: "upgrade" | "modified";
  characterId: string;
  displayName: string;
  currentVersion: string;
  targetVersion: string;
  currentDigest: string;
  targetDigest: string;
  changedCapabilities: readonly CharacterCapabilityName[];
}>;

export type CharacterImportOptions = Readonly<{
  confirmReplacement?: boolean;
}>;

export type CharacterUninstallResult =
  | Readonly<{
      ok: true;
      characterId: string;
      state: "archived" | "none";
      snapshot: CharacterRuntimeSnapshot;
    }>
  | Readonly<{ ok: false; diagnostics: readonly CharacterRuntimeDiagnostic[] }>;

export type ArchivedCharacterStateSnapshot = Readonly<{
  characterId: string;
  displayName: string;
  packageVersion: string;
  archivedAt: string;
  fileCount: number;
  totalBytes: number;
}>;

export type CharacterArchiveDeleteResult =
  | Readonly<{
      ok: true;
      characterId: string;
      deletedFiles: number;
      deletedBytes: number;
    }>
  | Readonly<{ ok: false; diagnostics: readonly CharacterRuntimeDiagnostic[] }>;

export type CharacterActivityKind =
  | "agent-run"
  | "voice-call"
  | "asr"
  | "tts"
  | "proactive-generation"
  | "state-write";

export type CharacterBlockingActivity = Readonly<{
  kind: CharacterActivityKind;
  reason: string;
}>;

export interface CharacterSwitchAdapters {
  getBlockingActivities(): readonly CharacterBlockingActivity[];
  persistActiveState(): void | Promise<void>;
  shutdownActiveResources(): void | Promise<void>;
  requestRelaunch(): void | Promise<void>;
}

export type CharacterSwitchResult =
  | Readonly<{
      ok: true;
      status: "relaunch-requested";
      previousCharacterId: string;
      targetCharacterId: string;
      unavailableCapabilities: readonly CharacterCapabilityName[];
    }>
  | Readonly<{
      ok: true;
      status: "already-active";
      characterId: string;
      unavailableCapabilities: readonly CharacterCapabilityName[];
    }>
  | Readonly<{
      ok: false;
      status: "blocked";
      blockingActivities: readonly CharacterBlockingActivity[];
      diagnostics: readonly CharacterRuntimeDiagnostic[];
    }>
  | Readonly<{
      ok: false;
      status: "failed";
      diagnostics: readonly CharacterRuntimeDiagnostic[];
    }>;

export type CharacterImportLimits = Readonly<{
  maxFiles: number;
  maxTotalBytes: number;
  maxFileBytes: number;
}>;

export interface CreateCharacterRuntimeOptions {
  userDataRoot: string;
  activeCharacterId: string;
  packages: readonly CharacterPackageSource[];
  importLimits?: CharacterImportLimits;
  appVersion?: string;
  switchAdapters?: CharacterSwitchAdapters;
}

export interface CreateDefaultCharacterRuntimeOptions {
  appRoot: string;
  userDataRoot: string;
  importLimits?: CharacterImportLimits;
  appVersion?: string;
  switchAdapters?: CharacterSwitchAdapters;
}

const DEFAULT_CHARACTER_IMPORT_LIMITS: CharacterImportLimits = {
  maxFiles: 5_000,
  maxTotalBytes: 512 * 1024 * 1024,
  maxFileBytes: 256 * 1024 * 1024,
};

type EvaluatedPackage = Readonly<{
  source: CharacterPackageSource;
  health: CharacterPackageHealth;
}>;

type CharacterRegistryRecord = Readonly<{
  id: string;
  digest: string;
  installedDirectory: string;
  importedAt: string;
}>;

type CharacterRegistryFile = Readonly<{
  schemaVersion: 1;
  packages: readonly CharacterRegistryRecord[];
}>;

class CharacterImportValidationError extends Error {
  constructor(readonly diagnostic: CharacterRuntimeDiagnostic) {
    super(diagnostic.message);
    this.name = "CharacterImportValidationError";
  }
}

async function readFileHeader(filePath: string, length = 16): Promise<Buffer> {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function hasExpectedAssetSignature(extension: string, header: Buffer): boolean {
  const startsWithHex = (hex: string): boolean => header.subarray(0, hex.length / 2).toString("hex") === hex;
  const startsWithText = (text: string): boolean => header.subarray(0, text.length).toString("ascii") === text;
  switch (extension) {
    case ".png": return startsWithHex("89504e470d0a1a0a");
    case ".jpg":
    case ".jpeg": return startsWithHex("ffd8ff");
    case ".gif": return startsWithText("GIF87a") || startsWithText("GIF89a");
    case ".webp": return startsWithText("RIFF") && header.subarray(8, 12).toString("ascii") === "WEBP";
    case ".wav": return startsWithText("RIFF") && header.subarray(8, 12).toString("ascii") === "WAVE";
    case ".flac": return startsWithText("fLaC");
    case ".ogg": return startsWithText("OggS");
    case ".m4a": return header.subarray(4, 8).toString("ascii") === "ftyp";
    case ".mp3": return startsWithText("ID3") || (header.length >= 2 && header[0] === 0xff && (header[1] & 0xe0) === 0xe0);
    case ".moc3": return startsWithText("MOC3");
    default: return true;
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) {
      deepFreeze((value as Record<PropertyKey, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

function resourceDiagnostic(
  source: CharacterPackageSource,
  field: string,
  relativePath: string,
): CharacterRuntimeDiagnostic {
  const resourcePath = path.resolve(source.rootPath, relativePath);
  return {
    code: "character.core_resource.missing",
    message: `角色包核心资源不存在：${field}`,
    characterId: source.manifest.id,
    field,
    resourcePath,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

const CHARACTER_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

function isValidCharacterId(value: unknown): value is string {
  return isNonEmptyString(value) && value.length <= 64 && CHARACTER_ID_PATTERN.test(value);
}

function invalidCharacterIdDiagnostic(characterId: string): CharacterRuntimeDiagnostic {
  return {
    code: "character.id.invalid",
    message: `Character ID 格式无效：${characterId}`,
    characterId,
    field: "id",
  };
}

function compareSemver(left: string, right: string): number {
  const parse = (version: string): number[] => version.split("-", 1)[0].split(".").map(Number);
  const leftParts = parse(left);
  const rightParts = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relativePath.length > 0
    && relativePath !== ".."
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath);
}

export const LIVE2D_RESOURCE_KEYS = new Set([
  "Moc", "Textures", "Physics", "Pose", "UserData", "DisplayInfo", "File", "Sound",
]);

export function collectLive2dResourcePaths(
  value: unknown,
  result: string[] = [],
  parentKey?: string,
): string[] {
  if (typeof value === "string") {
    if (parentKey && LIVE2D_RESOURCE_KEYS.has(parentKey)) result.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectLive2dResourcePaths(item, result, parentKey);
  } else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) collectLive2dResourcePaths(item, result, key);
  }
  return result;
}

function evaluatePackage(
  source: CharacterPackageSource,
  reservedCharacterIds: ReadonlySet<string>,
  appVersion: string,
): EvaluatedPackage {
  const diagnostics: CharacterRuntimeDiagnostic[] = [...(source.loadDiagnostics ?? [])];
  const rawManifest = source.manifest as unknown as Record<string, unknown>;
  const rawContent = isRecord(rawManifest.content) ? rawManifest.content : {};
  const characterId = typeof rawManifest.id === "string" ? rawManifest.id : undefined;
  const invalidField = (field: string): void => {
    diagnostics.push({
      code: "character.manifest.invalid_field",
      message: `角色包 manifest 字段无效：${field}`,
      characterId,
      field,
    });
  };

  if (source.manifest.schemaVersion !== CHARACTER_PACKAGE_SCHEMA_VERSION) {
    diagnostics.push({
      code: "character.manifest.unsupported_schema",
      message: `不支持的角色包 schemaVersion：${source.manifest.schemaVersion}`,
      characterId: source.manifest.id,
      field: "schemaVersion",
    });
  }
  if (!isValidCharacterId(rawManifest.id)) {
    invalidField("id");
  }
  if (!isNonEmptyString(rawManifest.version) || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(rawManifest.version)) {
    invalidField("version");
  }
  if (!isNonEmptyString(rawManifest.displayName) || rawManifest.displayName.trim().length > 80) {
    invalidField("displayName");
  }
  if (rawManifest.distributionStatus !== "redistributable" && rawManifest.distributionStatus !== "local-only") {
    invalidField("distributionStatus");
  }
  const rawCompatibility = isRecord(rawManifest.compatibility) ? rawManifest.compatibility : {};
  if (!isNonEmptyString(rawCompatibility.minimumAppVersion)
    || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(rawCompatibility.minimumAppVersion)) {
    invalidField("compatibility.minimumAppVersion");
  }
  if (rawCompatibility.maximumAppVersion !== undefined
    && (!isNonEmptyString(rawCompatibility.maximumAppVersion)
      || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(rawCompatibility.maximumAppVersion))) {
    invalidField("compatibility.maximumAppVersion");
  }
  if (isNonEmptyString(rawCompatibility.minimumAppVersion)
    && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(rawCompatibility.minimumAppVersion)
    && compareSemver(appVersion, rawCompatibility.minimumAppVersion) < 0) {
    diagnostics.push({
      code: "character.compatibility.unsupported",
      message: `角色包需要 Cyrene Agent ${rawCompatibility.minimumAppVersion} 或更高版本，当前版本为 ${appVersion}`,
      characterId: source.manifest.id,
      field: "compatibility.minimumAppVersion",
    });
  }
  if (isNonEmptyString(rawCompatibility.maximumAppVersion)
    && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(rawCompatibility.maximumAppVersion)
    && compareSemver(appVersion, rawCompatibility.maximumAppVersion) > 0) {
    diagnostics.push({
      code: "character.compatibility.unsupported",
      message: `角色包最高支持 Cyrene Agent ${rawCompatibility.maximumAppVersion}，当前版本为 ${appVersion}`,
      characterId: source.manifest.id,
      field: "compatibility.maximumAppVersion",
    });
  }
  const allowedAssetClasses = new Set([
    "character-content", "avatar", "live2d", "voice", "stickers", "other",
  ]);
  if (!Array.isArray(rawManifest.assetProvenance) || rawManifest.assetProvenance.length === 0) {
    invalidField("assetProvenance");
  } else {
    rawManifest.assetProvenance.forEach((entry, index) => {
      if (!isRecord(entry)) {
        invalidField(`assetProvenance.${index}`);
        return;
      }
      if (!isNonEmptyString(entry.assetClass) || !allowedAssetClasses.has(entry.assetClass)) {
        invalidField(`assetProvenance.${index}.assetClass`);
      }
      if (!isNonEmptyString(entry.source)) invalidField(`assetProvenance.${index}.source`);
      if (!isNonEmptyString(entry.license)) invalidField(`assetProvenance.${index}.license`);
      if (entry.distributionStatus !== "redistributable" && entry.distributionStatus !== "local-only") {
        invalidField(`assetProvenance.${index}.distributionStatus`);
      }
    });
  }
  if (!isRecord(rawManifest.content)) {
    invalidField("content");
  }
  const rawSpeechHints = rawManifest.speechRecognitionHints;
  if (rawSpeechHints !== undefined && !isRecord(rawSpeechHints)) {
    invalidField("speechRecognitionHints");
  } else if (isRecord(rawSpeechHints)) {
    if (rawSpeechHints.aliases !== undefined
      && (!Array.isArray(rawSpeechHints.aliases) || !rawSpeechHints.aliases.every((value) => typeof value === "string"))) {
      invalidField("speechRecognitionHints.aliases");
    }
    if (rawSpeechHints.terms !== undefined
      && (!Array.isArray(rawSpeechHints.terms) || !rawSpeechHints.terms.every((value) => typeof value === "string"))) {
      invalidField("speechRecognitionHints.terms");
    }
    try {
      createSpeechRecognitionHints(source.manifest.displayName, {
        aliases: Array.isArray(rawSpeechHints.aliases) ? rawSpeechHints.aliases as string[] : [],
        terms: Array.isArray(rawSpeechHints.terms) ? rawSpeechHints.terms as string[] : [],
      });
    } catch (error) {
      diagnostics.push({
        code: "character.speech_hints.invalid",
        message: error instanceof Error ? error.message : String(error),
        characterId: source.manifest.id,
        field: "speechRecognitionHints",
      });
    }
  }
  if (!isNonEmptyString(rawContent.identity)) invalidField("content.identity");
  if (!isNonEmptyString(rawContent.soul)) invalidField("content.soul");
  if (!isNonEmptyString(rawContent.avatar)) invalidField("content.avatar");
  const optionalContentResources: Array<readonly [string, "file" | "directory"]> = [
    ["examples", "file"],
    ["canonQuotes", "file"],
    ["toneRules", "file"],
    ["stylesDirectory", "directory"],
    ["scenesDirectory", "directory"],
    ["phoneIdentity", "file"],
    ["phoneStyle", "file"],
  ];
  for (const [field] of optionalContentResources) {
    if (rawContent[field] !== undefined && !isNonEmptyString(rawContent[field])) {
      invalidField(`content.${field}`);
    }
  }
  const rawCapabilities = rawManifest.capabilities === undefined
    ? undefined
    : isRecord(rawManifest.capabilities)
      ? rawManifest.capabilities
      : null;
  if (rawCapabilities === null) invalidField("capabilities");
  if (source.source === "local" && reservedCharacterIds.has(source.manifest.id)) {
    diagnostics.push({
      code: "character.id.reserved",
      message: `本地角色包不能使用内置 Character ID：${source.manifest.id}`,
      characterId: source.manifest.id,
      field: "id",
    });
  }
  const coreResources: Array<readonly [string, string]> = [];
  if (isNonEmptyString(rawContent.identity)) coreResources.push(["content.identity", rawContent.identity]);
  if (isNonEmptyString(rawContent.soul)) coreResources.push(["content.soul", rawContent.soul]);
  if (isNonEmptyString(rawContent.avatar)) coreResources.push(["content.avatar", rawContent.avatar]);

  for (const [field, kind] of optionalContentResources) {
    const relativePath = rawContent[field];
    if (!isNonEmptyString(relativePath)) continue;
    const resourcePath = path.resolve(source.rootPath, relativePath);
    if (!isPathInside(source.rootPath, resourcePath)) {
      diagnostics.push({
        code: "character.resource.outside_package",
        message: `角色包资源必须位于包目录内：content.${field}`,
        characterId: source.manifest.id,
        field: `content.${field}`,
        resourcePath,
      });
      continue;
    }
    const exists = fs.existsSync(resourcePath);
    const hasExpectedKind = exists && (kind === "file"
      ? fs.statSync(resourcePath).isFile()
      : fs.statSync(resourcePath).isDirectory());
    if (!hasExpectedKind) {
      diagnostics.push(resourceDiagnostic(source, `content.${field}`, relativePath));
    }
  }

  for (const [field, relativePath] of coreResources) {
    const resourcePath = path.resolve(source.rootPath, relativePath);
    if (!isPathInside(source.rootPath, resourcePath)) {
      diagnostics.push({
        code: "character.resource.outside_package",
        message: `角色包资源必须位于包目录内：${field}`,
        characterId: source.manifest.id,
        field,
        resourcePath,
      });
      continue;
    }
    if (!fs.existsSync(resourcePath) || !fs.statSync(resourcePath).isFile()) {
      diagnostics.push(resourceDiagnostic(source, field, relativePath));
    }
  }

  const declaredCapabilities: Array<{
    capability: CharacterCapabilityName;
    field: string;
    relativePath: string;
    kind: "file" | "directory";
  }> = [];
  const addCapabilityResource = (
    capability: CharacterCapabilityName,
    resourceField: string,
    kind: "file" | "directory",
  ): void => {
    if (!rawCapabilities) return;
    const rawCapability = rawCapabilities[capability];
    if (rawCapability === undefined) return;
    if (!isRecord(rawCapability)) {
      invalidField(`capabilities.${capability}`);
      return;
    }
    const field = `capabilities.${capability}.${resourceField}`;
    const relativePath = rawCapability[resourceField];
    if (!isNonEmptyString(relativePath)) {
      invalidField(field);
      return;
    }
    declaredCapabilities.push({ capability, field, relativePath, kind });
  };
  addCapabilityResource("worldbook", "directory", "directory");
  addCapabilityResource("live2d", "model", "file");
  addCapabilityResource("semanticActions", "mapping", "file");
  addCapabilityResource("voice", "profile", "file");
  addCapabilityResource("stickers", "directory", "directory");
  addCapabilityResource("openers", "directory", "directory");

  for (const declared of declaredCapabilities) {
    const resourcePath = path.resolve(source.rootPath, declared.relativePath);
    if (!isPathInside(source.rootPath, resourcePath)) {
      diagnostics.push({
        code: "character.resource.outside_package",
        message: `角色包资源必须位于包目录内：${declared.field}`,
        characterId: source.manifest.id,
        capability: declared.capability,
        field: declared.field,
        resourcePath,
      });
      continue;
    }
    const exists = fs.existsSync(resourcePath);
    const hasExpectedKind = exists && (declared.kind === "file"
      ? fs.statSync(resourcePath).isFile()
      : fs.statSync(resourcePath).isDirectory());
    if (!hasExpectedKind) {
      diagnostics.push({
        code: "character.capability_resource.missing",
        message: `角色包声明的能力资源无效：${declared.field}`,
        characterId: source.manifest.id,
        capability: declared.capability,
        field: declared.field,
        resourcePath,
      });
    }
  }

  const live2dModel = rawCapabilities && isRecord(rawCapabilities.live2d)
    ? rawCapabilities.live2d.model
    : undefined;
  if (isNonEmptyString(live2dModel)) {
    const modelPath = path.resolve(source.rootPath, live2dModel);
    if (isPathInside(source.rootPath, modelPath) && fs.existsSync(modelPath) && fs.statSync(modelPath).isFile()) {
      try {
        const model = JSON.parse(fs.readFileSync(modelPath, "utf8")) as unknown;
        const fileReferences = isRecord(model) ? model.FileReferences : undefined;
        for (const reference of collectLive2dResourcePaths(fileReferences)) {
          const referencedPath = path.resolve(path.dirname(modelPath), reference);
          if (!isPathInside(source.rootPath, referencedPath)) {
            diagnostics.push({
              code: "character.live2d.reference_outside_package",
              message: `Live2D 资源引用必须位于角色包内：${reference}`,
              characterId: source.manifest.id,
              capability: "live2d",
              field: "capabilities.live2d.model",
              resourcePath: referencedPath,
            });
          } else if (!fs.existsSync(referencedPath) || !fs.statSync(referencedPath).isFile()) {
            diagnostics.push({
              code: "character.live2d.reference_missing",
              message: `Live2D 引用的资源不存在：${reference}`,
              characterId: source.manifest.id,
              capability: "live2d",
              field: "capabilities.live2d.model",
              resourcePath: referencedPath,
            });
          }
        }
      } catch (error) {
        diagnostics.push({
          code: "character.live2d.model_invalid",
          message: `Live2D 模型配置无法解析：${error instanceof Error ? error.message : String(error)}`,
          characterId: source.manifest.id,
          capability: "live2d",
          field: "capabilities.live2d.model",
          resourcePath: modelPath,
        });
      }
    }
  }

  const semanticMapping = rawCapabilities && isRecord(rawCapabilities.semanticActions)
    ? rawCapabilities.semanticActions.mapping
    : undefined;
  if (isNonEmptyString(semanticMapping)) {
    const mappingPath = path.resolve(source.rootPath, semanticMapping);
    const modelPath = isNonEmptyString(live2dModel)
      ? path.resolve(source.rootPath, live2dModel)
      : "";
    try {
      if (!modelPath) throw new Error("声明 Semantic Actions 前必须声明 Live2D 模型");
      if (!fs.existsSync(mappingPath) || !fs.statSync(mappingPath).isFile()) {
        throw new Error("Semantic Actions 映射文件不存在");
      }
      const mapping = readSemanticActionMapping(mappingPath);
      const model = JSON.parse(fs.readFileSync(modelPath, "utf8")) as Record<string, unknown>;
      const fileReferences = isRecord(model.FileReferences) ? model.FileReferences : {};
      const rawMotions = isRecord(fileReferences.Motions) ? fileReferences.Motions : {};
      const motionKeys = new Set<string>();
      for (const [group, entries] of Object.entries(rawMotions)) {
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
          if (isRecord(entry) && isNonEmptyString(entry.Name)) motionKeys.add(`${group}\0${entry.Name}`);
        }
      }
      const expressionNames = new Set<string>();
      if (Array.isArray(fileReferences.Expressions)) {
        for (const entry of fileReferences.Expressions) {
          if (isRecord(entry) && isNonEmptyString(entry.Name)) expressionNames.add(entry.Name);
        }
      }
      for (const [actionId, target] of Object.entries(mapping.actions)) {
        const exists = target.kind === "motion"
          ? motionKeys.has(`${target.group}\0${target.motionName}`)
          : expressionNames.has(target.name);
        if (!exists) throw new Error(`Semantic Action ${actionId} 指向模型中不存在的目标`);
      }
    } catch (error) {
      diagnostics.push({
        code: "character.semantic_actions.invalid",
        message: `Semantic Actions 映射无效：${error instanceof Error ? error.message : String(error)}`,
        characterId: source.manifest.id,
        capability: "semanticActions",
        field: "capabilities.semanticActions.mapping",
        resourcePath: mappingPath,
      });
    }
  }

  const voiceProfile = rawCapabilities && isRecord(rawCapabilities.voice)
    ? rawCapabilities.voice.profile
    : undefined;
  if (isNonEmptyString(voiceProfile)) {
    const profilePath = path.resolve(source.rootPath, voiceProfile);
    if (isPathInside(source.rootPath, profilePath) && fs.existsSync(profilePath) && fs.statSync(profilePath).isFile()) {
      try {
        readVoiceProfile(profilePath, source.rootPath, source.source === "builtin" && source.manifest.id === BUILT_IN_CYRENE_ID);
      } catch (error) {
        diagnostics.push({
          code: "character.voice_profile.invalid",
          message: `Voice Profile 无效：${error instanceof Error ? error.message : String(error)}`,
          characterId: source.manifest.id,
          capability: "voice",
          field: "capabilities.voice.profile",
          resourcePath: profilePath,
        });
      }
    }
  }

  return {
    source,
    health: {
      status: diagnostics.length === 0 ? "healthy" : "unhealthy",
      diagnostics,
    },
  };
}

function unavailable(): UnavailableCapability {
  return { status: "unavailable" };
}

function buildActiveContext(
  evaluated: EvaluatedPackage,
  userDataRoot: string,
): ActiveCharacterContext {
  const { source } = evaluated;
  const { manifest } = source;
  const capabilities = manifest.capabilities;
  const state = resolveCharacterStateLayout(userDataRoot, manifest.id);
  const speechRecognitionHints = createSpeechRecognitionHints(
    manifest.displayName,
    manifest.speechRecognitionHints,
  );
  return {
    id: manifest.id,
    displayName: manifest.displayName,
    version: manifest.version,
    source: source.source,
    readOnly: source.source === "builtin",
    distributionStatus: manifest.distributionStatus,
    packageRoot: path.resolve(source.rootPath),
    content: {
      identityPath: path.resolve(source.rootPath, manifest.content.identity),
      soulPath: path.resolve(source.rootPath, manifest.content.soul),
      avatarPath: path.resolve(source.rootPath, manifest.content.avatar),
      ...(manifest.content.examples
        ? { examplesPath: path.resolve(source.rootPath, manifest.content.examples) }
        : {}),
      ...(manifest.content.canonQuotes
        ? { canonQuotesPath: path.resolve(source.rootPath, manifest.content.canonQuotes) }
        : {}),
      ...(manifest.content.toneRules
        ? { toneRulesPath: path.resolve(source.rootPath, manifest.content.toneRules) }
        : {}),
      ...(manifest.content.stylesDirectory
        ? { stylesDirectoryPath: path.resolve(source.rootPath, manifest.content.stylesDirectory) }
        : {}),
      ...(manifest.content.scenesDirectory
        ? { scenesDirectoryPath: path.resolve(source.rootPath, manifest.content.scenesDirectory) }
        : {}),
      ...(manifest.content.phoneIdentity
        ? { phoneIdentityPath: path.resolve(source.rootPath, manifest.content.phoneIdentity) }
        : {}),
      ...(manifest.content.phoneStyle
        ? { phoneStylePath: path.resolve(source.rootPath, manifest.content.phoneStyle) }
        : {}),
    },
    stateRoot: state.root,
    state,
    speechRecognitionHints,
    capabilities: {
      worldbook: capabilities?.worldbook
        ? { status: "available", directoryPath: path.resolve(source.rootPath, capabilities.worldbook.directory) }
        : unavailable(),
      live2d: capabilities?.live2d
        ? { status: "available", modelPath: path.resolve(source.rootPath, capabilities.live2d.model) }
        : unavailable(),
      semanticActions: capabilities?.semanticActions
        ? { status: "available", filePath: path.resolve(source.rootPath, capabilities.semanticActions.mapping) }
        : unavailable(),
      voice: capabilities?.voice
        ? {
            status: "available",
            filePath: path.resolve(source.rootPath, capabilities.voice.profile),
            profile: readVoiceProfile(
              path.resolve(source.rootPath, capabilities.voice.profile),
              source.rootPath,
              source.source === "builtin" && manifest.id === BUILT_IN_CYRENE_ID,
            ),
          }
        : unavailable(),
      stickers: capabilities?.stickers
        ? { status: "available", directoryPath: path.resolve(source.rootPath, capabilities.stickers.directory) }
        : unavailable(),
      openers: capabilities?.openers
        ? { status: "available", directoryPath: path.resolve(source.rootPath, capabilities.openers.directory) }
        : unavailable(),
    },
  };
}

function toPackageSnapshot(evaluated: EvaluatedPackage): CharacterPackageSnapshot {
  const { source, health } = evaluated;
  const capabilityNames: CharacterCapabilityName[] = [
    "worldbook", "live2d", "semanticActions", "voice", "stickers", "openers",
  ];
  const capabilities = Object.fromEntries(capabilityNames.map((capability) => [
    capability,
    source.manifest.capabilities?.[capability]
      && !health.diagnostics.some((diagnostic) => diagnostic.capability === capability)
      ? "available"
      : "unavailable",
  ])) as Record<CharacterCapabilityName, "available" | "unavailable">;
  return {
    id: source.manifest.id,
    displayName: source.manifest.displayName,
    version: source.manifest.version,
    source: source.source,
    readOnly: source.source === "builtin",
    packageRoot: path.resolve(source.rootPath),
    distributionStatus: source.manifest.distributionStatus,
    compatibility: source.manifest.compatibility,
    assetProvenance: source.manifest.assetProvenance,
    digest: source.digest,
    capabilities,
    health,
  };
}

function readCharacterRegistry(registryPath: string): CharacterRegistryFile {
  if (!fs.existsSync(registryPath)) return { schemaVersion: 1, packages: [] };
  const parsed = JSON.parse(fs.readFileSync(registryPath, "utf8")) as CharacterRegistryFile;
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.packages)) {
    throw new Error("Character Registry 格式无效");
  }
  return parsed;
}

async function writeCharacterRegistryAtomic(
  packageStorageRoot: string,
  registryPath: string,
  registry: CharacterRegistryFile,
): Promise<void> {
  await fs.promises.mkdir(packageStorageRoot, { recursive: true });
  const temporary = path.join(packageStorageRoot, `.registry-${randomUUID()}.tmp`);
  try {
    await fs.promises.writeFile(temporary, `${JSON.stringify(registry, null, 2)}\n`, { flag: "wx" });
    await fs.promises.rename(temporary, registryPath);
  } finally {
    if (fs.existsSync(temporary)) await fs.promises.rm(temporary, { force: true });
  }
}

async function measureDirectory(directoryPath: string): Promise<{ fileCount: number; totalBytes: number }> {
  let fileCount = 0;
  let totalBytes = 0;
  if (!fs.existsSync(directoryPath)) return { fileCount, totalBytes };
  const visit = async (currentPath: string): Promise<void> => {
    const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`归档状态包含不允许的符号链接：${entryPath}`);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile()) {
        fileCount += 1;
        totalBytes += (await fs.promises.stat(entryPath)).size;
      }
    }
  };
  await visit(directoryPath);
  return { fileCount, totalBytes };
}

function loadInstalledPackageSources(
  registryPath: string,
  installedRoot: string,
): CharacterPackageSource[] {
  const registry = readCharacterRegistry(registryPath);
  return registry.packages.map((record) => {
    const rootPath = path.join(installedRoot, record.installedDirectory);
    const fallbackManifest: CharacterPackageManifest = {
      schemaVersion: 1,
      id: record.id,
      version: "0.0.0",
      displayName: record.id,
      distributionStatus: "local-only",
      compatibility: { minimumAppVersion: "0.1.0" },
      assetProvenance: [{
        assetClass: "character-content",
        source: "Character Registry recovery placeholder",
        license: "unknown",
        distributionStatus: "local-only",
      }],
      content: {
        identity: ".missing/identity.md",
        soul: ".missing/soul.md",
        avatar: ".missing/avatar.png",
      },
    };
    if (!fs.existsSync(rootPath)) {
      return {
        source: "local",
        rootPath,
        manifest: fallbackManifest,
        digest: record.digest,
        loadDiagnostics: [{
          code: "character.package.missing",
          message: `Character Registry 中的角色包目录不存在：${record.id}`,
          characterId: record.id,
          resourcePath: rootPath,
        }],
      };
    }
    try {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(rootPath, "character.json"), "utf8"),
      ) as CharacterPackageManifest;
      return { source: "local", rootPath, manifest, digest: record.digest };
    } catch (error) {
      return {
        source: "local",
        rootPath,
        manifest: fallbackManifest,
        digest: record.digest,
        loadDiagnostics: [{
          code: "character.package.manifest_unreadable",
          message: `角色包 manifest 无法读取：${error instanceof Error ? error.message : String(error)}`,
          characterId: record.id,
          resourcePath: path.join(rootPath, "character.json"),
        }],
      };
    }
  });
}

async function copyPackageDirectory(
  sourceRoot: string,
  targetRoot: string,
  packageRoot = sourceRoot,
  context: {
    readonly limits: CharacterImportLimits;
    fileCount: number;
    totalBytes: number;
  } = {
    limits: DEFAULT_CHARACTER_IMPORT_LIMITS,
    fileCount: 0,
    totalBytes: 0,
  },
): Promise<void> {
  const sourceStat = await fs.promises.lstat(sourceRoot);
  if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) {
    throw new CharacterImportValidationError({
      code: "character.import.symlink",
      message: "角色包来源必须是普通目录，不能是符号链接",
      resourcePath: sourceRoot,
    });
  }
  await fs.promises.mkdir(targetRoot, { recursive: false });
  const entries = await fs.promises.readdir(sourceRoot, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceRoot, entry.name);
    const targetPath = path.join(targetRoot, entry.name);
    const stat = await fs.promises.lstat(sourcePath);
    const relativePath = path.relative(packageRoot, sourcePath).split(path.sep).join("/");
    const prohibitedDirectoryNames = new Set(["skills", "scripts", "plugins", "mcp", ".mcp"]);
    const prohibitedFileNames = new Set(["skill.md", "mcp.json", ".mcp.json", "plugin.json", "package.json"]);
    if ((stat.isDirectory() && prohibitedDirectoryNames.has(entry.name.toLowerCase()))
      || (stat.isFile() && prohibitedFileNames.has(entry.name.toLowerCase()))) {
      throw new CharacterImportValidationError({
        code: "character.import.definition_not_allowed",
        message: `角色包不能包含脚本、Skill、Plugin 或 MCP 定义：${relativePath}`,
        resourcePath: sourcePath,
      });
    }
    if (stat.isSymbolicLink()) {
      throw new CharacterImportValidationError({
        code: "character.import.symlink",
        message: `角色包不能包含符号链接：${relativePath}`,
        resourcePath: sourcePath,
      });
    }
    if (stat.isDirectory()) {
      await copyPackageDirectory(sourcePath, targetPath, packageRoot, context);
    } else if (stat.isFile()) {
      context.fileCount += 1;
      context.totalBytes += stat.size;
      if (context.fileCount > context.limits.maxFiles) {
        throw new CharacterImportValidationError({
          code: "character.import.limit_exceeded",
          message: `角色包文件数量超过限制：最多 ${context.limits.maxFiles} 个文件`,
          resourcePath: packageRoot,
        });
      }
      if (stat.size > context.limits.maxFileBytes) {
        throw new CharacterImportValidationError({
          code: "character.import.limit_exceeded",
          message: `角色包单个文件超过限制：${relativePath}`,
          resourcePath: sourcePath,
        });
      }
      if (context.totalBytes > context.limits.maxTotalBytes) {
        throw new CharacterImportValidationError({
          code: "character.import.limit_exceeded",
          message: "角色包总大小超过限制",
          resourcePath: packageRoot,
        });
      }
      if ((stat.mode & 0o111) !== 0) {
        throw new CharacterImportValidationError({
          code: "character.import.executable",
          message: `角色包数据文件不能具有执行权限：${relativePath}`,
          resourcePath: sourcePath,
        });
      }
      const allowedExtensions = new Set([
        ".json", ".md", ".txt",
        ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg",
        ".wav", ".mp3", ".flac", ".ogg", ".m4a",
        ".moc3",
      ]);
      if (!allowedExtensions.has(path.extname(entry.name).toLowerCase())) {
        throw new CharacterImportValidationError({
          code: "character.import.file_type_not_allowed",
          message: `角色包文件类型不在白名单内：${relativePath}`,
          resourcePath: sourcePath,
        });
      }
      const extension = path.extname(entry.name).toLowerCase();
      if (extension === ".json") {
        try {
          JSON.parse(await fs.promises.readFile(sourcePath, "utf8"));
        } catch {
          throw new CharacterImportValidationError({
            code: "character.import.malformed_json",
            message: `角色包包含无法解析的 JSON：${relativePath}`,
            resourcePath: sourcePath,
          });
        }
      }
      if (extension === ".svg") {
        const svg = await fs.promises.readFile(sourcePath, "utf8");
        const containsActiveContent = /<\s*(?:script|foreignObject)\b/i.test(svg)
          || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(svg)
          || /\son[a-z]+\s*=/i.test(svg)
          || /(?:href|src)\s*=\s*["']\s*(?:https?:|data:|javascript:)/i.test(svg);
        if (containsActiveContent) {
          throw new CharacterImportValidationError({
            code: "character.import.unsafe_svg",
            message: `角色包 SVG 包含不安全的活动内容：${relativePath}`,
            resourcePath: sourcePath,
          });
        }
      }
      if (!hasExpectedAssetSignature(extension, await readFileHeader(sourcePath))) {
        throw new CharacterImportValidationError({
          code: "character.import.malformed_asset",
          message: `角色包资源内容与扩展名不匹配：${relativePath}`,
          resourcePath: sourcePath,
        });
      }
      await fs.promises.copyFile(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
    } else {
      throw new Error(`角色包包含不支持的文件类型：${sourcePath}`);
    }
  }
}

async function calculatePackageDigest(rootPath: string): Promise<string> {
  const hash = createHash("sha256");
  const visit = async (directory: string): Promise<void> => {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const filePath = path.join(directory, entry.name);
      const relativePath = path.relative(rootPath, filePath).split(path.sep).join("/");
      if (entry.isDirectory()) {
        hash.update(`directory\0${relativePath}\0`);
        await visit(filePath);
      } else if (entry.isFile()) {
        hash.update(`file\0${relativePath}\0`);
        hash.update(await fs.promises.readFile(filePath));
        hash.update("\0");
      }
    }
  };
  await visit(rootPath);
  return hash.digest("hex");
}

type CharacterRuntimeState = Readonly<{
  schemaVersion: 1;
  activeCharacterId: string;
  pendingCharacterId?: string;
  previousCharacterId?: string;
}>;

function readRuntimeState(filePath: string): CharacterRuntimeState | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<CharacterRuntimeState>;
    if (parsed.schemaVersion !== 1 || typeof parsed.activeCharacterId !== "string") return null;
    return {
      schemaVersion: 1,
      activeCharacterId: parsed.activeCharacterId,
      ...(typeof parsed.pendingCharacterId === "string" ? { pendingCharacterId: parsed.pendingCharacterId } : {}),
      ...(typeof parsed.previousCharacterId === "string" ? { previousCharacterId: parsed.previousCharacterId } : {}),
    };
  } catch {
    return null;
  }
}

function writeRuntimeState(filePath: string, state: CharacterRuntimeState): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx" });
    fs.renameSync(temporary, filePath);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

const UNCONFIGURED_SWITCH_ADAPTERS: CharacterSwitchAdapters = {
  getBlockingActivities: () => [],
  persistActiveState: () => undefined,
  shutdownActiveResources: () => undefined,
  requestRelaunch: () => { throw new Error("Electron relaunch adapter is not configured"); },
};

export class CharacterRuntime {
  private snapshot: CharacterRuntimeSnapshot | null = null;
  private readonly packageStorageRoot: string;
  private readonly installedRoot: string;
  private readonly stagingRoot: string;
  private readonly registryPath: string;
  private readonly runtimeStatePath: string;
  private readonly archivedStateRoot: string;
  private packageSources: CharacterPackageSource[];
  private installedSourcesLoaded = false;
  private startupDiagnostics: CharacterRuntimeDiagnostic[] = [];
  private readonly importLimits: CharacterImportLimits;
  private readonly appVersion: string;
  private readonly switchAdapters: CharacterSwitchAdapters;
  private switchTransactionRunning = false;

  constructor(private readonly options: CreateCharacterRuntimeOptions) {
    this.packageStorageRoot = path.join(options.userDataRoot, "character-packages");
    this.installedRoot = path.join(this.packageStorageRoot, "installed");
    this.stagingRoot = path.join(this.packageStorageRoot, ".staging");
    this.registryPath = path.join(this.packageStorageRoot, "registry.json");
    this.runtimeStatePath = path.join(this.packageStorageRoot, "runtime-state.json");
    this.archivedStateRoot = path.join(options.userDataRoot, "archived-character-states");
    this.packageSources = [...options.packages];
    this.importLimits = options.importLimits ?? DEFAULT_CHARACTER_IMPORT_LIMITS;
    this.appVersion = options.appVersion ?? "0.1.0";
    this.switchAdapters = options.switchAdapters ?? UNCONFIGURED_SWITCH_ADAPTERS;
  }

  async initialize(): Promise<CharacterRuntimeSnapshot> {
    if (this.snapshot) return this.snapshot;

    if (!this.installedSourcesLoaded) {
      try {
        const installedSources = loadInstalledPackageSources(this.registryPath, this.installedRoot);
        const knownRoots = new Set(this.packageSources.map(({ rootPath }) => path.resolve(rootPath)));
        this.packageSources.push(...installedSources.filter(({ rootPath }) => !knownRoots.has(path.resolve(rootPath))));
      } catch (error) {
        this.startupDiagnostics.push({
          code: "character.registry.unreadable",
          message: `Character Registry 无法读取：${error instanceof Error ? error.message : String(error)}`,
          resourcePath: this.registryPath,
        });
      }
      this.installedSourcesLoaded = true;
    }

    const reservedCharacterIds = new Set(
      this.packageSources
        .filter(({ source }) => source === "builtin")
        .map(({ manifest }) => manifest.id),
    );
    const evaluated = this.packageSources.map((source) => evaluatePackage(source, reservedCharacterIds, this.appVersion));
    const runtimeState = readRuntimeState(this.runtimeStatePath);
    const requestedCharacterId = runtimeState?.pendingCharacterId
      ?? runtimeState?.activeCharacterId
      ?? this.options.activeCharacterId;
    const diagnostics: CharacterRuntimeDiagnostic[] = [
      ...this.startupDiagnostics,
      ...evaluated.flatMap(({ health }) => health.diagnostics),
    ];
    const findPackage = (characterId: string | undefined): EvaluatedPackage | undefined => {
      if (!characterId) return undefined;
      const matches = evaluated.filter(({ source }) => source.manifest.id === characterId);
      return matches.find(({ source }) => source.source === "builtin") ?? matches[0];
    };
    const fallback = findPackage(BUILT_IN_CYRENE_ID);
    let active = findPackage(requestedCharacterId);
    let fallbackRequired = false;

    if (runtimeState?.pendingCharacterId && (!active || active.health.status !== "healthy")) {
      diagnostics.push({
        code: "character.switch.target_startup_failed",
        message: `目标角色启动失败，已恢复上一角色：${runtimeState.pendingCharacterId}`,
        characterId: runtimeState.pendingCharacterId,
      });
      const rollbackCharacterId = runtimeState.previousCharacterId ?? runtimeState.activeCharacterId;
      const rollback = findPackage(rollbackCharacterId);
      if (rollback?.health.status === "healthy") {
        active = rollback;
        try {
          writeRuntimeState(this.runtimeStatePath, {
            schemaVersion: 1,
            activeCharacterId: rollbackCharacterId,
          });
        } catch (error) {
          diagnostics.push({
            code: "character.switch.rollback_persist_failed",
            message: `角色回滚状态写入失败：${error instanceof Error ? error.message : String(error)}`,
            characterId: rollbackCharacterId,
            resourcePath: this.runtimeStatePath,
          });
          active = undefined;
          fallbackRequired = true;
        }
      } else {
        diagnostics.push({
          code: "character.startup.previous_unavailable",
          message: `上一角色也不可用，将尝试恢复内置昔涟：${rollbackCharacterId}`,
          characterId: rollbackCharacterId,
        });
        active = undefined;
        fallbackRequired = true;
      }
    } else if (runtimeState?.pendingCharacterId && active?.health.status === "healthy") {
      try {
        writeRuntimeState(this.runtimeStatePath, {
          schemaVersion: 1,
          activeCharacterId: runtimeState.pendingCharacterId,
        });
      } catch (error) {
        diagnostics.push({
          code: "character.switch.commit_failed",
          message: `目标角色状态提交失败：${error instanceof Error ? error.message : String(error)}`,
          characterId: runtimeState.pendingCharacterId,
          resourcePath: this.runtimeStatePath,
        });
        active = undefined;
        fallbackRequired = true;
      }
    } else if (!active) {
      if (fallback) {
        diagnostics.push({
          code: "character.startup.active_missing",
          message: `持久化活动角色不存在：${requestedCharacterId}`,
          characterId: requestedCharacterId,
        });
        fallbackRequired = true;
      }
    } else if (active.health.status !== "healthy") {
      if (fallback && active !== fallback) {
        diagnostics.push({
          code: "character.startup.active_unhealthy",
          message: `持久化活动角色不健康：${requestedCharacterId}`,
          characterId: requestedCharacterId,
        });
        active = undefined;
        fallbackRequired = true;
      } else if (active === fallback) {
        active = undefined;
      }
    }

    if (fallbackRequired && fallback?.health.status === "healthy") {
      active = fallback;
      diagnostics.push({
        code: "character.startup.fallback_activated",
        message: "已临时回退到内置昔涟，故障角色及其私有状态保持原位。",
        characterId: BUILT_IN_CYRENE_ID,
      });
      try {
        writeRuntimeState(this.runtimeStatePath, {
          schemaVersion: 1,
          activeCharacterId: BUILT_IN_CYRENE_ID,
        });
      } catch (error) {
        diagnostics.push({
          code: "character.startup.fallback_persist_failed",
          message: `回退角色状态写入失败：${error instanceof Error ? error.message : String(error)}`,
          characterId: BUILT_IN_CYRENE_ID,
          resourcePath: this.runtimeStatePath,
        });
      }
    }

    if (!active && !fallbackRequired) {
      diagnostics.push({
        code: "character.active.missing",
        message: `找不到活动角色：${requestedCharacterId}`,
        characterId: requestedCharacterId,
      });
    }

    if (active?.health.status === "healthy") {
      const migration = await migrateLegacyCyreneState({
        userDataRoot: this.options.userDataRoot,
        characterId: active.source.manifest.id,
      });
      diagnostics.push(...migration.diagnostics);
    }

    const ready = Boolean(active && active.health.status === "healthy");
    const safeMode = !ready && Boolean(fallback) && fallback?.health.status !== "healthy";
    if (safeMode) {
      diagnostics.push({
        code: "character.startup.safe_mode",
        message: "内置昔涟角色包也不可用，已进入诊断安全模式；不会加载部分角色资源。",
        characterId: BUILT_IN_CYRENE_ID,
        resourcePath: fallback?.source.rootPath,
      });
    }
    this.snapshot = deepFreeze({
      status: ready ? "ready" : safeMode ? "safe-mode" : "failed",
      activeCharacter: ready && active ? buildActiveContext(active, this.options.userDataRoot) : null,
      packages: evaluated.map(toPackageSnapshot),
      diagnostics,
    });
    return this.snapshot;
  }

  getSnapshot(): CharacterRuntimeSnapshot {
    if (!this.snapshot) throw new Error("CharacterRuntime 尚未初始化");
    return this.snapshot;
  }

  getBlockingActivities(): readonly CharacterBlockingActivity[] {
    return deepFreeze([...this.switchAdapters.getBlockingActivities()]);
  }

  async requestSwitch(targetCharacterId: string): Promise<CharacterSwitchResult> {
    const snapshot = await this.initialize();
    const currentCharacterId = snapshot.activeCharacter?.id;
    if (!currentCharacterId) {
      return deepFreeze({
        ok: false,
        status: "failed",
        diagnostics: [{
          code: "character.switch.no_active_character",
          message: "当前没有可持久化的活动角色，无法切换。",
        }],
      });
    }

    const existingRuntimeState = readRuntimeState(this.runtimeStatePath);
    if (this.switchTransactionRunning || existingRuntimeState?.pendingCharacterId) {
      const blockingActivities: readonly CharacterBlockingActivity[] = [{
        kind: "state-write",
        reason: this.switchTransactionRunning ? "角色切换事务正在执行" : "角色切换正在等待受控重启",
      }];
      return deepFreeze({
        ok: false,
        status: "blocked",
        blockingActivities,
        diagnostics: [{
          code: "character.switch.pending",
          message: existingRuntimeState?.pendingCharacterId
            ? `角色切换正在等待受控重启：${existingRuntimeState.pendingCharacterId}`
            : "已有角色切换事务正在执行。",
          characterId: existingRuntimeState?.pendingCharacterId ?? currentCharacterId,
        }],
      });
    }

    const reservedCharacterIds = new Set(
      this.packageSources
        .filter(({ source }) => source === "builtin")
        .map(({ manifest }) => manifest.id),
    );
    const targetCandidates = this.packageSources
      .filter(({ manifest }) => manifest.id === targetCharacterId)
      .map((source) => evaluatePackage(source, reservedCharacterIds, this.appVersion));
    const target = targetCandidates.find(({ source }) => source.source === "builtin") ?? targetCandidates[0];
    if (!target || target.health.status !== "healthy") {
      return deepFreeze({
        ok: false,
        status: "failed",
        diagnostics: target
          ? [{
              code: "character.switch.target_unhealthy",
              message: `目标角色不可用：${targetCharacterId}`,
              characterId: targetCharacterId,
            }, ...target.health.diagnostics]
          : [{
              code: "character.switch.target_missing",
              message: `找不到目标角色：${targetCharacterId}`,
              characterId: targetCharacterId,
            }],
      });
    }

    const targetSnapshot = toPackageSnapshot(target);
    const unavailableCapabilities = (Object.entries(targetSnapshot.capabilities) as Array<[
      CharacterCapabilityName,
      "available" | "unavailable",
    ]>)
      .filter(([, availability]) => availability === "unavailable")
      .map(([capability]) => capability);

    if (targetCharacterId === currentCharacterId) {
      return deepFreeze({
        ok: true,
        status: "already-active",
        characterId: currentCharacterId,
        unavailableCapabilities,
      });
    }

    const blockingActivities = [...this.switchAdapters.getBlockingActivities()];
    if (blockingActivities.length > 0) {
      return deepFreeze({
        ok: false,
        status: "blocked",
        blockingActivities,
        diagnostics: [{
          code: "character.switch.busy",
          message: `角色切换暂不可用：${blockingActivities.map(({ reason }) => reason).join("；")}`,
          characterId: currentCharacterId,
        }],
      });
    }

    this.switchTransactionRunning = true;

    try {
      await this.switchAdapters.persistActiveState();
    } catch (error) {
      this.switchTransactionRunning = false;
      return deepFreeze({
        ok: false,
        status: "failed",
        diagnostics: [{
          code: "character.switch.persist_failed",
          message: `当前角色状态持久化失败：${error instanceof Error ? error.message : String(error)}`,
          characterId: currentCharacterId,
        }],
      });
    }

    try {
      writeRuntimeState(this.runtimeStatePath, {
        schemaVersion: 1,
        activeCharacterId: currentCharacterId,
        pendingCharacterId: targetCharacterId,
        previousCharacterId: currentCharacterId,
      });
    } catch (error) {
      this.switchTransactionRunning = false;
      return deepFreeze({
        ok: false,
        status: "failed",
        diagnostics: [{
          code: "character.switch.pending_persist_failed",
          message: `角色切换状态写入失败：${error instanceof Error ? error.message : String(error)}`,
          characterId: targetCharacterId,
          resourcePath: this.runtimeStatePath,
        }],
      });
    }

    const rollbackPendingState = (diagnostic: CharacterRuntimeDiagnostic): CharacterSwitchResult => {
      this.switchTransactionRunning = false;
      const diagnostics = [diagnostic];
      try {
        writeRuntimeState(this.runtimeStatePath, {
          schemaVersion: 1,
          activeCharacterId: currentCharacterId,
        });
      } catch (error) {
        diagnostics.push({
          code: "character.switch.rollback_persist_failed",
          message: `角色切换回滚状态写入失败：${error instanceof Error ? error.message : String(error)}`,
          characterId: currentCharacterId,
          resourcePath: this.runtimeStatePath,
        });
      }
      return deepFreeze({ ok: false, status: "failed", diagnostics });
    };

    try {
      await this.switchAdapters.shutdownActiveResources();
    } catch (error) {
      return rollbackPendingState({
        code: "character.switch.shutdown_failed",
        message: `当前角色资源关闭失败：${error instanceof Error ? error.message : String(error)}`,
        characterId: currentCharacterId,
      });
    }

    try {
      await this.switchAdapters.requestRelaunch();
    } catch (error) {
      return rollbackPendingState({
        code: "character.switch.relaunch_failed",
        message: `受控重启请求失败：${error instanceof Error ? error.message : String(error)}`,
        characterId: targetCharacterId,
      });
    }

    return deepFreeze({
      ok: true,
      status: "relaunch-requested",
      previousCharacterId: currentCharacterId,
      targetCharacterId,
      unavailableCapabilities,
    });
  }

  async uninstallPackage(characterId: string): Promise<CharacterUninstallResult> {
    if (!isValidCharacterId(characterId)) {
      return deepFreeze({
        ok: false,
        diagnostics: [invalidCharacterIdDiagnostic(characterId)],
      });
    }
    const snapshot = await this.initialize();
    const characterPackage = snapshot.packages.find(({ id }) => id === characterId);
    if (!characterPackage) {
      return deepFreeze({
        ok: false,
        diagnostics: [{
          code: "character.uninstall.not_found",
          message: `找不到要卸载的角色包：${characterId}`,
          characterId,
        }],
      });
    }
    if (characterPackage.source === "builtin") {
      return deepFreeze({
        ok: false,
        diagnostics: [{
          code: "character.uninstall.builtin_forbidden",
          message: `内置角色不能卸载：${characterPackage.displayName}`,
          characterId,
        }],
      });
    }
    if (snapshot.activeCharacter?.id === characterId) {
      return deepFreeze({
        ok: false,
        diagnostics: [{
          code: "character.uninstall.active_forbidden",
          message: `当前活动角色不能卸载：${characterPackage.displayName}`,
          characterId,
        }],
      });
    }

    const source = this.packageSources.find(({ source: packageSource, manifest }) => (
      packageSource === "local" && manifest.id === characterId
    ));
    if (!source) {
      return deepFreeze({
        ok: false,
        diagnostics: [{
          code: "character.uninstall.source_missing",
          message: `角色包注册信息不完整：${characterId}`,
          characterId,
        }],
      });
    }

    const stateRoot = resolveCharacterStateLayout(this.options.userDataRoot, characterId).root;
    const archiveRoot = path.join(this.archivedStateRoot, characterId);
    const archivedStatePath = path.join(archiveRoot, "state");
    const removalRoot = path.join(this.packageStorageRoot, `.removing-${characterId}-${randomUUID()}`);
    const originalRegistry = readCharacterRegistry(this.registryPath);
    const originalPackageSources = [...this.packageSources];
    let packageMoved = false;
    let stateArchived = false;
    let registryUpdated = false;
    try {
      if (fs.existsSync(archiveRoot)) {
        throw new Error(`归档状态已存在：${archiveRoot}`);
      }
      await fs.promises.rename(source.rootPath, removalRoot);
      packageMoved = true;
      if (fs.existsSync(stateRoot)) {
        await fs.promises.mkdir(archiveRoot, { recursive: true });
        await fs.promises.rename(stateRoot, archivedStatePath);
        stateArchived = true;
        await fs.promises.writeFile(path.join(archiveRoot, "archive.json"), `${JSON.stringify({
          schemaVersion: 1,
          characterId,
          displayName: characterPackage.displayName,
          packageVersion: characterPackage.version,
          archivedAt: new Date().toISOString(),
        }, null, 2)}\n`, { flag: "wx" });
      }

      await writeCharacterRegistryAtomic(this.packageStorageRoot, this.registryPath, {
        schemaVersion: 1,
        packages: originalRegistry.packages.filter(({ id }) => id !== characterId),
      });
      registryUpdated = true;
      this.packageSources = this.packageSources.filter(({ source: packageSource, manifest }) => (
        packageSource === "builtin" || manifest.id !== characterId
      ));
      this.snapshot = null;
      const nextSnapshot = await this.initialize();
      await fs.promises.rm(removalRoot, { recursive: true, force: true });
      return deepFreeze({
        ok: true,
        characterId,
        state: stateArchived ? "archived" : "none",
        snapshot: nextSnapshot,
      });
    } catch (error) {
      const rollbackDiagnostics: CharacterRuntimeDiagnostic[] = [];
      if (stateArchived && fs.existsSync(archivedStatePath) && !fs.existsSync(stateRoot)) {
        await fs.promises.mkdir(path.dirname(stateRoot), { recursive: true });
        await fs.promises.rename(archivedStatePath, stateRoot).catch((rollbackError) => {
          rollbackDiagnostics.push({
            code: "character.uninstall.rollback_state_failed",
            message: `角色状态回滚失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
            characterId,
            resourcePath: stateRoot,
          });
        });
        await fs.promises.rm(archiveRoot, { recursive: true, force: true }).catch((rollbackError) => {
          rollbackDiagnostics.push({
            code: "character.uninstall.rollback_archive_failed",
            message: `角色状态归档清理失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
            characterId,
            resourcePath: archiveRoot,
          });
        });
      }
      if (packageMoved && fs.existsSync(removalRoot) && !fs.existsSync(source.rootPath)) {
        await fs.promises.rename(removalRoot, source.rootPath).catch((rollbackError) => {
          rollbackDiagnostics.push({
            code: "character.uninstall.rollback_package_failed",
            message: `角色包资源回滚失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
            characterId,
            resourcePath: source.rootPath,
          });
        });
      }
      if (registryUpdated) {
        await writeCharacterRegistryAtomic(
          this.packageStorageRoot,
          this.registryPath,
          originalRegistry,
        ).catch((rollbackError) => {
          rollbackDiagnostics.push({
            code: "character.uninstall.rollback_registry_failed",
            message: `角色注册表回滚失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
            characterId,
            resourcePath: this.registryPath,
          });
        });
      }
      this.packageSources = originalPackageSources;
      this.snapshot = null;
      await this.initialize().catch((rollbackError) => {
        rollbackDiagnostics.push({
          code: "character.uninstall.rollback_runtime_failed",
          message: `角色运行时回滚失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
          characterId,
        });
      });
      return deepFreeze({
        ok: false,
        diagnostics: [{
          code: "character.uninstall.failed",
          message: `角色包卸载失败：${error instanceof Error ? error.message : String(error)}`,
          characterId,
        }, ...rollbackDiagnostics],
      });
    }
  }

  async listArchivedCharacterStates(): Promise<readonly ArchivedCharacterStateSnapshot[]> {
    if (!fs.existsSync(this.archivedStateRoot)) return [];
    const entries = await fs.promises.readdir(this.archivedStateRoot, { withFileTypes: true });
    const snapshots: ArchivedCharacterStateSnapshot[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const archiveRoot = path.join(this.archivedStateRoot, entry.name);
      try {
        const metadata = JSON.parse(
          await fs.promises.readFile(path.join(archiveRoot, "archive.json"), "utf8"),
        ) as Record<string, unknown>;
        if (
          metadata.schemaVersion !== 1
          || metadata.characterId !== entry.name
          || typeof metadata.displayName !== "string"
          || typeof metadata.packageVersion !== "string"
          || typeof metadata.archivedAt !== "string"
        ) {
          continue;
        }
        const measurement = await measureDirectory(path.join(archiveRoot, "state"));
        snapshots.push({
          characterId: entry.name,
          displayName: metadata.displayName,
          packageVersion: metadata.packageVersion,
          archivedAt: metadata.archivedAt,
          ...measurement,
        });
      } catch {
        continue;
      }
    }
    return deepFreeze(snapshots.sort((left, right) => left.characterId.localeCompare(right.characterId)));
  }

  async permanentlyDeleteArchivedState(
    characterId: string,
    confirmationCharacterId: string,
  ): Promise<CharacterArchiveDeleteResult> {
    if (!isValidCharacterId(characterId)) {
      return deepFreeze({
        ok: false,
        diagnostics: [invalidCharacterIdDiagnostic(characterId)],
      });
    }
    if (confirmationCharacterId !== characterId) {
      return deepFreeze({
        ok: false,
        diagnostics: [{
          code: "character.archive.confirmation_mismatch",
          message: `永久删除需要准确输入角色 ID：${characterId}`,
          characterId,
        }],
      });
    }
    const archiveRoot = path.join(this.archivedStateRoot, characterId);
    const statePath = path.join(archiveRoot, "state");
    if (!fs.existsSync(archiveRoot)) {
      return deepFreeze({
        ok: false,
        diagnostics: [{
          code: "character.archive.not_found",
          message: `找不到归档角色状态：${characterId}`,
          characterId,
        }],
      });
    }
    try {
      const measurement = await measureDirectory(statePath);
      await fs.promises.rm(archiveRoot, { recursive: true, force: false });
      return deepFreeze({
        ok: true,
        characterId,
        deletedFiles: measurement.fileCount,
        deletedBytes: measurement.totalBytes,
      });
    } catch (error) {
      return deepFreeze({
        ok: false,
        diagnostics: [{
          code: "character.archive.delete_failed",
          message: `归档角色状态删除失败：${error instanceof Error ? error.message : String(error)}`,
          characterId,
          resourcePath: archiveRoot,
        }],
      });
    }
  }

  async importPackage(
    sourceRoot: string,
    options: CharacterImportOptions = {},
  ): Promise<CharacterImportResult> {
    await this.initialize();
    let stagingPath: string | null = null;
    let installedPath: string | null = null;
    let restoredStatePath: string | null = null;
    let importedCharacterId: string | null = null;
    let rollbackPackagePath: string | null = null;
    let originalRegistry: CharacterRegistryFile | null = null;
    let originalPackageSources: CharacterPackageSource[] | null = null;
    let registryUpdated = false;
    try {
      const manifestPath = path.join(sourceRoot, "character.json");
      const manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8")) as CharacterPackageManifest;
      importedCharacterId = manifest.id;
      const reservedCharacterIds = new Set(
        this.packageSources
          .filter(({ source }) => source === "builtin")
          .map(({ manifest: installedManifest }) => installedManifest.id),
      );
      const source: CharacterPackageSource = { source: "local", rootPath: sourceRoot, manifest };
      const evaluatedSource = evaluatePackage(source, reservedCharacterIds, this.appVersion);
      if (evaluatedSource.health.status === "unhealthy") {
        return { ok: false, diagnostics: deepFreeze([...evaluatedSource.health.diagnostics]) };
      }
      const existingSource = this.packageSources.find(({ manifest: installedManifest }) => (
        installedManifest.id === manifest.id
      ));
      if (existingSource?.source === "builtin") {
        return {
          ok: false,
          diagnostics: deepFreeze([{
            code: "character.import.reserved_id",
            message: `角色 ID 已由内置角色保留：${manifest.id}`,
            characterId: manifest.id,
            field: "id",
          }]),
        };
      }
      if (existingSource && this.getSnapshot().activeCharacter?.id === manifest.id) {
        return {
          ok: false,
          diagnostics: deepFreeze([{
            code: "character.import.active_replacement_forbidden",
            message: `请先切换到其他角色，再升级或替换当前活动角色：${manifest.displayName}`,
            characterId: manifest.id,
          }]),
        };
      }
      if (existingSource && compareSemver(manifest.version, existingSource.manifest.version) < 0) {
        return {
          ok: false,
          diagnostics: deepFreeze([{
            code: "character.import.downgrade_forbidden",
            message: `默认拒绝角色包降级：${existingSource.manifest.version} → ${manifest.version}`,
            characterId: manifest.id,
            field: "version",
          }]),
        };
      }

      await fs.promises.mkdir(this.stagingRoot, { recursive: true });
      await fs.promises.mkdir(this.installedRoot, { recursive: true });
      stagingPath = path.join(this.stagingRoot, `${manifest.id}-${randomUUID()}`);
      installedPath = path.join(this.installedRoot, manifest.id);
      if (!existingSource && fs.existsSync(installedPath)) {
        throw new Error(`角色包安装目录已存在：${installedPath}`);
      }
      await copyPackageDirectory(sourceRoot, stagingPath, sourceRoot, {
        limits: this.importLimits,
        fileCount: 0,
        totalBytes: 0,
      });

      const stagedManifest = JSON.parse(
        await fs.promises.readFile(path.join(stagingPath, "character.json"), "utf8"),
      ) as CharacterPackageManifest;
      const stagedSource: CharacterPackageSource = {
        source: "local",
        rootPath: stagingPath,
        manifest: stagedManifest,
      };
      const stagedEvaluation = evaluatePackage(stagedSource, reservedCharacterIds, this.appVersion);
      if (stagedEvaluation.health.status === "unhealthy" || stagedManifest.id !== manifest.id) {
        return { ok: false, diagnostics: deepFreeze([...stagedEvaluation.health.diagnostics]) };
      }

      const digest = await calculatePackageDigest(stagingPath);
      let operation: "installed" | "upgraded" | "modified" | "repaired" = "installed";
      if (existingSource) {
        const repairingUnavailablePackage = Boolean(existingSource.loadDiagnostics?.length);
        const currentDigest = existingSource.digest ?? await calculatePackageDigest(existingSource.rootPath);
        if (manifest.version === existingSource.manifest.version && digest === currentDigest) {
          return {
            ok: false,
            diagnostics: deepFreeze([{
              code: "character.import.already_installed",
              message: `角色包已经安装且内容相同：${manifest.id}`,
              characterId: manifest.id,
            }]),
          };
        }
        operation = repairingUnavailablePackage
          ? "repaired"
          : compareSemver(manifest.version, existingSource.manifest.version) > 0
            ? "upgraded"
            : "modified";
        const currentSnapshot = toPackageSnapshot(evaluatePackage(
          existingSource,
          reservedCharacterIds,
          this.appVersion,
        ));
        const targetSnapshot = toPackageSnapshot(stagedEvaluation);
        const changedCapabilities = (Object.keys(targetSnapshot.capabilities) as CharacterCapabilityName[])
          .filter((capability) => (
            currentSnapshot.capabilities[capability] !== targetSnapshot.capabilities[capability]
          ));
        const replacement: CharacterReplacementPlan = {
          kind: operation === "modified" ? "modified" : "upgrade",
          characterId: manifest.id,
          displayName: manifest.displayName,
          currentVersion: existingSource.manifest.version,
          targetVersion: manifest.version,
          currentDigest,
          targetDigest: digest,
          changedCapabilities,
        };
        if (!options.confirmReplacement) {
          return {
            ok: false,
            status: "confirmation-required",
            replacement: deepFreeze(replacement),
            diagnostics: [],
          };
        }

        const backupRoot = path.join(
          this.packageStorageRoot,
          "backups",
          manifest.id,
          `${Date.now()}-${existingSource.manifest.version}-${currentDigest.slice(0, 12)}`,
        );
        if (fs.existsSync(existingSource.rootPath)) {
          await fs.promises.mkdir(path.dirname(backupRoot), { recursive: true });
          await fs.promises.cp(existingSource.rootPath, backupRoot, {
            recursive: true,
            errorOnExist: true,
            force: false,
            preserveTimestamps: true,
          });
          rollbackPackagePath = path.join(
            this.packageStorageRoot,
            `.rollback-${manifest.id}-${randomUUID()}`,
          );
          await fs.promises.rename(existingSource.rootPath, rollbackPackagePath);
        }
      }

      await fs.promises.rename(stagingPath, installedPath);
      stagingPath = null;

      const archiveRoot = path.join(this.archivedStateRoot, manifest.id);
      const archivedStatePath = path.join(archiveRoot, "state");
      const stateRoot = resolveCharacterStateLayout(this.options.userDataRoot, manifest.id).root;
      if (fs.existsSync(archiveRoot)) {
        if (fs.existsSync(stateRoot)) throw new Error(`角色状态与归档状态同时存在：${manifest.id}`);
        if (!fs.existsSync(archivedStatePath)) throw new Error(`归档角色状态不完整：${manifest.id}`);
        await fs.promises.mkdir(path.dirname(stateRoot), { recursive: true });
        await fs.promises.rename(archivedStatePath, stateRoot);
        restoredStatePath = stateRoot;
      }

      const registry = readCharacterRegistry(this.registryPath);
      originalRegistry = registry;
      originalPackageSources = [...this.packageSources];
      const nextRecord = {
        id: manifest.id,
        digest,
        installedDirectory: manifest.id,
        importedAt: new Date().toISOString(),
      };
      const nextRegistry: CharacterRegistryFile = {
        schemaVersion: 1,
        packages: existingSource
          ? registry.packages.map((record) => record.id === manifest.id ? nextRecord : record)
          : [...registry.packages, nextRecord],
      };
      await writeCharacterRegistryAtomic(this.packageStorageRoot, this.registryPath, nextRegistry);
      registryUpdated = true;

      const installedSource: CharacterPackageSource = {
        source: "local",
        rootPath: installedPath,
        manifest: stagedManifest,
        digest,
      };
      this.packageSources = existingSource
        ? this.packageSources.map((source) => source === existingSource ? installedSource : source)
        : [...this.packageSources, installedSource];
      this.snapshot = null;
      const snapshot = await this.initialize();
      const installedPackage = snapshot.packages.find(({ id, source: packageSource }) => (
        id === manifest.id && packageSource === "local"
      ));
      if (!installedPackage) throw new Error(`安装后找不到角色包：${manifest.id}`);
      if (rollbackPackagePath) {
        await fs.promises.rm(rollbackPackagePath, { recursive: true, force: true });
        rollbackPackagePath = null;
      }
      if (restoredStatePath) {
        await fs.promises.rm(archiveRoot, { recursive: true, force: true });
      }
      return { ok: true, operation, package: installedPackage, snapshot };
    } catch (error) {
      const rollbackDiagnostics: CharacterRuntimeDiagnostic[] = [];
      if (installedPath && fs.existsSync(installedPath)) {
        await fs.promises.rm(installedPath, { recursive: true, force: true }).catch((rollbackError) => {
          rollbackDiagnostics.push({
            code: "character.import.rollback_new_package_failed",
            message: `新角色包清理失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
            characterId: importedCharacterId ?? undefined,
            resourcePath: installedPath ?? undefined,
          });
        });
      }
      if (rollbackPackagePath && installedPath && fs.existsSync(rollbackPackagePath)) {
        await fs.promises.rename(rollbackPackagePath, installedPath).catch((rollbackError) => {
          rollbackDiagnostics.push({
            code: "character.import.rollback_old_package_failed",
            message: `原角色包回滚失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
            characterId: importedCharacterId ?? undefined,
            resourcePath: installedPath ?? undefined,
          });
        });
        rollbackPackagePath = null;
      }
      if (restoredStatePath && fs.existsSync(restoredStatePath)) {
        const archiveRoot = path.join(
          this.archivedStateRoot,
          importedCharacterId ?? path.basename(restoredStatePath),
        );
        await fs.promises.mkdir(archiveRoot, { recursive: true });
        await fs.promises.rename(restoredStatePath, path.join(archiveRoot, "state")).catch((rollbackError) => {
          rollbackDiagnostics.push({
            code: "character.import.rollback_state_failed",
            message: `归档角色状态回滚失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
            characterId: importedCharacterId ?? undefined,
            resourcePath: archiveRoot,
          });
        });
      }
      if (registryUpdated && originalRegistry) {
        await writeCharacterRegistryAtomic(
          this.packageStorageRoot,
          this.registryPath,
          originalRegistry,
        ).catch((rollbackError) => {
          rollbackDiagnostics.push({
            code: "character.import.rollback_registry_failed",
            message: `角色注册表回滚失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
            characterId: importedCharacterId ?? undefined,
            resourcePath: this.registryPath,
          });
        });
      }
      if (originalPackageSources) {
        this.packageSources = originalPackageSources;
        this.snapshot = null;
        await this.initialize().catch((rollbackError) => {
          rollbackDiagnostics.push({
            code: "character.import.rollback_runtime_failed",
            message: `角色运行时回滚失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
            characterId: importedCharacterId ?? undefined,
          });
        });
      }
      return {
        ok: false,
        diagnostics: deepFreeze([
          error instanceof CharacterImportValidationError
            ? error.diagnostic
            : {
              code: "character.import.failed",
              message: error instanceof Error ? error.message : String(error),
              resourcePath: sourceRoot,
            },
          ...rollbackDiagnostics,
        ]),
      };
    } finally {
      if (stagingPath && fs.existsSync(stagingPath)) {
        await fs.promises.rm(stagingPath, { recursive: true, force: true });
      }
    }
  }
}

export function createCharacterRuntime(options: CreateCharacterRuntimeOptions): CharacterRuntime {
  return new CharacterRuntime(options);
}

export function createDefaultCharacterRuntime(
  options: CreateDefaultCharacterRuntimeOptions,
): CharacterRuntime {
  const { appRoot, userDataRoot } = options;
  const manifest: CharacterPackageManifest = {
    schemaVersion: CHARACTER_PACKAGE_SCHEMA_VERSION,
    id: BUILT_IN_CYRENE_ID,
    version: "1.0.0",
    displayName: "昔涟",
    distributionStatus: "redistributable",
    compatibility: { minimumAppVersion: "0.1.0" },
    assetProvenance: [
      {
        assetClass: "character-content",
        source: "Cyrene Agent 内置角色内容",
        license: "仓库授权与非商业同人使用边界",
        distributionStatus: "redistributable",
      },
      {
        assetClass: "avatar",
        source: "Cyrene Agent 内置图标资源",
        license: "仓库授权与非商业同人使用边界",
        distributionStatus: "redistributable",
      },
      {
        assetClass: "live2d",
        source: "Bilibili 创作者 是依七哒",
        license: "MODEL_LICENSE.md 中记录的再分发授权与非商业同人使用边界",
        distributionStatus: "redistributable",
      },
      {
        assetClass: "voice",
        source: "Cyrene Agent 内置兼容 Voice Profile（不含音频或凭据）",
        license: "MIT",
        distributionStatus: "redistributable",
      },
    ],
    content: {
      identity: "prompts/identity.md",
      soul: "prompts/soul.md",
      avatar: "assets/icon-presets/cyrene-sun.png",
      canonQuotes: "prompts/canon_quotes.md",
      toneRules: "prompts/tone-rules.md",
      stylesDirectory: "prompts/styles",
      scenesDirectory: "skills/cyrene-original-voice/references",
      phoneIdentity: "prompts/phone_identity.md",
      phoneStyle: "prompts/phone_style.md",
    },
    speechRecognitionHints: {
      aliases: ["Cyrene"],
      terms: ["Qwen3.5"],
    },
    capabilities: {
      worldbook: { directory: "prompts/worldbook" },
      live2d: { model: "assets/models/cyrene/Cyrene.model3.json" },
      semanticActions: { mapping: "assets/models/cyrene/semantic-actions.json" },
      voice: { profile: "assets/voices/cyrene/profile.json" },
    },
  };
  return createCharacterRuntime({
    userDataRoot,
    activeCharacterId: BUILT_IN_CYRENE_ID,
    packages: [{ source: "builtin", rootPath: appRoot, manifest }],
    importLimits: options.importLimits,
    appVersion: options.appVersion,
    switchAdapters: options.switchAdapters,
  });
}
