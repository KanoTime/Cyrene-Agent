import { useEffect, useState } from "react";
import { Alert, Button, Input } from "antd";

type LocalSettings = { asrLocalRoot: string; asrLocalModelPath: string; asrLocalTimeoutMs: number; asrLocalSystemPrompt: string };
export function LocalAsrSettingsPanel() {
  const [settings, setSettings] = useState<LocalSettings | null>(null);
  const [message, setMessage] = useState("");
  const api = window.settings as unknown as { getGeneral(): Promise<LocalSettings>; saveGeneral(patch: Partial<LocalSettings>): Promise<unknown>; getLocalAsrStatus(start?: boolean): Promise<unknown>; testLocalAsr(): Promise<unknown> };
  useEffect(() => { let alive = true; void api?.getGeneral().then(value => { if (alive) setSettings(value); }).catch(e => { if (alive) setMessage(String(e)); }); return () => { alive = false; }; }, [api]);
  if (!settings) return null;
  return <section className="cy-settings-section"><h2>本地 Qwen3-ASR（MLX）</h2>
    <label>环境目录<Input value={settings.asrLocalRoot} onChange={e => setSettings({ ...settings, asrLocalRoot: e.target.value })} /></label>
    <label>模型目录<Input value={settings.asrLocalModelPath} onChange={e => setSettings({ ...settings, asrLocalModelPath: e.target.value })} /></label>
    <label>识别超时（毫秒）<Input type="number" value={settings.asrLocalTimeoutMs} onChange={e => setSettings({ ...settings, asrLocalTimeoutMs: Number(e.target.value) })} /></label>
    <label>转写提示<Input.TextArea value={settings.asrLocalSystemPrompt} onChange={e => setSettings({ ...settings, asrLocalSystemPrompt: e.target.value })} /></label>
    <Button onClick={() => { void api.saveGeneral(settings).then(() => setMessage("本地 ASR 设置已保存")).catch(e => setMessage(String(e))); }}>保存</Button>
    <Button onClick={() => { void api.getLocalAsrStatus(true).then(value => setMessage(JSON.stringify(value))).catch(e => setMessage(String(e))); }}>启动并检查</Button>
    <Button onClick={() => { void api.testLocalAsr().then(value => setMessage(JSON.stringify(value))).catch(e => setMessage(String(e))); }}>测试识别</Button>
    {message && <Alert title={message} />}
  </section>;
}
