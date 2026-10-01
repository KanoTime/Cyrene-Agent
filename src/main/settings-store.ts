import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import { resolveGlobalUserDataLayout } from "./character/global-user-data";

export interface UserProfile {
  nickname: string;
  callPreference: string;
  birthday: string;
  timezone: string;
  avatarPath: string;
  /** 默认城市（用于天气等需要地理定位的工具，没填则模型会问用户） */
  defaultCity: string;
  /** 性别：secret(保密) | male(男) | female(女) */
  gender: string;
}

export const DEFAULT_USER_PROFILE: UserProfile = {
  nickname: "",
  callPreference: "",
  birthday: "",
  timezone: "Asia/Shanghai",
  avatarPath: "",
  defaultCity: "",
  gender: "secret",
};

export function getSettingsPath(): string {
  return path.join(app.getPath("userData"), "model-settings.json");
}

export function getGeneralSettingsPath(): string {
  return resolveGlobalUserDataLayout(app.getPath("userData")).appSettingsFile;
}

export function getUserProfilePath(): string {
  return resolveGlobalUserDataLayout(app.getPath("userData")).profileFile;
}

export function getAvatarPath(): string {
  return resolveGlobalUserDataLayout(app.getPath("userData")).avatarFile;
}

export const CYRENE_AVATAR_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".bmp"] as const;

export function getCyreneAvatarPath(extension: typeof CYRENE_AVATAR_EXTENSIONS[number]): string {
  return path.join(app.getPath("userData"), `cyrene-avatar${extension}`);
}

export function findCyreneAvatarPath(): string | null {
  const candidates = CYRENE_AVATAR_EXTENSIONS
    .map((extension) => getCyreneAvatarPath(extension))
    .filter((filePath) => fs.existsSync(filePath));
  if (candidates.length === 0) return null;
  return candidates.sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0] ?? null;
}

export function getRagStorePath(): string {
  return path.join(resolveGlobalUserDataLayout(app.getPath("userData")).documentRagRoot, "memory-store.json");
}

export function getStickerSettingsPath(): string {
  return path.join(app.getPath("userData"), "sticker-settings.json");
}

export function loadUserProfile(): UserProfile {
  try {
    const filePath = getUserProfilePath();
    if (!fs.existsSync(filePath)) return DEFAULT_USER_PROFILE;
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
    return {
      nickname: typeof raw.nickname === "string" ? raw.nickname : DEFAULT_USER_PROFILE.nickname,
      callPreference: typeof raw.callPreference === "string" ? raw.callPreference : DEFAULT_USER_PROFILE.callPreference,
      birthday: typeof raw.birthday === "string" ? raw.birthday : DEFAULT_USER_PROFILE.birthday,
      timezone: typeof raw.timezone === "string" ? raw.timezone : DEFAULT_USER_PROFILE.timezone,
      avatarPath: typeof raw.avatarPath === "string" ? raw.avatarPath : DEFAULT_USER_PROFILE.avatarPath,
      defaultCity: typeof raw.defaultCity === "string" ? raw.defaultCity : DEFAULT_USER_PROFILE.defaultCity,
      gender: typeof raw.gender === "string" ? raw.gender : DEFAULT_USER_PROFILE.gender,
    };
  } catch {
    return DEFAULT_USER_PROFILE;
  }
}

export function saveUserProfile(profile: Partial<UserProfile>): UserProfile {
  const existing = loadUserProfile();
  const merged = { ...existing };
  const explicitKeys: Array<keyof UserProfile> = [
    "nickname",
    "callPreference",
    "birthday",
    "timezone",
    "avatarPath",
    "defaultCity",
    "gender",
  ];
  for (const key of explicitKeys) {
    if (typeof profile[key] === "string") merged[key] = profile[key].trim();
  }
  const filePath = getUserProfilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), "utf8");
  return merged;
}
