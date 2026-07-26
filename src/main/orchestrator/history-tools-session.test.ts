import { describe, expect, it } from "vitest";
import { filterHistoryEntriesForSession } from "./history-tools";

describe("recall_history session isolation", () => {
  const entries = [
    { text: "账号甲历史", createdAt: 1, score: 0.9, metadata: { sessionId: "session-a" } },
    { text: "账号乙历史", createdAt: 2, score: 0.8, metadata: { sessionId: "session-b" } },
    { text: "旧版无归属历史", createdAt: 3, score: 0.7 },
  ];

  it("提供微信 sessionId 时只返回当前对话条目", () => {
    expect(filterHistoryEntriesForSession(entries, "session-a").map((entry) => entry.text)).toEqual([
      "账号甲历史",
    ]);
  });

  it("桌面端未提供 sessionId 时保持现有全局召回行为", () => {
    expect(filterHistoryEntriesForSession(entries, undefined)).toEqual(entries);
  });
});
