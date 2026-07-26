import { describe, expect, it, vi } from "vitest";
import { ILinkBotAdapter } from "./ilink-bot-adapter";
import type { OutgoingMessage } from "../../types";
import type { IncomingMessage } from "../../types";
import type { WechatAccountRecord } from "./wechat-account-store";

vi.mock("electron", () => ({
  app: {
    getPath: () => "C:/tmp/cyrene-test-user-data",
  },
}));

function message(parts: OutgoingMessage["parts"]): OutgoingMessage {
  return {
    channel: "wechat",
    targetId: "wx-user-1",
    parts,
  };
}

describe("ILinkBotAdapter.send", () => {
  it("显式微信出站缺少账号、账号离线或绑定者不匹配时不回退默认 client", async () => {
    const adapter = new ILinkBotAdapter();
    const defaultSend = vi.fn(async () => ({ ok: true }));
    (adapter as any).client = { sendText: defaultSend };
    (adapter as any).replyContextByTarget.set("owner-a@im.wechat", "legacy-context");

    const missingAccount = await adapter.send({
      channel: "wechat",
      connectionAccountId: "missing@im.wechat",
      conversationIdentity: {
        channel: "wechat",
        connectionAccountId: "missing@im.wechat",
        participantId: "owner-a@im.wechat",
      },
      targetId: "owner-a@im.wechat",
      parts: [{ kind: "text", text: "不能回退" }],
    });
    expect(missingAccount).toEqual({ ok: false, error: "指定的微信账号未连接" });

    const accountSend = vi.fn(async () => ({ ok: true }));
    (adapter as any).clientsByAccount.set("account-a@im.wechat", { sendText: accountSend });
    (adapter as any).credentialsByAccount.set("account-a@im.wechat", {
      ilinkBotId: "account-a@im.wechat",
      ilinkUserId: "owner-a@im.wechat",
      botToken: "token",
      baseUrl: "https://example.test",
    });
    (adapter as any).replyContextByAccountTarget.set("account-a@im.wechat\0owner-a@im.wechat", "ctx-a");
    const mismatch = await adapter.send({
      channel: "wechat",
      connectionAccountId: "account-a@im.wechat",
      conversationIdentity: {
        channel: "wechat",
        connectionAccountId: "account-a@im.wechat",
        participantId: "other-owner@im.wechat",
      },
      targetId: "other-owner@im.wechat",
      parts: [{ kind: "text", text: "不能串号" }],
    });
    expect(mismatch).toEqual({ ok: false, error: "微信绑定者身份不匹配" });
    expect(defaultSend).not.toHaveBeenCalled();
    expect(accountSend).not.toHaveBeenCalled();
  });

  it("sends text replies through the protocol client with the cached context token", async () => {
    const adapter = new ILinkBotAdapter();
    const sendText = vi.fn(async () => ({ ok: true }));
    (adapter as any).client = { sendText };
    (adapter as any).replyContextByTarget.set("wx-user-1", "ctx-1");

    const result = await adapter.send(message([{ kind: "text", text: "你好" }]));

    expect(result).toEqual({ ok: true });
    expect(sendText).toHaveBeenCalledWith("wx-user-1", "你好", "ctx-1");
  });

  it("sends multiple text parts as separate messages", async () => {
    const adapter = new ILinkBotAdapter();
    const sendText = vi.fn(async () => ({ ok: true }));
    (adapter as any).client = { sendText };
    (adapter as any).replyContextByTarget.set("wx-user-1", "ctx-1");

    const result = await adapter.send(message([
      { kind: "text", text: "第一句。" },
      { kind: "text", text: "第二句？" },
      { kind: "text", text: "\n第三句！" },
    ]));

    expect(result).toEqual({ ok: true });
    expect(sendText).toHaveBeenNthCalledWith(1, "wx-user-1", "第一句。", "ctx-1");
    expect(sendText).toHaveBeenNthCalledWith(2, "wx-user-1", "第二句？", "ctx-1");
    expect(sendText).toHaveBeenNthCalledWith(3, "wx-user-1", "第三句！", "ctx-1");
  });

  it("uploads image and sticker parts as image items in one sendmessage payload", async () => {
    const adapter = new ILinkBotAdapter();
    const sendText = vi.fn(async () => ({ ok: true }));
    const sendMessage = vi.fn(async () => ({ ok: true }));
    const uploadMedia = vi.fn(async (_client, _userId, filePath: string) => ({
      encrypt_query_param: `encrypted:${filePath}`,
      aes_key: "encoded-key",
      encrypt_type: 1,
    }));
    (adapter as any).client = { sendText, sendMessage };
    (adapter as any).uploadMedia = uploadMedia;
    (adapter as any).replyContextByTarget.set("wx-user-1", "ctx-1");

    const result = await adapter.send(message([
      { kind: "text", text: "看图" },
      { kind: "image", filePath: "C:/tmp/pic.png", caption: "图片" },
      { kind: "sticker", stickerId: "happy", imagePath: "C:/tmp/sticker.png" },
    ]));

    expect(result).toEqual({ ok: true });
    expect(sendText).toHaveBeenCalledWith("wx-user-1", "看图", "ctx-1");
    expect(uploadMedia).toHaveBeenCalledTimes(2);
    expect(uploadMedia).toHaveBeenNthCalledWith(1, expect.anything(), "wx-user-1", "C:/tmp/pic.png", 1);
    expect(uploadMedia).toHaveBeenNthCalledWith(2, expect.anything(), "wx-user-1", "C:/tmp/sticker.png", 1);
    expect(sendMessage).toHaveBeenNthCalledWith(1, "wx-user-1", [
      {
        type: 2,
        image_item: {
          media: {
            encrypt_query_param: "encrypted:C:/tmp/pic.png",
            aes_key: "encoded-key",
            encrypt_type: 1,
          },
        },
      },
    ], "ctx-1");
    expect(sendMessage).toHaveBeenNthCalledWith(2, "wx-user-1", [
      {
        type: 2,
        image_item: {
          media: {
            encrypt_query_param: "encrypted:C:/tmp/sticker.png",
            aes_key: "encoded-key",
            encrypt_type: 1,
          },
        },
      },
    ], "ctx-1");
  });

  it("uploads file and video parts as file and video items", async () => {
    const adapter = new ILinkBotAdapter();
    const sendMessage = vi.fn(async () => ({ ok: true }));
    const uploadMedia = vi.fn(async (_client, _userId, filePath: string) => ({
      encrypt_query_param: `encrypted:${filePath}`,
      aes_key: "encoded-key",
      encrypt_type: 1,
    }));
    (adapter as any).client = { sendMessage };
    (adapter as any).uploadMedia = uploadMedia;
    (adapter as any).replyContextByTarget.set("wx-user-1", "ctx-1");

    const result = await adapter.send(message([
      { kind: "file", filePath: "package.json", name: "report.pdf", mime: "application/pdf" },
      { kind: "video", filePath: "C:/tmp/demo.mp4", name: "demo.mp4", mime: "video/mp4" },
    ]));

    expect(result).toEqual({ ok: true });
    expect(uploadMedia).toHaveBeenNthCalledWith(1, expect.anything(), "wx-user-1", "package.json", 3);
    expect(uploadMedia).toHaveBeenNthCalledWith(2, expect.anything(), "wx-user-1", "C:/tmp/demo.mp4", 2);
    expect(sendMessage).toHaveBeenNthCalledWith(1, "wx-user-1", [
      {
        type: 4,
        file_item: {
          file_name: "report.pdf",
          len: expect.stringMatching(/^\d+$/),
          media: {
            encrypt_query_param: "encrypted:package.json",
            aes_key: "encoded-key",
            encrypt_type: 1,
          },
        },
      },
    ], "ctx-1");
    expect(sendMessage).toHaveBeenNthCalledWith(2, "wx-user-1", [
      {
        type: 5,
        video_item: {
          media: {
            encrypt_query_param: "encrypted:C:/tmp/demo.mp4",
            aes_key: "encoded-key",
            encrypt_type: 1,
          },
        },
      },
    ], "ctx-1");
  });

  it("uploads audio replies as compact playable M4A files", async () => {
    const adapter = new ILinkBotAdapter();
    const sendText = vi.fn(async () => ({ ok: true }));
    const sendMessage = vi.fn(async () => ({ ok: true }));
    const uploadMedia = vi.fn(async (_client, _userId, filePath: string) => ({
      encrypt_query_param: `encrypted:${filePath}`,
      aes_key: "encoded-key",
      encrypt_type: 1,
    }));
    (adapter as any).client = { sendText, sendMessage };
    (adapter as any).uploadMedia = uploadMedia;
    (adapter as any).prepareAudioFile = vi.fn(async () => ({
      filePath: "package.json",
      fileName: "语音回复.m4a",
      mime: "audio/mp4",
      converted: true,
    }));
    (adapter as any).replyContextByTarget.set("wx-user-1", "ctx-1");

    const result = await adapter.send(message([
      { kind: "text", text: "语音来了" },
      { kind: "audio", filePath: "package.json", mime: "audio/wav" },
    ]));

    expect(result).toEqual({ ok: true });
    expect(sendText).toHaveBeenCalledWith("wx-user-1", "语音来了", "ctx-1");
    expect(uploadMedia).toHaveBeenCalledWith(expect.anything(), "wx-user-1", "package.json", 3);
    expect(sendMessage).toHaveBeenCalledWith("wx-user-1", [
      {
        type: 4,
        file_item: {
          file_name: "语音回复.m4a",
          len: expect.stringMatching(/^\d+$/),
          media: {
            encrypt_query_param: "encrypted:package.json",
            aes_key: "encoded-key",
            encrypt_type: 1,
          },
        },
      },
    ], "ctx-1");
  });

  it("相同联系人跨两个连接账号时保留独立身份、client 和 context token", async () => {
    const adapter = new ILinkBotAdapter();
    const sendTextA = vi.fn(async () => ({ ok: true }));
    const sendTextB = vi.fn(async () => ({ ok: true }));
    const clientA = { sendText: sendTextA };
    const clientB = { sendText: sendTextB };
    const accountA: WechatAccountRecord = {
      ilinkBotId: "route-a@im.wechat",
      label: "路由甲",
      enabled: true,
      credentialStatus: "available",
      createdAt: 1,
      updatedAt: 1,
    };
    const accountB: WechatAccountRecord = { ...accountA, ilinkBotId: "route-b@im.wechat", label: "路由乙" };
    const incoming: IncomingMessage[] = [];
    adapter.onMessage = async (msg) => {
      incoming.push(msg);
      return null;
    };
    (adapter as any).clientsByAccount.set(accountA.ilinkBotId, clientA);
    (adapter as any).clientsByAccount.set(accountB.ilinkBotId, clientB);
    (adapter as any).credentialsByAccount.set(accountA.ilinkBotId, {
      ilinkBotId: accountA.ilinkBotId,
      ilinkUserId: "same-owner@im.wechat",
      botToken: "token-a",
      baseUrl: "https://example.test",
    });
    (adapter as any).credentialsByAccount.set(accountB.ilinkBotId, {
      ilinkBotId: accountB.ilinkBotId,
      ilinkUserId: "same-owner@im.wechat",
      botToken: "token-b",
      baseUrl: "https://example.test",
    });

    const inbound = (contextToken: string) => ({
      msgId: contextToken,
      fromUserId: "same-owner@im.wechat",
      toUserId: "bot@im.wechat",
      msgType: 1,
      content: "你好",
      items: [{ type: 1, text_item: { text: "你好" } }],
      contextToken,
      raw: {},
    });
    await (adapter as any).dispatchInbound(inbound("context-a"), clientA, accountA);
    await (adapter as any).dispatchInbound(inbound("context-b"), clientB, accountB);

    expect(incoming.map((msg) => msg.conversationIdentity)).toEqual([
      {
        channel: "wechat",
        connectionAccountId: accountA.ilinkBotId,
        participantId: "same-owner@im.wechat",
      },
      {
        channel: "wechat",
        connectionAccountId: accountB.ilinkBotId,
        participantId: "same-owner@im.wechat",
      },
    ]);

    for (const [account, text] of [
      [accountA, "甲回复"],
      [accountB, "乙回复"],
    ] as const) {
      await adapter.send({
        channel: "wechat",
        connectionAccountId: account.ilinkBotId,
        conversationIdentity: {
          channel: "wechat",
          connectionAccountId: account.ilinkBotId,
          participantId: "same-owner@im.wechat",
        },
        targetId: "same-owner@im.wechat",
        parts: [{ kind: "text", text }],
      });
    }

    expect(sendTextA).toHaveBeenCalledWith("same-owner@im.wechat", "甲回复", "context-a");
    expect(sendTextB).toHaveBeenCalledWith("same-owner@im.wechat", "乙回复", "context-b");
  });
});

describe("ILinkBotAdapter inbound media", () => {
  it("downloads supported image media into incoming attachments", async () => {
    const adapter = new ILinkBotAdapter();
    const onMessage = vi.fn(async () => null);
    (adapter as any).onMessage = onMessage;
    (adapter as any).client = { sendText: vi.fn() };
    (adapter as any).downloadMedia = vi.fn(async () => ({
      filePath: "C:/tmp/cyrene-test-user-data/channels/cache/wechat-msg-1-image.png",
      mime: "image/png",
    }));

    await (adapter as any).dispatchInbound({
      msgId: "msg-1",
      fromUserId: "wx-user-1",
      toUserId: "bot-1",
      msgType: 1,
      content: "看看这个",
      items: [
        {
          type: 2,
          image_item: {
            media: {
              encrypt_query_param: "download-param",
              aes_key: "MDAxMTIyMzM0NDU1NjY3Nzg4OTlhYWJiY2NkZGVlZmY=",
              encrypt_type: 1,
            },
          },
        },
      ],
      contextToken: "ctx-1",
      raw: {},
    });

    expect((adapter as any).downloadMedia).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "image" }),
      "msg-1",
    );
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({
      channel: "wechat",
      senderId: "wx-user-1",
      text: "看看这个",
      attachments: [
        {
          kind: "image",
          filePath: "C:/tmp/cyrene-test-user-data/channels/cache/wechat-msg-1-image.png",
          mime: "image/png",
          caption: "微信图片",
        },
      ],
    }));
  });

  it("does not dispatch to the agent when supported media download fails", async () => {
    const adapter = new ILinkBotAdapter();
    const onMessage = vi.fn(async () => null);
    const sendText = vi.fn(async () => ({ ok: true }));
    (adapter as any).onMessage = onMessage;
    (adapter as any).client = { sendText };
    (adapter as any).downloadMedia = vi.fn(async () => {
      throw new Error("download failed");
    });

    await (adapter as any).dispatchInbound({
      msgId: "msg-2",
      fromUserId: "wx-user-1",
      toUserId: "bot-1",
      msgType: 1,
      content: "看看这个",
      items: [
        {
          type: 2,
          image_item: {
            media: {
              encrypt_query_param: "download-param",
              aes_key: "MDAxMTIyMzM0NDU1NjY3Nzg4OTlhYWJiY2NkZGVlZmY=",
              encrypt_type: 1,
            },
          },
        },
      ],
      contextToken: "ctx-1",
      raw: {},
    });

    expect(sendText).toHaveBeenCalledWith(
      "wx-user-1",
      expect.stringContaining("微信附件下载失败"),
      "ctx-1",
    );
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("saves a pending unsupported file when the user replies with save intent within five minutes", async () => {
    const adapter = new ILinkBotAdapter();
    const onMessage = vi.fn(async () => null);
    const sendText = vi.fn(async () => ({ ok: true }));
    (adapter as any).onMessage = onMessage;
    (adapter as any).client = { sendText };
    (adapter as any).saveInboundMedia = vi.fn(async () => "C:/Users/13575/Desktop/Cyrene 收件箱/archive.zip");

    await (adapter as any).dispatchInbound({
      msgId: "msg-file-1",
      fromUserId: "wx-user-1",
      toUserId: "bot-1",
      msgType: 1,
      content: "",
      items: [
        {
          type: 4,
          file_item: {
            file_name: "archive.zip",
            media: {
              encrypt_query_param: "download-param",
              aes_key: "MDAxMTIyMzM0NDU1NjY3Nzg4OTlhYWJiY2NkZGVlZmY=",
              encrypt_type: 1,
            },
          },
        },
      ],
      contextToken: "ctx-file",
      raw: {},
    });
    await (adapter as any).dispatchInbound({
      msgId: "msg-text-1",
      fromUserId: "wx-user-1",
      toUserId: "bot-1",
      msgType: 1,
      content: "保存到桌面",
      items: [{ type: 1, text_item: { text: "保存到桌面" } }],
      contextToken: "ctx-text",
      raw: {},
    });

    expect((adapter as any).saveInboundMedia).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "file", fileName: "archive.zip" }),
      "msg-file-1",
    );
    expect(sendText).toHaveBeenLastCalledWith(
      "wx-user-1",
      "收好啦，伙伴。人家已经帮你放到桌面的“Cyrene 收件箱”里了：C:/Users/13575/Desktop/Cyrene 收件箱/archive.zip",
      "ctx-text",
    );
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("saves an unsupported file when it arrives after a save intent", async () => {
    const adapter = new ILinkBotAdapter();
    const onMessage = vi.fn(async () => null);
    const sendText = vi.fn(async () => ({ ok: true }));
    (adapter as any).onMessage = onMessage;
    (adapter as any).client = { sendText };
    (adapter as any).saveInboundMedia = vi.fn(async () => "C:/Users/13575/Desktop/Cyrene 收件箱/movie.mp4");

    await (adapter as any).dispatchInbound({
      msgId: "msg-text-2",
      fromUserId: "wx-user-1",
      toUserId: "bot-1",
      msgType: 1,
      content: "帮我代收一下",
      items: [{ type: 1, text_item: { text: "帮我代收一下" } }],
      contextToken: "ctx-text",
      raw: {},
    });
    await (adapter as any).dispatchInbound({
      msgId: "msg-video-1",
      fromUserId: "wx-user-1",
      toUserId: "bot-1",
      msgType: 1,
      content: "",
      items: [
        {
          type: 5,
          video_item: {
            file_name: "movie.mp4",
            media: {
              encrypt_query_param: "download-param",
              aes_key: "MDAxMTIyMzM0NDU1NjY3Nzg4OTlhYWJiY2NkZGVlZmY=",
              encrypt_type: 1,
            },
          },
        },
      ],
      contextToken: "ctx-video",
      raw: {},
    });

    expect(sendText).toHaveBeenNthCalledWith(
      1,
      "wx-user-1",
      "好呀，伙伴，尽管把文件发过来吧。我会帮你放到桌面的“Cyrene 收件箱”里哦~~",
      "ctx-text",
    );
    expect((adapter as any).saveInboundMedia).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "video", fileName: "movie.mp4" }),
      "msg-video-1",
    );
    expect(sendText).toHaveBeenLastCalledWith(
      "wx-user-1",
      "收好啦，伙伴。人家已经帮你放到桌面的“Cyrene 收件箱”里了：C:/Users/13575/Desktop/Cyrene 收件箱/movie.mp4",
      "ctx-video",
    );
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("不同连接账号不会共享同一联系人 ID 的待保存媒体状态", async () => {
    const adapter = new ILinkBotAdapter();
    const sendText = vi.fn(async () => ({ ok: true }));
    const client = { sendText };
    (adapter as any).onMessage = vi.fn(async () => null);
    (adapter as any).client = client;
    (adapter as any).saveInboundMedia = vi.fn(async () => "/tmp/should-not-save.mp4");
    const accountA: WechatAccountRecord = {
      ilinkBotId: "media-a@im.wechat",
      label: "媒体甲",
      enabled: true,
      credentialStatus: "available",
      createdAt: 1,
      updatedAt: 1,
    };
    const accountB: WechatAccountRecord = { ...accountA, ilinkBotId: "media-b@im.wechat", label: "媒体乙" };

    await (adapter as any).dispatchInbound(
      {
        msgId: "video-a",
        fromUserId: "same-owner@im.wechat",
        toUserId: "bot-a",
        msgType: 1,
        content: "",
        items: [
          {
            type: 5,
            video_item: {
              file_name: "private-a.mp4",
              media: {
                encrypt_query_param: "download-param-a",
                aes_key: "MDAxMTIyMzM0NDU1NjY3Nzg4OTlhYWJiY2NkZGVlZmY=",
                encrypt_type: 1,
              },
            },
          },
        ],
        contextToken: "context-a",
        raw: {},
      },
      client,
      accountA,
    );
    await (adapter as any).dispatchInbound(
      {
        msgId: "save-b",
        fromUserId: "same-owner@im.wechat",
        toUserId: "bot-b",
        msgType: 1,
        content: "保存到桌面",
        items: [{ type: 1, text_item: { text: "保存到桌面" } }],
        contextToken: "context-b",
        raw: {},
      },
      client,
      accountB,
    );

    expect((adapter as any).saveInboundMedia).not.toHaveBeenCalled();
  });

  it("saves an analyzable file instead of dispatching it when a save intent is already pending", async () => {
    const adapter = new ILinkBotAdapter();
    const onMessage = vi.fn(async () => null);
    const sendText = vi.fn(async () => ({ ok: true }));
    (adapter as any).onMessage = onMessage;
    (adapter as any).client = { sendText };
    (adapter as any).saveInboundMedia = vi.fn(async () => "C:/Users/13575/Desktop/Cyrene 收件箱/report.pdf");
    (adapter as any).downloadMedia = vi.fn();

    await (adapter as any).dispatchInbound({
      msgId: "msg-text-3",
      fromUserId: "wx-user-1",
      toUserId: "bot-1",
      msgType: 1,
      content: "保存到桌面",
      items: [{ type: 1, text_item: { text: "保存到桌面" } }],
      contextToken: "ctx-text",
      raw: {},
    });
    await (adapter as any).dispatchInbound({
      msgId: "msg-file-2",
      fromUserId: "wx-user-1",
      toUserId: "bot-1",
      msgType: 1,
      content: "",
      items: [
        {
          type: 4,
          file_item: {
            file_name: "report.pdf",
            media: {
              encrypt_query_param: "download-param",
              aes_key: "MDAxMTIyMzM0NDU1NjY3Nzg4OTlhYWJiY2NkZGVlZmY=",
              encrypt_type: 1,
            },
          },
        },
      ],
      contextToken: "ctx-file",
      raw: {},
    });

    expect((adapter as any).saveInboundMedia).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "file", fileName: "report.pdf" }),
      "msg-file-2",
    );
    expect((adapter as any).downloadMedia).not.toHaveBeenCalled();
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("transcribes inbound voice and dispatches the transcript when ASR is configured", async () => {
    const adapter = new ILinkBotAdapter();
    const onMessage = vi.fn(async () => null);
    const sendText = vi.fn(async () => ({ ok: true }));
    (adapter as any).onMessage = onMessage;
    (adapter as any).client = { sendText };
    (adapter as any).isAsrConfigured = () => true;
    (adapter as any).transcribeVoice = vi.fn(async () => "你在忙什么呀");

    await (adapter as any).dispatchInbound({
      msgId: "msg-voice-1",
      fromUserId: "wx-user-1",
      toUserId: "bot-1",
      msgType: 1,
      content: "",
      items: [
        {
          type: 3,
          voice_item: {
            media: {
              encrypt_query_param: "download-param",
              aes_key: "MDAxMTIyMzM0NDU1NjY3Nzg4OTlhYWJiY2NkZGVlZmY=",
              encrypt_type: 1,
            },
            sample_rate: 16000,
          },
        },
      ],
      contextToken: "ctx-voice",
      raw: {},
    });

    expect((adapter as any).transcribeVoice).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "voice", fileName: "微信语音" }),
      "msg-voice-1",
    );
    expect(sendText).not.toHaveBeenCalled();
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({
      channel: "wechat",
      senderId: "wx-user-1",
      text: "你在忙什么呀",
      attachments: undefined,
    }));
  });

  it("does not dispatch inbound voice when ASR transcription fails", async () => {
    const adapter = new ILinkBotAdapter();
    const onMessage = vi.fn(async () => null);
    const sendText = vi.fn(async () => ({ ok: true }));
    (adapter as any).onMessage = onMessage;
    (adapter as any).client = { sendText };
    (adapter as any).isAsrConfigured = () => true;
    (adapter as any).transcribeVoice = vi.fn(async () => {
      throw new Error("ASR timeout");
    });

    await (adapter as any).dispatchInbound({
      msgId: "msg-voice-2",
      fromUserId: "wx-user-1",
      toUserId: "bot-1",
      msgType: 1,
      content: "",
      items: [
        {
          type: 3,
          voice_item: {
            media: {
              encrypt_query_param: "download-param",
              aes_key: "MDAxMTIyMzM0NDU1NjY3Nzg4OTlhYWJiY2NkZGVlZmY=",
              encrypt_type: 1,
            },
            sample_rate: 16000,
          },
        },
      ],
      contextToken: "ctx-voice",
      raw: {},
    });

    expect(sendText).toHaveBeenCalledWith(
      "wx-user-1",
      "伙伴，这条语音人家暂时没听清楚：ASR timeout。可以换成文字再发我一次哦~~",
      "ctx-voice",
    );
    expect(onMessage).not.toHaveBeenCalled();
  });
});
