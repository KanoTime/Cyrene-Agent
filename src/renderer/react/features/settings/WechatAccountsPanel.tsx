import { confirmForkDialog } from "./ForkDialogs";
import { useEffect, useState } from "react";
import { Alert, Button, Input, Switch } from "antd";
import type { SettingsApi } from "../../../settings/shared/types";
import type { WechatAccountSettingsViewItem } from "../../../settings/wechat-account-settings-view";
import { Card } from "../../components/ui/Card";

export function WechatAccountsPanel() {
  const api = window.settings as unknown as SettingsApi | undefined;
  const [accounts, setAccounts] = useState<WechatAccountSettingsViewItem[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [labels, setLabels] = useState<Record<string, string>>({});
  const refresh = async () => { if (api?.channelsWechatAccountsList) setAccounts(await api.channelsWechatAccountsList()); };
  useEffect(() => {
    let mounted = true;
    const load = () => { void api?.channelsWechatAccountsList?.().then(items => { if (mounted) setAccounts(items); }).catch(e => { if (mounted) setError(String(e)); }); };
    load();
    const off = api?.onChannelsStatusChanged?.(load);
    return () => { mounted = false; if (typeof off === "function") off(); };
  }, [api]);
  async function act(id: string, operation: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(id); setError("");
    try { const result = await operation(); if (!result.ok) throw new Error(result.error || "操作未完成"); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); }
  }
  if (!api?.channelsWechatAccountsList) return null;
  return <section className="cy-settings-section"><h2>微信连接账号</h2><p>每个账号独立登录、授权、排队和保存对话，仅扫码绑定者可以使用。</p>
    {error && <Alert type="error" title={error} />}
    {accounts.length === 0 && <p>尚未添加账号，请使用扫码登录。</p>}
    {accounts.map(account => <Card key={account.ilinkBotId}>
      <div className="cy-settings-row"><strong>{account.label} · {account.maskedBotId}</strong><Switch checked={account.enabled} disabled={Boolean(busy)} onChange={enabled => void act(account.ilinkBotId, () => api.channelsWechatAccountSetEnabled(account.ilinkBotId, enabled))} /></div>
      <p>{account.phase} · 处理中 {account.processing} · 排队 {account.queued}{account.errorSummary ? ` · ${account.errorSummary}` : ""}</p>
      <div className="cy-channels-actions"><Input aria-label="账号备注" maxLength={40} value={labels[account.ilinkBotId] ?? account.label} onChange={e => setLabels(current => ({ ...current, [account.ilinkBotId]: e.target.value }))} /><Button disabled={Boolean(busy)} onClick={() => void act(account.ilinkBotId, () => api.channelsWechatAccountRename(account.ilinkBotId, labels[account.ilinkBotId] ?? account.label))}>保存备注</Button></div>
      <div className="cy-channels-actions"><Button disabled={Boolean(busy)} onClick={() => void act(account.ilinkBotId, () => api.channelsWechatAccountReconnect(account.ilinkBotId))}>重连</Button><Button disabled={Boolean(busy)} onClick={() => void act(account.ilinkBotId, () => api.channelsWechatAccountRescan(account.ilinkBotId))}>重新扫码</Button><Button disabled={Boolean(busy)} onClick={async () => { if (await confirmForkDialog({ title: "退出登录", message: `退出「${account.label}」的登录？` })) void act(account.ilinkBotId, () => api.channelsWechatLogout(account.ilinkBotId)); }}>退出登录</Button><Button danger disabled={Boolean(busy)} onClick={async () => { if (await confirmForkDialog({ title: "删除连接账号", message: `删除「${account.label}」连接账号？`, danger: true })) void act(account.ilinkBotId, () => api.channelsWechatAccountDelete(account.ilinkBotId)); }}>删除账号</Button></div>
    </Card>)}
  </section>;
}
