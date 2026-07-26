export interface WechatAccountSettingsViewItem {
  ilinkBotId: string;
  maskedBotId: string;
  label: string;
  enabled: boolean;
  credentialStatus: "available" | "missing" | "corrupt";
  phase: "starting" | "running" | "offline" | "config_missing" | "login_required" | "error";
  lastConnectedAt?: number;
  errorSummary?: string;
  processing: number;
  queued: number;
}

const PHASE_LABELS: Record<WechatAccountSettingsViewItem["phase"], string> = {
  starting: "连接中",
  running: "已连接",
  offline: "已停用",
  config_missing: "需要登录",
  login_required: "登录已失效",
  error: "连接异常",
};

export function renderWechatAccountListMarkup(
  accounts: WechatAccountSettingsViewItem[],
): string {
  if (accounts.length === 0) {
    return '<p class="wechat-account-empty">尚未添加微信账号。扫码后，仅扫码绑定者本人可以使用 Cyrene。</p>';
  }
  return accounts.map((account, index) => {
    const lastConnected = account.lastConnectedAt
      ? new Date(account.lastConnectedAt).toLocaleString("zh-CN")
      : "暂无连接记录";
    const error = account.errorSummary
      ? `<p class="wechat-account__error" role="status">${escapeHtml(account.errorSummary)}</p>`
      : "";
    return `<article class="wechat-account" data-account-index="${index}">
      <div class="wechat-account__summary">
        <div class="wechat-account__identity">
          <div class="wechat-account__name-row">
            <h3 class="wechat-account__label">${escapeHtml(account.label)}</h3>
            <button type="button" class="wechat-account__rename-trigger" data-wechat-action="rename">修改备注</button>
          </div>
          <div class="wechat-account__rename-editor">
            <label class="wechat-account__rename-label" for="wechat-account-label-${index}">账号备注</label>
            <input id="wechat-account-label-${index}" class="form-input wechat-account__rename-input" data-wechat-rename-input type="text" maxlength="40" value="${escapeHtml(account.label)}" autocomplete="off">
            <button type="button" class="btn-secondary" data-wechat-action="rename-save">保存备注</button>
            <button type="button" class="btn-secondary" data-wechat-action="rename-cancel">取消</button>
          </div>
          <p class="wechat-account__id">${escapeHtml(account.maskedBotId)}</p>
        </div>
        <span class="wechat-account__phase wechat-account__phase--${account.phase}">${PHASE_LABELS[account.phase]}</span>
      </div>
      <p class="wechat-account__meta">最近连接：${escapeHtml(lastConnected)} · 处理中 ${account.processing} · 排队 ${account.queued}</p>
      ${error}
      <div class="wechat-account__actions">
        <button type="button" class="btn-secondary" data-wechat-action="toggle">${account.enabled ? "停用账号" : "启用账号"}</button>
        <button type="button" class="btn-secondary" data-wechat-action="reconnect">立即重连</button>
        <button type="button" class="btn-secondary" data-wechat-action="rescan">重新扫码</button>
        <button type="button" class="btn-secondary" data-wechat-action="logout">退出登录</button>
        <button type="button" class="btn-secondary btn-secondary--danger" data-wechat-action="delete">删除账号</button>
      </div>
    </article>`;
  }).join("");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);
}
