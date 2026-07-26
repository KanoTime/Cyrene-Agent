import fs from "fs";
import os from "os";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("Character State Root store integration", () => {
  let userDataRoot: string;

  beforeEach(() => {
    vi.resetModules();
    userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "character-state-stores-"));
    vi.doMock("electron", () => ({
      app: {
        getPath: () => userDataRoot,
        getAppPath: () => process.cwd(),
      },
      shell: { openPath: vi.fn() },
    }));
  });

  it("routes chat, memory, relationship, entity and proactive stores into the active layout", async () => {
    const stateModule = await import("./character-state");
    const migration = await stateModule.migrateLegacyCyreneState({ userDataRoot, characterId: "cyrene" });
    expect(migration.status).toBe("migrated");
    const layout = stateModule.resolveCharacterStateLayout(userDataRoot, "cyrene");
    stateModule.configureActiveCharacterState(layout);

    const chats = await import("../chats/chats-store");
    chats.initialize();
    chats.createSession({ title: "隔离会话" });
    expect(chats.getRootDir()).toBe(layout.chatsRoot);
    expect(fs.existsSync(path.join(layout.chatsRoot, "index.json"))).toBe(true);
    expect(fs.existsSync(path.join(userDataRoot, "cyrene-chats"))).toBe(false);

    const channelHistory = await import("../channels/history-log");
    channelHistory.appendHistory("channel:wechat:fixture", "user", "渠道隔离消息");
    expect(fs.readdirSync(layout.channelHistoryRoot)).toHaveLength(1);
    const channelLog = await import("../channels/message-log");
    channelLog.appendLog({
      dir: "incoming",
      channel: "wechat",
      senderId: "fixture",
      chatId: "fixture",
      text: "渠道日志隔离消息",
    });
    expect(fs.readFileSync(layout.channelLogFile, "utf8")).toContain("渠道日志隔离消息");

    const { memoryStore } = await import("../memory/memory-store");
    await memoryStore.load();
    expect(fs.existsSync(layout.memoryFile)).toBe(true);
    expect(fs.existsSync(path.join(userDataRoot, "memory.json"))).toBe(false);

    const relationship = await import("../relationship/relationship-log");
    await relationship.recordRelationshipTurn({
      userText: "今天很开心",
      assistantText: "那就好",
      cyreneFeeling: "happy",
      channel: "desktop",
    });
    expect(fs.existsSync(layout.relationshipFile)).toBe(true);

    const { entityGraph } = await import("../memory/entity-graph");
    entityGraph.ingest("我的朋友小鹿是很重要的人");
    expect(fs.existsSync(layout.entityGraphFile)).toBe(true);

    const proactive = await import("../proactive/proactive-state-store");
    const openerState = proactive.defaultProactiveState();
    openerState.globalDesire = 12;
    proactive.saveProactiveState(openerState);
    expect(fs.readFileSync(layout.proactiveStateFile, "utf8")).toContain('"globalDesire": 12');
  });

  it("keeps model runtimes outside the per-character state layout", async () => {
    const { resolveCharacterStateLayout } = await import("./character-state");
    const layout = resolveCharacterStateLayout(userDataRoot, "cyrene");
    const values = Object.values(layout);

    expect(values.every((value) => value.startsWith(layout.root))).toBe(true);
    expect(values.some((value) => /models?|embedding|reranker|asr/i.test(path.relative(layout.root, value)))).toBe(false);
  });

  it("keeps chats, secrets, relationships and vector retrieval physically isolated across relaunches", async () => {
    const configureFor = async (characterId: string) => {
      vi.resetModules();
      const state = await import("./character-state");
      const layout = state.resolveCharacterStateLayout(userDataRoot, characterId);
      state.configureActiveCharacterState(layout);
      return layout;
    };

    const cyrene = await configureFor("cyrene");
    const cyreneChats = await import("../chats/chats-store");
    cyreneChats.initialize();
    cyreneChats.createSession({
      title: "昔涟私密会话",
      initialMessages: [{ id: "c-secret", role: "user", content: "唯一秘密是蓝色月桂", at: 1 }],
    });
    const { memoryStore: cyreneMemory } = await import("../memory/memory-store");
    await cyreneMemory.addL2({
      content: "用户的唯一秘密是蓝色月桂；昔涟称用户为小船长，并承诺下次一起看流星",
      triggerText: "唯一秘密",
      sourceConversationId: "cyrene-chat",
      isPinned: false,
    });
    const cyreneRelationship = await import("../relationship/relationship-log");
    await cyreneRelationship.recordRelationshipTurn({
      userText: "我只把蓝色月桂告诉昔涟",
      assistantText: "我会记住",
      cyreneFeeling: "trusted",
      channel: "desktop",
    });
    const { JsonVectorStore } = await import("../rag/vectorstore");
    new JsonVectorStore(cyrene.ragRoot).addPreparedBatch([{
      text: "昔涟秘密：蓝色月桂",
      source: "user_memory",
      embedding: [1, 0],
    }]);

    const lumen = await configureFor("fixture.lumen");
    const lumenChats = await import("../chats/chats-store");
    lumenChats.initialize();
    expect(lumenChats.listSessions()).toEqual([]);
    const { memoryStore: lumenMemory } = await import("../memory/memory-store");
    const lumenMemoryText = (await lumenMemory.getAllL2()).map((entry) => entry.content).join("\n");
    expect(lumenMemoryText).not.toContain("蓝色月桂");
    expect(lumenMemoryText).not.toContain("小船长");
    expect(lumenMemoryText).not.toContain("一起看流星");
    expect(fs.existsSync(lumen.relationshipFile)).toBe(false);
    const lumenVectors = new (await import("../rag/vectorstore")).JsonVectorStore(lumen.ragRoot);
    const fakeProvider = {
      name: "fixture",
      dims: 2,
      embed: async () => [1, 0],
      embedBatch: async (texts: string[]) => texts.map(() => [1, 0]),
    };
    expect(await lumenVectors.search("蓝色月桂", "user_memory", fakeProvider, 5, 0)).toEqual([]);
    const lumenSession = lumenChats.createSession({
      title: "流明会话",
      initialMessages: [{ id: "l-secret", role: "user", content: "流明代号是金色棱镜", at: 2 }],
    });

    await configureFor("cyrene");
    const restoredChats = await import("../chats/chats-store");
    restoredChats.initialize();
    const restoredSession = restoredChats.getSession(restoredChats.listSessions()[0].id);
    expect(restoredSession?.messages[0].content).toBe("唯一秘密是蓝色月桂");
    const { memoryStore: restoredMemory } = await import("../memory/memory-store");
    const restoredMemoryText = (await restoredMemory.getAllL2()).map((entry) => entry.content).join("\n");
    expect(restoredMemoryText).toContain("蓝色月桂");
    expect(restoredMemoryText).toContain("小船长");
    expect(restoredMemoryText).toContain("一起看流星");
    expect(fs.readFileSync(cyrene.relationshipFile, "utf8")).toContain("蓝色月桂");
    const restoredVectors = new (await import("../rag/vectorstore")).JsonVectorStore(cyrene.ragRoot);
    expect((await restoredVectors.search("蓝色月桂", "user_memory", fakeProvider, 5, 0))[0]?.entry.text)
      .toContain("蓝色月桂");
    expect(path.join(cyrene.ragRoot, "memory-store.json"))
      .not.toBe(path.join(lumen.ragRoot, "memory-store.json"));
    expect(fs.readFileSync(path.join(lumen.chatsRoot, "sessions", `${lumenSession.id}.json`), "utf8"))
      .not.toContain("蓝色月桂");
  });

  it("keeps explicit profile, todos and scheduled tasks readable after changing characters", async () => {
    const configureFor = async (characterId: string) => {
      vi.resetModules();
      const state = await import("./character-state");
      state.configureActiveCharacterState(state.resolveCharacterStateLayout(userDataRoot, characterId));
      return (await import("./global-user-data")).resolveGlobalUserDataLayout(userDataRoot);
    };

    const cyreneGlobal = await configureFor("cyrene");
    fs.writeFileSync(cyreneGlobal.profileFile, JSON.stringify({ nickname: "Kano", timezone: "Asia/Shanghai" }), "utf8");
    const cyreneTodos = await import("../orchestrator/todo-store");
    cyreneTodos.setTodos([{ id: "global-todo", content: "检查角色包", status: "pending" }]);
    const cyreneScheduler = (await import("../scheduler/scheduler-store")).getSchedulerStore();
    cyreneScheduler.addTask({
      title: "全局提醒",
      prompt: "提醒我检查角色包",
      enabled: true,
      schedule: { kind: "daily", timeOfDay: "09:30" },
      toolMode: "all-enabled",
      allowedToolIds: [],
    });

    const lumenGlobal = await configureFor("fixture.lumen");
    expect(lumenGlobal).toEqual(cyreneGlobal);
    expect(JSON.parse(fs.readFileSync(lumenGlobal.profileFile, "utf8"))).toMatchObject({ nickname: "Kano" });
    const lumenTodos = await import("../orchestrator/todo-store");
    lumenTodos.loadTodos();
    expect(lumenTodos.getTodos().todos[0]?.id).toBe("global-todo");
    const lumenScheduler = (await import("../scheduler/scheduler-store")).getSchedulerStore();
    lumenScheduler.load();
    expect(lumenScheduler.getTasks()[0]?.title).toBe("全局提醒");
  });
});
