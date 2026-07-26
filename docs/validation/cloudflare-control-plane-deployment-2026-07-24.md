# Cloudflare 控制面部署验证

> 日期：2026-07-24
>
> 生产 Origin：`https://cyrene-device-authorization.cyrene-agent.workers.dev`

## 已完成

- Cloudflare 账户已注册 `cyrene-agent.workers.dev` 子域。
- Worker `cyrene-device-authorization` 已部署。
- SQLite-backed Durable Object `DeviceAuthorizationDurableObject` 已创建；所有 `/v1/*` 请求按固定名称路由到单个 Owner 聚合。
- 5 个敏感配置已作为 `secret_text` 上传：
  - `CYRENE_DEPLOYMENT_BOOTSTRAP_CODE_HASH`
  - `CYRENE_LIVEKIT_SERVER_URL`
  - `CYRENE_LIVEKIT_API_KEY`
  - `CYRENE_LIVEKIT_API_SECRET`
  - `CYRENE_MEDIA_ENVELOPE_MASTER_KEY`
- Secret 从 macOS 钥匙串经标准输入上传；未写入 Wrangler 配置、仓库或命令行参数，部署输出未显示明文。
- Cloudflare Owner 已初始化，Owner Recovery Key 已确认并保存到 macOS 钥匙串服务 `Cyrene Owner Recovery Key - Cloudflare cyrene-device-authorization`。
- 桌面 Device Credential 已由 Electron `safeStorage` 加密保存，控制面 Origin 已切换到 Cloudflare。
- 原 CloudBase 桌面凭据文件保留为只读回退备份：
  `/Users/kano/Library/Application Support/live2d-cyrene/remote-access/desktop-device.enc.cloudbase-backup-2026-07-24T09-02-21-920Z`
- 中断迁移遗留的一个 `0600` 临时凭据文件及其私有临时目录已精确删除；复核没有同前缀残留。

## 验证证据

- Wrangler dry-run 打包：186.79 KiB，gzip 37.92 KiB。
- Worker 启动时间：16 ms。
- `/healthz` 经本机代理返回 `200 {"status":"ok"}`。
- 未授权 `/v1/pairing/begin` 返回 `401 DESKTOP_AUTHORIZATION_REQUIRED`。
- 非 JSON 请求返回 `415 CONTENT_TYPE_REQUIRED`。
- Electron 可以解密新的桌面凭据，且该凭据调用生产 `/v1/desktop/calls/current` 返回 200。
- 正式 Cyrene 设置界面重新加载后显示“桌面已授权”“可以配对新手机”，配对按钮已启用。
- `wrangler secret list` 只显示 5 个名称和 `secret_text` 类型。
- 当前部署由 Secret Change 产生，100% 流量指向版本
  `d3654551-08bb-46dd-b3a9-2baffb0d4770`。
- 本地主进程 TypeScript 构建通过。
- Cloudflare/HTTP/LiveKit/媒体信封相关 5 个测试文件共 14 项通过。

## 尚未声称通过

- 新 Durable Object 是空白控制面，旧手机的 CloudBase Device Credential 不会在 Cloudflare 上生效；手机必须重新扫码配对。
- 尚未执行真实手机经 VPN 的配对和一键呼叫。
- 尚未在 Cloudflare 生产运行时走完整的 LiveKit token + AES-256-GCM 媒体信封发放路径；Wrangler 已成功打包这些依赖，但最终证据必须来自一次真实双端通话。
- Cloudflare 只承载控制面。LiveKit WebSocket、UDP/TURN 与 E2EE 媒体链路必须独立验证。

## safeStorage 迁移缺陷与修复

首次迁移助手以默认 Electron 应用名运行，因而使用 macOS 钥匙串中的
`Electron Safe Storage`；正式 Cyrene 使用 `live2d-cyrene Safe Storage`。
这导致助手自己的验证形成假阳性，而正式设置界面稳定显示“本机凭据损坏”。

修复后，写入助手和验证助手共同调用
`scripts/cyrene-safe-storage-context.cjs`，在任何 `safeStorage` 操作前固定
应用名为 `live2d-cyrene`。实际缺陷的反馈循环为：

```text
npm run validate:cloudflare-device-authorization
```

- 修复前：退出码 1，`Error while decrypting the ciphertext provided to safeStorage.decryptString.`
- 修复后：退出码 0，`encryptedVaultReadable: true` 且 `deviceCredentialAccepted: true`。
- 原设置窗口完整重新加载后，真实 UI 也由“本机凭据损坏”变为“桌面已授权”。

此次恢复轮换产生的最新 Owner Recovery Key 已覆盖保存到同一个 Cloudflare
钥匙串服务并再次确认。错误上下文产生的凭据不再使用；没有在日志中输出其明文。

## Electron 代理超时缺陷与修复

正式桌面首次点击“配对新手机”时，IPC 返回
`TimeoutError: The operation was aborted due to timeout`。同一个 Electron
进程、同一个 `/healthz` 地址的差分探针得到：

- Node 全局 `fetch`：10002 ms 后 `TimeoutError`；
- `electron.net.fetch`：479 ms 返回
  `200 {"status":"ok"}`。

根因是 Node 全局 `fetch` 没有使用当前 macOS/Chromium 代理路径，而
`electron.net.fetch` 使用 Electron 会话网络栈。修复将
`DesktopAuthorizationRequest` 改为可注入 fetch transport，并在正式 main
组合根注入 `net.fetch`；Node transport 只保留为厂商无关测试/非 Electron
调用方式。

修复后的实际路径验证使用正式加密 vault、
`DesktopDeviceAuthorizationClient.beginMobilePairing()` 和 `net.fetch`，
成功在生产 Durable Object 创建了两分钟 Pairing Challenge；验证输出不包含
二维码、备用短码、邀请或 Device Credential。

## 手工验收

1. 桌面端保持可访问 Cloudflare 的代理/VPN，重启 Cyrene。
2. 在设备授权设置中生成新的手机配对二维码。
3. 手机开启 VPN，扫描二维码，核对六位码并在桌面批准。
4. 关闭并重新打开手机应用，确认配对仍在。
5. 发起一次真实呼叫，确认桌面接听、双方媒体连通且 E2EE 未降级。

成功反馈格式：

`Cloudflare 配对：通过/失败；重启保持：通过/失败；真实通话：通过/失败；手机网络：运营商或 Wi-Fi；错误码：无/具体值`
