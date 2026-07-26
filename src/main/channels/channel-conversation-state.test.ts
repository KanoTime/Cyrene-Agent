import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChannelConversationRelationshipStore } from "./channel-conversation-state";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("ChannelConversationRelationshipStore", () => {
  it("不同微信 session 的关系线索存储和读取互不共享", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "cyrene-channel-state-"));
    tempDirs.push(rootDir);
    const store = new ChannelConversationRelationshipStore(rootDir);

    await store.recordTurn("session-account-a", {
      userText: "今天真的好累",
      assistantText: "先休息一下吧",
      cyreneFeeling: "温柔",
      channel: "wechat",
    });
    await store.recordTurn("session-account-b", {
      userText: "今天非常开心",
      assistantText: "那太好啦",
      cyreneFeeling: "开心",
      channel: "wechat",
    });

    const first = await store.buildContext("session-account-a");
    const second = await store.buildContext("session-account-b");
    expect(first).toContain("疲惫");
    expect(first).not.toContain("开心");
    expect(second).toContain("开心");
    expect(second).not.toContain("疲惫");
  });
});
