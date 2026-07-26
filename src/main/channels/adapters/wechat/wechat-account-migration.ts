import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Credentials } from "./ilink-protocol-client";
import type { WechatAccountStore } from "./wechat-account-store";

export type LegacyHistoryOwnership = "proven" | "unknown";
export type LegacyHistoryDisposition = "assign-to-migrated-account" | "archive-as-legacy";

export type LegacyWechatMigrationResult =
  | { status: "no-legacy" }
  | { status: "invalid-legacy" }
  | {
      status: "migrated";
      ilinkBotId: string;
      archivePath: string;
      historyDisposition: LegacyHistoryDisposition;
    }
  | {
      status: "legacy-compatibility";
      credentials: Credentials;
      reason: "write-or-validation-failed";
    };

export interface MigrateLegacyWechatAccountOptions {
  legacyPath: string;
  archiveDir: string;
  store: WechatAccountStore;
  legacyHistoryOwnership?: LegacyHistoryOwnership;
  now?: () => number;
}

export async function migrateLegacyWechatAccount(
  options: MigrateLegacyWechatAccountOptions,
): Promise<LegacyWechatMigrationResult> {
  let credentials: Credentials;
  try {
    const parsed = JSON.parse(await readFile(options.legacyPath, "utf8")) as unknown;
    if (!isCredentials(parsed)) return { status: "invalid-legacy" };
    credentials = parsed;
  } catch (error) {
    return isMissingFile(error) ? { status: "no-legacy" } : { status: "invalid-legacy" };
  }

  try {
    await options.store.upsertAccount({
      label: credentials.accountId,
      enabled: true,
      credentials,
    });
    const verified = await options.store.loadCredentials(credentials.ilinkBotId);
    if (!verified || !sameCredentials(credentials, verified)) {
      throw new Error("微信迁移后的凭据回读校验失败");
    }

    const historyDisposition: LegacyHistoryDisposition =
      options.legacyHistoryOwnership === "proven"
        ? "assign-to-migrated-account"
        : "archive-as-legacy";
    const archivePath = await writeMigrationReceipt({
      archiveDir: options.archiveDir,
      ilinkBotId: credentials.ilinkBotId,
      migratedAt: (options.now ?? Date.now)(),
      historyDisposition,
    });
    await unlink(options.legacyPath);
    return {
      status: "migrated",
      ilinkBotId: credentials.ilinkBotId,
      archivePath,
      historyDisposition,
    };
  } catch {
    return {
      status: "legacy-compatibility",
      credentials,
      reason: "write-or-validation-failed",
    };
  }
}

async function writeMigrationReceipt(input: {
  archiveDir: string;
  ilinkBotId: string;
  migratedAt: number;
  historyDisposition: LegacyHistoryDisposition;
}): Promise<string> {
  await mkdir(input.archiveDir, { recursive: true, mode: 0o700 });
  const accountKey = createHash("sha256").update(input.ilinkBotId).digest("hex").slice(0, 16);
  const archivePath = path.join(
    input.archiveDir,
    `credentials-migrated-${input.migratedAt}-${accountKey}.json`,
  );
  const temporaryPath = `${archivePath}.${randomUUID()}.tmp`;
  await writeFile(
    temporaryPath,
    JSON.stringify(
      {
        version: 1,
        migratedAt: input.migratedAt,
        accountKey,
        historyDisposition: input.historyDisposition,
      },
      null,
      2,
    ),
    { encoding: "utf8", mode: 0o600 },
  );
  await rename(temporaryPath, archivePath);
  return archivePath;
}

function isCredentials(value: unknown): value is Credentials {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Credentials>;
  return (
    typeof candidate.ilinkBotId === "string" && candidate.ilinkBotId.length > 0 &&
    typeof candidate.botToken === "string" && candidate.botToken.length > 0 &&
    typeof candidate.baseUrl === "string" && candidate.baseUrl.length > 0 &&
    typeof candidate.ilinkUserId === "string" && candidate.ilinkUserId.length > 0
  );
}

function sameCredentials(expected: Credentials, actual: Credentials): boolean {
  return (
    expected.ilinkBotId === actual.ilinkBotId &&
    expected.botToken === actual.botToken &&
    expected.baseUrl === actual.baseUrl &&
    expected.ilinkUserId === actual.ilinkUserId
  );
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}
