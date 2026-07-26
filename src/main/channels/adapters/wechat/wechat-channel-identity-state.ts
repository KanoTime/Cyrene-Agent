import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ToolRiskLevel } from "../../../permission";
import type { ChannelConversationIdentity } from "../../types";

export interface WechatChannelProfile {
  nickname?: string;
  callPreference?: string;
  birthday?: string;
  defaultCity?: string;
  timezone?: string;
}

export interface WechatChannelPermissionPolicy {
  allowedRisks: ToolRiskLevel[];
}

const VALID_RISKS = new Set<ToolRiskLevel>([
  "safe", "fs-read", "fs-write", "shell", "network", "input-control",
]);

function identityKey(identity: ChannelConversationIdentity): string {
  if (identity.channel !== "wechat" || !identity.connectionAccountId || !identity.participantId) {
    throw new Error("微信渠道身份不完整");
  }
  return `${identity.connectionAccountId}\0${identity.participantId}`;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, filePath);
}

export class WechatChannelIdentityStateStore {
  constructor(private readonly options: { rootDir: string }) {}

  async loadProfile(identity: ChannelConversationIdentity): Promise<WechatChannelProfile> {
    return readJson(this.profilePath(identity), {});
  }

  async updateProfile(
    identity: ChannelConversationIdentity,
    patch: Partial<WechatChannelProfile>,
  ): Promise<WechatChannelProfile> {
    const profile = { ...(await this.loadProfile(identity)), ...patch };
    await writeJson(this.profilePath(identity), profile);
    return profile;
  }

  async loadPermissionPolicy(accountId: string): Promise<WechatChannelPermissionPolicy> {
    const value = await readJson<Partial<WechatChannelPermissionPolicy>>(this.policyPath(accountId), {});
    const allowedRisks = Array.isArray(value.allowedRisks)
      ? [...new Set(value.allowedRisks.filter((risk): risk is ToolRiskLevel => VALID_RISKS.has(risk as ToolRiskLevel)))]
      : ["safe" as const];
    return { allowedRisks };
  }

  async savePermissionPolicy(
    accountId: string,
    policy: WechatChannelPermissionPolicy,
  ): Promise<WechatChannelPermissionPolicy> {
    const allowedRisks = [...new Set(policy.allowedRisks.filter((risk) => VALID_RISKS.has(risk)))];
    const normalized = { allowedRisks };
    await writeJson(this.policyPath(accountId), normalized);
    return normalized;
  }

  async isToolRiskAllowed(accountId: string, risk: ToolRiskLevel): Promise<boolean> {
    return (await this.loadPermissionPolicy(accountId)).allowedRisks.includes(risk);
  }

  private profilePath(identity: ChannelConversationIdentity): string {
    return path.join(this.options.rootDir, "profiles", `${hash(identityKey(identity))}.json`);
  }

  private policyPath(accountId: string): string {
    if (!accountId) throw new Error("微信连接账号不能为空");
    return path.join(this.options.rootDir, "permissions", `${hash(accountId)}.json`);
  }
}
