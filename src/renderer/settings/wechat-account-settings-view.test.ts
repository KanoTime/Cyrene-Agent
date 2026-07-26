import { describe, expect, it } from "vitest";
import { renderWechatAccountListMarkup } from "./wechat-account-settings-view";

describe("微信多账号设置视图", () => {
  it("显示账号状态与逐账号操作，并清楚区分停用、退出登录和删除", () => {
    const markup = renderWechatAccountListMarkup([
      {
        ilinkBotId: "private-id@im.wechat",
        maskedBotId: "pri…id@im.wechat",
        label: "日常号",
        enabled: true,
        credentialStatus: "available",
        phase: "running",
        lastConnectedAt: 1_700_000_000_000,
        processing: 1,
        queued: 2,
      },
    ]);

    expect(markup).toContain("日常号");
    expect(markup).toContain("pri…id@im.wechat");
    expect(markup).not.toContain("private-id@im.wechat");
    expect(markup).toContain("处理中 1");
    expect(markup).toContain("排队 2");
    expect(markup).toContain('data-wechat-action="rename"');
    expect(markup).toContain('data-wechat-action="rename-save"');
    expect(markup).toContain('data-wechat-action="rename-cancel"');
    expect(markup).toContain('value="日常号"');
    expect(markup).toContain("停用账号");
    expect(markup).toContain("退出登录");
    expect(markup).toContain("删除账号");
    expect(markup).not.toContain("全部退出");
    expect(markup).not.toContain("联系人审批");
  });

  it("空状态说明扫码后仅绑定者本人可用", () => {
    expect(renderWechatAccountListMarkup([])).toContain("扫码绑定者本人");
  });

  it("转义账号备注和错误摘要，避免状态数据注入设置页", () => {
    const markup = renderWechatAccountListMarkup([
      {
        ilinkBotId: "safe@im.wechat",
        maskedBotId: "***@im.wechat",
        label: "<img src=x onerror=alert(1)>",
        enabled: true,
        credentialStatus: "available",
        phase: "error",
        errorSummary: "<script>alert(1)</script>",
        processing: 0,
        queued: 0,
      },
    ]);
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("&lt;img");
    expect(markup).toContain("&lt;script&gt;");
  });
});
