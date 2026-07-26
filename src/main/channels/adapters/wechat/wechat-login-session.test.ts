import { describe, expect, it, vi } from "vitest";
import { WechatLoginSessionCoordinator } from "./wechat-login-session";
import type { Credentials } from "./ilink-protocol-client";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("WechatLoginSessionCoordinator", () => {
  it("并发开始也只请求并创建一个二维码会话", async () => {
    const qr = deferred<{ qrcode: string; imageContent: string }>();
    const fetchQrCode = vi.fn(() => qr.promise);
    const coordinator = new WechatLoginSessionCoordinator({
      fetchQrCode,
      createQrDataUrl: vi.fn(async () => "data:one"),
      waitForLogin: vi.fn(() => new Promise<Credentials>(() => undefined)),
    });
    const first = coordinator.start();
    const second = coordinator.start();
    qr.resolve({ qrcode: "ticket", imageContent: "url" });

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ state: "waiting", qrDataUrl: "data:one" }),
      expect.objectContaining({ state: "waiting", qrDataUrl: "data:one" }),
    ]);
    expect(fetchQrCode).toHaveBeenCalledTimes(1);
  });

  it("同时只保留一个扫码会话，重复开始返回原会话而不覆盖二维码", async () => {
    const login = deferred<Credentials>();
    const fetchQrCode = vi.fn(async () => ({ qrcode: "ticket-1", imageContent: "url-1" }));
    const coordinator = new WechatLoginSessionCoordinator({
      fetchQrCode,
      createQrDataUrl: vi.fn(async () => "data:image/png;base64,one"),
      waitForLogin: vi.fn(() => login.promise),
    });

    const first = await coordinator.start();
    const second = await coordinator.start();

    expect(second).toEqual(first);
    expect(first).toMatchObject({ state: "waiting", qrDataUrl: "data:image/png;base64,one" });
    expect(fetchQrCode).toHaveBeenCalledTimes(1);
  });

  it("取消会终止轮询；刷新会结束旧会话并创建新二维码", async () => {
    const signals: AbortSignal[] = [];
    let ticket = 0;
    const coordinator = new WechatLoginSessionCoordinator({
      fetchQrCode: vi.fn(async () => {
        ticket += 1;
        return { qrcode: `ticket-${ticket}`, imageContent: `url-${ticket}` };
      }),
      createQrDataUrl: vi.fn(async (value) => `data:${value}`),
      waitForLogin: vi.fn((_qrcode, signal) => {
        signals.push(signal);
        return new Promise<Credentials>(() => undefined);
      }),
    });

    const first = await coordinator.start();
    const refreshed = await coordinator.refresh();

    expect(signals[0]?.aborted).toBe(true);
    expect(refreshed.sessionId).not.toBe(first.sessionId);
    expect(refreshed.qrDataUrl).toBe("data:url-2");
    await coordinator.cancel();
    expect(signals[1]?.aborted).toBe(true);
    expect(coordinator.getSnapshot()).toMatchObject({ state: "cancelled" });
  });

  it("确认后保存账号；相同 ilinkBotId 由仓储 upsert 更新既有账号", async () => {
    const login = deferred<Credentials>();
    const saveCredentials = vi.fn(async () => undefined);
    const coordinator = new WechatLoginSessionCoordinator({
      fetchQrCode: vi.fn(async () => ({ qrcode: "ticket", imageContent: "url" })),
      createQrDataUrl: vi.fn(async () => "data:url"),
      waitForLogin: vi.fn(() => login.promise),
      saveCredentials,
    });
    await coordinator.start();
    const credentials: Credentials = {
      ilinkBotId: "existing@im.wechat",
      ilinkUserId: "owner@im.wechat",
      botToken: "new-token",
      baseUrl: "https://ilink.example.test",
    };

    login.resolve(credentials);
    await vi.waitFor(() => expect(coordinator.getSnapshot().state).toBe("confirmed"));
    expect(saveCredentials).toHaveBeenCalledWith(credentials);
    expect(coordinator.getSnapshot()).toMatchObject({
      state: "confirmed",
      ilinkBotId: "existing@im.wechat",
    });
  });
});
