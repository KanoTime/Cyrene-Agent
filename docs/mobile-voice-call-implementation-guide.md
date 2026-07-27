# Cyrene 移动端语音通话实现与从零构建指南

> 维护日期：2026-07-27
> 适用版本：Cyrene Voice `1.0.12`（Android `versionCode 13`）及同日桌面端代码
> 目标读者：接手维护、重新部署、从零复现或升级这条语音链路的开发者
> 安全说明：本文只记录变量名和示例值，不记录生产域名、Owner/设备标识或任何真实凭据

## 1. 当前支持什么

当前版本面向“一个 Owner、少量已授权设备、同一时间一通电话”的个人场景：

- Android 手机与桌面长期配对，桌面必须明确批准；
- 手机可通过公网控制面发起一对一前台语音通话；
- 桌面在线时接听并执行本地 ASR → 模型 → 当前角色 TTS；
- 整通电话锁定接通时的 Active Character；
- LiveKit 承载双向媒体，音频媒体帧强制 E2EE；
- LiveKit 控制/事件 data packet 使用每通密钥派生的双向 XChaCha20-Poly1305 应用层加密；
- 控制面使用 Cloudflare Worker + 单个 SQLite-backed Durable Object；
- 手机长期凭据进入 SecureStore；LiveKit token 和每通 E2EE key 只短时驻留内存；
- 网络短暂中断时尝试重连，最终以 HTTPS 权威状态收敛；
- 桌面角色语音以 48 kHz、单声道、20 ms 帧发布。用户实测音色与桌面一致且无沙声；
- 手机可创建、重命名和分页选择当前角色的语音对话；正文只保存在桌面角色状态目录，退出应用后重新呼叫仍可续聊；
- 安静环境可免手动自动分轮；嘈杂或有人声干扰时可切换手动轮次，只有点击开始后音频才进入 ASR；
- 移动通话页复用桌面端的深紫背景、当前角色身份、通话计时、状态波形、字幕和圆形挂断视觉；内置昔涟头像只由稳定 `characterId=cyrene` 选择，其他角色在没有安全头像资源时使用中性首字占位，避免用可重复显示名错配角色资源；
- 相同 application ID 和签名的 APK 可覆盖安装并保留配对。

当前不支持后台来电、系统电话界面、推送唤醒、视频、群聊、多 Owner、多桌面排队或桌面离线云端 Agent。iOS 工程具备基础配置，但本轮生产验收对象是 Android。

## 2. 架构与数据边界

```text
┌──────────────── Android：Cyrene Voice ────────────────┐
│ 扫码配对 / SecureStore / 通话状态 / 麦克风 / 扬声器   │
└──────────────┬───────────────────────┬────────────────┘
               │ HTTPS 控制面          │ WebRTC + 媒体 E2EE
               ▼                       ▼
┌──────────────────────────┐   ┌───────────────────────┐
│ Cloudflare Worker        │   │ LiveKit Room          │
│ + Durable Object         │   │ 只承载实时媒体与信令  │
│ 配对/状态/短时授权       │   └───────────▲───────────┘
└──────────────┬───────────┘               │
               │ 权威状态轮询              │
               ▼                           │
┌──────────────── Desktop Cyrene Agent ────┴───────────┐
│ 配对审批 / rtc-node / VAD / ASR / LLM / 角色 / TTS  │
└───────────────────────────────────────────────────────┘
```

关键边界：

1. Cloudflare 不转发媒体，也不接触 ASR 文本、模型提示、记忆或 TTS 音频。
2. LiveKit API Secret 和媒体信封主密钥只存在于 Worker Secret。
3. LiveKit token 只授权一次随机房间，不能替代长期设备授权。
4. E2EE key 每通生成，通过 endpoint-scoped AES-GCM 短时信封交付，不写数据库明文、二维码、URL 或 SecureStore。
5. LiveKit data packet 只作低延迟控制与必要目录元数据；通话权威状态始终来自 HTTPS 控制面。
6. 当前锁定 SDK 使用 legacy `e2ee` 配置且原生 `dataChannelEncryption=false`。应用层另以 HKDF-SHA-256 从本次通话 key 派生两把方向密钥，并用 XChaCha20-Poly1305 加密 data packet；媒体帧 E2EE 与应用层数据加密是两个独立门禁。
7. 语音历史正文、ASR/模型文本和角色记忆不进入 Cloudflare，也不在手机形成权威副本；手机只取得每页最多 12 条的名称、摘要、轮数和时间。

平台能力、设计依据和官方资料见[一手资料研究](./research/mobile-voice-call-from-zero-primary-sources-2026-07-27.md)；不可逆决策见 `docs/adr/0027` 至 `docs/adr/0041`。

## 3. 代码地图

### 3.1 跨平台领域与控制面协议

| 路径 | 职责 |
|---|---|
| `src/main/remote-access/device-authorization.ts` | Owner、设备、挑战、凭据族、通话的纯领域状态机 |
| `src/main/remote-access/persistent-device-authorization.ts` | 状态机与持久化适配器组合 |
| `src/main/remote-access/device-authorization-http.ts` | `/v1/*` HTTP 路由、鉴权、输入输出边界 |
| `src/main/remote-access/media-grant-envelope.ts` | 短时媒体授权的 AES-GCM 信封 |
| `src/main/remote-access/livekit-media-grant-service.ts` | 为手机/桌面签发最小权限 LiveKit token 与每通 E2EE 材料 |
| `src/main/remote-access/cloudflare-device-authorization-store.ts` | Durable Object Storage 适配器 |
| `src/main/remote-access/cloudbase-*` | 旧 CloudBase 兼容/迁移实现，不是当前生产入口 |

### 3.2 Cloudflare 控制面

| 路径 | 职责 |
|---|---|
| `cloudflare/device-authorization/index.ts` | Worker、Durable Object 和生产 Secret 注入 |
| `cloudflare/wrangler.jsonc` | Worker 名称、DO binding、SQLite storage 和兼容配置 |
| `scripts/deploy-cloudflare-device-authorization.mjs` | 当前个人环境的安全部署自动化 |
| `scripts/bootstrap-cloudflare-control-plane.mjs` | 当前个人环境的 Owner bootstrap/recovery 和桌面凭据保存 |
| `scripts/save-cloudflare-desktop-credential.cjs` | 通过 Electron safeStorage 保存桌面长期凭据 |

部署/引导脚本包含当前个人环境的 Keychain service 命名和默认 origin，适合本机重复部署；从零复现者应使用本文第 6 节的通用命令，或先把这些常量改成自己的显式配置。

### 3.3 桌面端编排

| 路径 | 职责 |
|---|---|
| `src/main/remote-access/desktop-device-authorization-client.ts` | 桌面控制面客户端、签名请求和长期凭据使用 |
| `src/main/remote-access/desktop-device-credential-vault.ts` | Electron safeStorage 凭据保险库 |
| `src/main/remote-access/device-pairing-ipc.ts` | 设置页配对/恢复 IPC |
| `src/main/remote-access/desktop-availability-coordinator.ts` | 桌面在线心跳 |
| `src/main/remote-access/desktop-remote-call-coordinator.ts` | 发现呼叫、确认、领取媒体授权、结束与收敛 |
| `src/main/mobile-call/livekit-voice-bridge.ts` | rtc-node 入会、E2EE、手机 PCM 订阅、角色音频发布 |
| `src/main/mobile-call/call-data-cipher.ts` | LiveKit data packet 的 HKDF 方向密钥与 XChaCha20-Poly1305 信封 |
| `src/main/mobile-call/audio-turn-gate.ts` | 自动模式的预录/VAD 门控与手动轮次开关 |
| `src/main/mobile-call/pcm-wav.ts` | WAV 校验、单声道转换、SoX 高质量重采样至 48 kHz |
| `src/main/mobile-call/media-ready-retry.ts` | E2EE/媒体就绪确认的有界重试 |
| `src/main/call/voice-session.ts` | 平台无关的 ASR → Agent → TTS 单轮生命周期 |
| `src/main/call/voice-conversation-store.ts` | 当前角色的命名语音历史与原子 JSON 持久化 |
| `src/main/call/voice-conversation-runtime.ts` | 每通电话的选择状态和最近 24 轮模型上下文恢复 |
| `src/main/call/call-manager.ts` | 桌面窗口和移动桥接入 `VoiceSession`，校验当前角色语音配置 |
| `src/shared/mobile-call-control.ts` | 跨端控制命令、目录事件、分页与输入模式协议 |
| `src/shared/voice-conversation.ts` | Voice Conversation 领域类型 |
| `src/main/index.ts` | 启动装配、设置、IPC 与协调器生命周期 |
| `src/preload/index.ts`、`src/renderer/settings/*` | 安全暴露配对能力及设置页 UI |

### 3.4 Android 客户端

| 路径 | 职责 |
|---|---|
| `mobile/App.tsx` | 配对、呼叫、静音、挂断、LiveKit 事件和 UI 状态编排 |
| `mobile/src/call-presentation.ts` | 纯函数归约通话阶段、桌面同款文案、颜色和动效语义 |
| `mobile/src/mobile-call-screen.tsx` | 通话页视觉、真实头像/安全 fallback、计时、波形、紧凑布局与减少动态效果适配 |
| `mobile/src/voice-conversation-picker.tsx` | 新建、重命名、分页浏览和选择语音历史 |
| `mobile/src/call-control-protocol.ts` | 手机端严格解析的对话与轮次协议 |
| `mobile/src/call-data-cipher.ts` | 与桌面对等的应用层加密信封 |
| `mobile/index.ts` | 在加载 App 前注册 LiveKit WebRTC globals |
| `mobile/src/device-pairing.ts` | challenge claim/outcome 与长期设备授权落盘 |
| `mobile/src/device-authorization-store.ts` | SecureStore 读写与迁移 |
| `mobile/src/entry-link.ts` | 只允许长期配对入口，明确拒绝旧无 E2EE 直连链接 |
| `mobile/src/control-plane-origin.ts` | 必须显式提供控制面 origin；缺失时 fail-closed |
| `mobile/src/remote-call.ts` | 发起/读取/结束呼叫，领取授权和媒体就绪 |
| `mobile/src/remote-call-parser.ts` | 解析权威呼叫状态并保留稳定 Character ID |
| `mobile/src/remote-call-state-monitor.ts` | 权威状态轮询与终态收敛 |
| `mobile/App.tsx` 的 `EncryptedCallRoom` | LiveKit Room、音频会话、轨道订阅和 E2EE |
| `mobile/src/call-credentials.ts` | 已停用旧直连协议的遗留解析器，仅供迁移辨识，不是生产入口 |
| `mobile/src/call-transport-state.ts` | 连接/重连/E2EE 就绪的本地状态归约 |
| `mobile/src/e2ee-key-material.ts` | 解包并注入短时 E2EE key |
| `mobile/src/e2ee-session-readiness.ts` | 入会前启用 E2EE，并观察双方加密音频 publication |
| `mobile/src/media-grant-readiness.ts` | 等待控制面发放一次性媒体授权 |
| `mobile/src/media-ready-retry.ts` | 向控制面有界重试 E2EE/媒体就绪确认 |
| `mobile/src/unexpected-disconnect-recovery.ts` | 意外断线恢复策略 |
| `mobile/app.json`、`mobile/eas.json` | application ID、权限、原生插件和 APK 构建 profile |

## 4. 关键运行时流程

### 4.1 长期配对

1. 桌面用已有设备凭据请求 `pairing/begin`，生成两分钟 challenge、二维码/短码和本地校验信息。
2. 手机扫码，只能 claim challenge，不能自行批准。
3. 控制面向两端提供同一六位校验码。
4. 用户在桌面确认设备名称和校验码后 approve。
5. 手机轮询 outcome，领取自己的独立 device credential 并写入 SecureStore。
6. 当前 credential 按设备独立，控制面只保存哈希；截至本文版本，它是未自动轮换的长期 bearer credential。

灾难恢复会撤销旧桌面并轮换 Owner Recovery Key，因此只能在所有已授权桌面都不可用时使用。

自动 credential 轮换、15 分钟 Access Token、Replay 自动撤销与设备撤销 UI 仍是规划能力，见标记为“规划中”的 ADR 0032。当前版本不要把它们写入安全承诺。

### 4.2 一次通话

```text
手机 request
  → AWAITING_DESKTOP
桌面轮询 current + confirm
  → CONNECTING_MEDIA
双方各自领取一次性 media grant
  → 设置 E2EE key → 加入同一 LiveKit room
双方上报 media-ready
  → ACTIVE
网络波动
  → RECONNECTING → ACTIVE 或 ENDED
任一方挂断/超时/撤销/E2EE 错误
  → ENDED（不可逆）
```

同一 Owner 只允许一通活动呼叫。请求、确认、就绪和结束均设计为幂等；移动端页面状态不能凌驾于控制面终态。

### 4.3 音频链

上行：

```text
Android 麦克风 → WebRTC/Opus → rtc-node AudioStream
→ PCM16 单声道 → Voice Turn Gate → ASR → 模型
```

下行：

```text
角色 TTS（优先 PCM16 WAV）
→ WAV 解码/多声道转单声道
→ SoX VERY_HIGH 重采样到 48 kHz
→ 20 ms / 960 samples AudioFrame
→ LiveKit/Opus → Android 扬声器
```

不能把 16 kHz TTS 样本直接当 48 kHz 发布；这正是早期移动端“糊、沙声、音色失真”的主要来源。也不要把 Android 切到只播放用途的 `MediaAudioType`，本应用同时发布麦克风，需要保留通信模式的回声消除和音频路由。

### 4.4 语音历史与嘈杂环境

建立加密媒体后，手机先显示当前 Character ID 的 Voice Conversation Catalog，选择完成前桌面丢弃所有 PCM：

```text
手机选择/创建命名对话
  → 加密 control packet
桌面绑定该 Voice Conversation
  → 从角色状态目录恢复最近 24 轮给模型
  → 开放音频门控
每次有效回答
  → 桌面原子追加 user/assistant Turn
  → 只把更新后的摘要元数据发给手机
```

Catalog 每页 12 条，完整正文不会经过 LiveKit data packet。手机退出或通话结束不删除桌面历史；下次呼叫重新选择同一名称即可续聊。切换角色后只看到新角色自己的目录。

自动模式保留约 200 ms 预录音频，要求连续至少 200 ms 的有效启动信号才让声音进入 ASR，并按静默结束本轮。它能过滤碰撞、风声等短促噪声，但无法可靠判断背景人声是不是 Owner。旁人较多时切到手动模式：点击“开始说话”才开放门控，完成后点击“提交本轮”；这与静音按钮不同。

## 5. 软件依赖与前置条件

### 5.1 必需账号/服务

- 一个 Cloudflare 账号及 Workers 权限；
- 一个 LiveKit Cloud 项目，或可公网访问的自托管 LiveKit；
- Expo/EAS 账号（需要云端签名 APK 时）；
- Android 真机；中国大陆网络环境下通常需要手机能稳定访问 Cloudflare、LiveKit 与 Expo 下载地址。

### 5.2 本地工具

- Node.js `>=24 <25`；
- npm；
- macOS 上的 Electron safeStorage/Keychain；
- Android Studio、Android SDK Platform-Tools、Build-Tools、Command-line Tools；
- Android Studio 自带 JBR，或兼容 Gradle 的 JDK；
- Cloudflare Wrangler（已在根依赖中）；
- 桌面端实际使用的 ASR、模型与 TTS 运行时。

精确 JS 版本以根目录和 `mobile/` 的两个 `package-lock.json` 为准。重要锁定版本包括：

- 桌面 `@livekit/rtc-node 0.13.31`、`livekit-server-sdk 2.17.0`；
- 移动 `Expo 56.0.16`、`React Native 0.85.3`；
- `@livekit/react-native 2.11.1`、`react-native-webrtc 144.1.1`、`livekit-client 2.20.2`；
- `expo-secure-store 56.0.4`、`expo-camera 56.0.8`；
- 双端锁定 `@noble/ciphers 1.3.0`、`@noble/hashes 1.8.0`，用于 data packet 的 XChaCha20-Poly1305 与 HKDF；
- 通话视觉使用 `expo-linear-gradient 56.0.4`、`@expo/vector-icons 15.1.1`，并显式锁定 SDK 56 的 `expo-font 56.0.7`，防止重复原生模块。

不要单独升级其中一个 LiveKit/React Native 包；它们是需要一起构建和真人回归的兼容组。

## 6. 从零构建

### 6.1 安装与基础检查

```bash
git clone <你的私仓地址>
cd Cyrene-Agent
npm ci
npm run build

cd mobile
npm ci
npm run android:check
npm run typecheck
cd ..
```

移动端包含原生 WebRTC 模块，不能用 Expo Go 验收。开发机连接 Android 真机后可执行：

```bash
cd mobile
npm run android
```

### 6.2 创建 LiveKit 项目

在 LiveKit Cloud 创建项目或部署自托管服务，取得：

- `wss://...` Server URL；
- API Key；
- API Secret。

API Secret 绝不能放入 APK、二维码或 Git。客户端参与者 token 只能由 Worker 使用 Secret 临时签发。

### 6.3 创建 Cloudflare Worker 与 Durable Object

先登录并做本地 dry-run：

```bash
npx wrangler login
npm run build:cloudflare-device-authorization
```

生成以下随机材料；不要把输出贴到聊天或提交 Git：

```bash
node -e "const c=require('node:crypto'); console.log('bootstrap:', 'cy_db_'+c.randomBytes(32).toString('base64url')); console.log('media-master:', c.randomBytes(32).toString('base64url'))"
```

将 bootstrap code 做 SHA-256 base64url 后，只把哈希上传为 Secret；其余上传原值。通用流程：

```bash
npx wrangler secret put CYRENE_DEPLOYMENT_BOOTSTRAP_CODE_HASH --config cloudflare/wrangler.jsonc
npx wrangler secret put CYRENE_LIVEKIT_SERVER_URL --config cloudflare/wrangler.jsonc
npx wrangler secret put CYRENE_LIVEKIT_API_KEY --config cloudflare/wrangler.jsonc
npx wrangler secret put CYRENE_LIVEKIT_API_SECRET --config cloudflare/wrangler.jsonc
npx wrangler secret put CYRENE_MEDIA_ENVELOPE_MASTER_KEY --config cloudflare/wrangler.jsonc
npx wrangler deploy --config cloudflare/wrangler.jsonc
```

生产环境还应设置 `CYRENE_CONTROL_PLANE_PUBLIC_ORIGIN`，确保二维码和恢复绑定使用显式 HTTPS origin。检查：

```bash
curl --fail --silent --show-error https://<你的-worker-origin>/healthz
```

预期返回健康响应。禁止把 Secret 写进 `wrangler.jsonc` 的 `vars`。

### 6.4 Owner bootstrap 与首台桌面

本仓安全脚本会调用 bootstrap/confirm、把 desktop credential 写入 Electron safeStorage，并把 Recovery Key 写入 macOS Keychain。以下命令可直接用于新的 macOS 部署；所有示例值都要替换：

```bash
cd Cyrene-Agent

export CYRENE_KEYCHAIN_NAMESPACE="my-cyrene-production"
export CYRENE_CONTROL_PLANE_ORIGIN="https://<你的-worker-origin>"
export CYRENE_DESKTOP_LABEL="我的 Mac"

export CYRENE_DEPLOYMENT_BOOTSTRAP_KEYCHAIN_SERVICE="Cyrene Deployment Bootstrap Code - $CYRENE_KEYCHAIN_NAMESPACE"
export CYRENE_LIVEKIT_SERVER_URL_KEYCHAIN_SERVICE="Cyrene LiveKit Server URL - $CYRENE_KEYCHAIN_NAMESPACE"
export CYRENE_LIVEKIT_API_KEY_KEYCHAIN_SERVICE="Cyrene LiveKit API Key - $CYRENE_KEYCHAIN_NAMESPACE"
export CYRENE_LIVEKIT_API_SECRET_KEYCHAIN_SERVICE="Cyrene LiveKit API Secret - $CYRENE_KEYCHAIN_NAMESPACE"
export CYRENE_MEDIA_ENVELOPE_MASTER_KEY_KEYCHAIN_SERVICE="Cyrene Media Envelope Master Key - $CYRENE_KEYCHAIN_NAMESPACE"
export CYRENE_OWNER_RECOVERY_KEYCHAIN_SERVICE="Cyrene Owner Recovery Key - $CYRENE_KEYCHAIN_NAMESPACE"
```

将五个真实值安全写入 Keychain。下面的 `read -s` 不回显输入；变量不会写入 Git：

```bash
read -s "BOOTSTRAP_CODE?Deployment bootstrap code: "; echo
security add-generic-password -U -a "$USER" -s "$CYRENE_DEPLOYMENT_BOOTSTRAP_KEYCHAIN_SERVICE" -w "$BOOTSTRAP_CODE"
unset BOOTSTRAP_CODE

read -s "LIVEKIT_URL?LiveKit wss URL: "; echo
security add-generic-password -U -a "$USER" -s "$CYRENE_LIVEKIT_SERVER_URL_KEYCHAIN_SERVICE" -w "$LIVEKIT_URL"
unset LIVEKIT_URL

read -s "LIVEKIT_KEY?LiveKit API Key: "; echo
security add-generic-password -U -a "$USER" -s "$CYRENE_LIVEKIT_API_KEY_KEYCHAIN_SERVICE" -w "$LIVEKIT_KEY"
unset LIVEKIT_KEY

read -s "LIVEKIT_SECRET?LiveKit API Secret: "; echo
security add-generic-password -U -a "$USER" -s "$CYRENE_LIVEKIT_API_SECRET_KEYCHAIN_SERVICE" -w "$LIVEKIT_SECRET"
unset LIVEKIT_SECRET

read -s "MEDIA_MASTER?Media envelope master key: "; echo
security add-generic-password -U -a "$USER" -s "$CYRENE_MEDIA_ENVELOPE_MASTER_KEY_KEYCHAIN_SERVICE" -w "$MEDIA_MASTER"
unset MEDIA_MASTER
```

部署并 bootstrap：

```bash
npm run deploy:cloudflare-device-authorization:secure
curl --fail --silent --show-error "$CYRENE_CONTROL_PLANE_ORIGIN/healthz"
npm run bootstrap:cloudflare-device-authorization
```

预期：

- 部署命令输出 `status: "DEPLOYED"`，且 `secretPlaintextPrinted: false`；
- 健康检查成功；
- bootstrap 输出 `status: "BOOTSTRAPPED"`、`recoveryKeyConfirmed: true`、`desktopCredentialSaved: true`；
- Keychain 中出现 `$CYRENE_OWNER_RECOVERY_KEYCHAIN_SERVICE`。

立即把 Owner Recovery Key 另存到离线密码库。不要把它写进终端日志、截图或 Git。脚本依赖 macOS `security` 和 Electron safeStorage；Windows/Linux 维护者需实现等价系统安全存储适配器，不能退回明文文件。

若控制面已经存在 Owner，普通 bootstrap 会以 `OWNER_ALREADY_BOOTSTRAPPED_RECOVERY_REQUIRES_EXPLICIT_OPT_IN` 安全停止，不会自动撤销旧桌面。只有确认所有旧桌面都已不可用、确实要执行灾难恢复时，才运行：

```bash
CYRENE_ALLOW_OWNER_RECOVERY=1 npm run bootstrap:cloudflare-device-authorization
```

成功后旧桌面授权会被撤销，Recovery Key 会被轮换；必须重新保存新的离线 Recovery Key，并重新审查已配对手机。

### 6.5 配置桌面语音 Agent

在桌面设置中完成：

1. 模型 provider、Base URL、模型名和 API Key；
2. 本地或云端 ASR；
3. Active Character；
4. 与角色 Voice Profile 匹配的 TTS Service；
5. GPT-SoVITS/自定义 TTS 用于手机时输出 `wav`。

桌面无法完成其中任一项时应在创建房间前报错，不能让手机先接通后卡住。

### 6.6 构建 Android APK

开发构建：

```bash
cd mobile
npm ci
npm run android:check
npm run android
```

内部发行 APK：

```bash
cd mobile
npx eas-cli@latest login
npx eas-cli@latest whoami
npx eas-cli@latest build --platform android --profile preview
```

仓库当前 `mobile/app.json` 绑定的是现有私人 EAS project。只有该项目成员能直接执行上面的构建。用新 Expo 账号从零创建时：

1. 先为 Android 选择自己的唯一 package；如果要覆盖安装既有 Cyrene Voice，则必须保留 `com.cyrene.agent.voice` 且持有同一 keystore。
2. 删除或替换 `expo.extra.eas.projectId` 的旧值。
3. 执行 `npx eas-cli@latest init`，选择当前账号下的新项目，并确认生成的新 `projectId` 已写回 `app.json`。
4. 执行 `npx eas-cli@latest project:info`，确认 owner/slug/projectId 属于当前账号。
5. 再执行 preview build；首次构建按提示创建或导入 Android keystore。

发布新版本时同时递增 `mobile/app.json` 的 `version` 和 Android `versionCode`。要保留已有配对，必须保持：

- package：`com.cyrene.agent.voice`；
- 同一 release keystore；
- 覆盖安装，不能先卸载。

Keystore 与密码必须在 Git 外备份。

## 7. 控制面 API 概览

| 路由 | 调用方 | 作用 |
|---|---|---|
| `POST /v1/owner/bootstrap` | 新 Owner | 建立 Owner 与首台桌面 |
| `POST /v1/owner/recovery-key/confirm` | 桌面 | 确认 Recovery Key 已安全保存 |
| `POST /v1/owner/recover` | 恢复桌面 | 灾难恢复并撤销旧桌面 |
| `POST /v1/desktop/availability` | 桌面 | 上报在线与可接听状态 |
| `POST /v1/pairing/begin` | 桌面 | 创建短时配对挑战 |
| `POST /v1/pairing/claim` | 手机 | 领取挑战，尚未授权 |
| `POST /v1/pairing/review` | 桌面 | 查看待批准设备与校验码 |
| `POST /v1/pairing/decide` | 桌面 | 批准或拒绝 |
| `POST /v1/pairing/outcome` | 手机 | 领取批准结果与设备凭据 |
| `POST /v1/calls/request` | 手机 | 幂等发起呼叫 |
| `POST /v1/desktop/calls/current` | 桌面 | 发现当前呼叫 |
| `POST /v1/desktop/calls/confirm` | 桌面 | 接听并进入媒体连接 |
| `POST /v1/calls/media-grant` | 双方 | 各自单次领取短时媒体授权 |
| `POST /v1/calls/media-ready` | 双方 | 上报本端 E2EE/媒体就绪 |
| `POST /v1/calls/status` | 手机 | 读取权威通话状态 |
| `POST /v1/calls/end` | 双方 | 幂等结束通话 |

除健康检查外，生产响应应使用 `no-store`。当前鉴权、签名和错误码以 `device-authorization-http.ts` 为唯一事实来源；credential 轮换尚未实现。

## 8. 验证与发布门禁

### 8.1 自动验证

```bash
npm run build:main -- --noEmit
npm run build:preload -- --noEmit
npm run build:renderer

cd mobile
npm run typecheck
cd ..

npx vitest run \
  src/main/call/call-manager.test.ts \
  src/main/call/voice-session.test.ts \
  src/main/character/character-speech.test.ts \
  src/main/mobile-call/*.test.ts \
  src/main/remote-access/*.test.ts \
  cloudflare/device-authorization/index.test.ts \
  mobile/src/entry-link.test.ts \
  mobile/src/remote-call-state-monitor.test.ts \
  mobile/src/remote-call.test.ts \
  mobile/src/unexpected-disconnect-recovery.test.ts
```

安全检查至少确认：

```bash
git grep -nE '(LIVEKIT_API_SECRET|MEDIA_ENVELOPE_MASTER_KEY|cy_dc_|cy_rk_)' -- ':!*.test.ts' ':!docs/**'
git diff --check
```

命中变量名是正常的；命中看似真实的值必须人工阻断发布。

### 8.2 真人 Android 验收

发布前必须用最终 APK 和最终桌面构建完成：

1. 覆盖安装，不卸载旧版；
2. 验证已有配对仍有效；
3. 保持手机 VPN（如网络需要）和桌面在线；
4. 连续对话至少 5 轮且持续超过 60 秒；
5. 每轮都验证：手机问题被识别、角色正确、语音完整、回答后恢复聆听；
6. 验证静音、主动挂断；
7. 短暂切换网络，验证重连或明确终止，不出现永久假连接；
8. 试听无沙声、无明显失真，音色与桌面 TTS 一致。
9. 新建一个自定义名称的语音对话并完成两轮，挂断并彻底退出手机应用；
10. 重新呼叫，选择同一历史并询问上一轮内容，确认角色能继续上下文；
11. 切换手动模式，未点击“开始说话”时用旁人语音测试不触发 ASR；点击后说话并提交，确认正常回答；
12. 篡改/明文 data packet 只在自动测试中验证，真机链路不得提供明文降级入口。

自动测试不能替代第 8 项听感证据。

## 9. 依赖升级与主仓合并保护项

合并或升级后必须确认：

- `src/main/index.ts` 同时保留移动通话装配和主仓新增设置字段；
- `src/preload/index.ts` / `src/shared/ipc-channels.ts` 没有丢失配对 IPC；
- `src/renderer/settings/*` 仍能完成 bootstrap、配对、审批和恢复；
- `package.json` 同时保留桌面 LiveKit 与主仓新依赖；
- `TtsEngine` 新增值时，角色 Voice Profile 白名单、全局设置和通话格式策略同步；
- E2EE 必须 fail-closed，不能因事件乱序退回未加密媒体；
- data packet 必须保持 HKDF 双向密钥、XChaCha20-Poly1305、15 KiB 上限和每页 12 条目录，不得回退明文或传输完整历史；
- `voice-conversations` 必须位于当前 Character State Root，角色切换时不得共用目录；
- 48 kHz、SoX `VERY_HIGH`、20 ms/960 samples 不被改回低质量路径；
- `controlPlaneOrigin` 缺失时必须报 `CONTROL_PLANE_ORIGIN_REQUIRED`，不能静默回退到某个个人旧地址；
- CloudBase 文件只能作为兼容实现，不能重新成为默认生产入口。

## 10. 凭据轮换、撤销与恢复

### LiveKit 服务端凭据

1. 在 LiveKit 创建新 API Key/Secret；
2. 更新 Worker Secrets；
3. 部署并完成新通话冒烟；
4. 确认旧通话自然结束或已终止；
5. 撤销旧 LiveKit 凭据。

### 媒体信封主密钥

当前信封短时有效。轮换时先停止创建新通话，等待旧信封全部过期，更新 Worker Secret、部署、执行一通完整 E2EE 冒烟，再恢复服务。不要在仍需解包旧信封时直接丢弃旧密钥。

### 手机撤销

当前版本尚未提供公开的设备撤销 HTTP 路由或设置页入口。需要设备级撤销、自动凭据轮换和 Replay 检测后才能对外承诺即时撤销；在此之前，丢失手机应执行 Owner 灾难恢复并重新建立可信设备，不能只删除手机本地 SecureStore。

### Owner 恢复

只在所有桌面均不可用时显式设置 `CYRENE_ALLOW_OWNER_RECOVERY=1` 执行。恢复会撤销旧桌面授权并生成新的 Recovery Key，随后应重新审查手机设备列表。

## 11. FAQ

### 为什么不继续用 CloudBase？

当前 Cloudflare 控制面不依赖 CloudBase 资源点，且 Durable Object 很适合单 Owner 的串行状态。仓库内 CloudBase 代码只用于历史兼容和迁移测试。

### 手机必须挂 VPN 吗？

协议本身不要求 VPN，但手机必须稳定访问你的 Worker 与 LiveKit。若所在网络无法直连，VPN 是当前个人场景可接受的网络前提，不是应用层安全替代品。

### 为什么桌面必须在线？

ASR、模型、记忆、角色和 TTS 都留在个人桌面。控制面不会代替桌面回答，LiveKit 也不会自动运行 Agent。

### 为什么扫码后还要桌面确认六位码？

二维码只证明手机看到了挑战，不能证明是 Owner 本人允许该设备。桌面审批和双端校验码用于阻断转发二维码或误扫。

### 配对 begin 为什么会超时？

常见原因是 Worker 首次冷启动、网络不可达、旧 CloudBase 地址或桌面 IPC 超时。先访问 `/healthz`，再确认桌面使用的是当前 Cloudflare origin；不要靠无限延长超时掩盖错误地址。

### 为什么回答后曾经自动挂断？

早期实现把 LiveKit/E2EE 事件顺序、短时媒体状态或播放完成误判为终态。当前实现由 HTTPS 状态机负责权威终态，并使用有界 media-ready 重试、播放队列和断线收敛。若复现，应记录测试时间、完成轮数、最后状态和截图。

### 为什么界面显示“正在说话”却没有声音？

可能是 TTS 卡住、输出并非可解码 WAV、采样率错误、LiveKit capture 超时或 E2EE subscription 未就绪。按日志定位 TTS → WAV 解码 → 重采样 → captureFrame → 手机订阅的第一处偏差。

### 为什么旧版手机声音糊且有沙声？

16 kHz PCM 曾被错误按 48 kHz 节奏发布，且低质量重采样/帧长不匹配会造成失真。当前统一高质量重采样到 48 kHz，并按 20 ms/960 samples 发布。

### 对话历史存在哪里？手机退出后为什么还能续聊？

权威历史按 Character ID 保存在桌面 Character State Root 的 `voice-conversations` 目录。手机不保存正文，只在每次加密通话中读取分页目录并选择一个 ID；桌面随后把该历史最近 24 轮恢复给模型。覆盖安装或手机更换不会删除桌面历史，但桌面角色状态目录损坏或被删除会丢失它。

### 自动模式为什么仍可能识别旁人？

自动门控能过滤短促噪声和部分环境底噪，却不能可靠分辨“谁在说话”。有人声干扰时使用手动模式，只有按钮打开期间的 PCM 才进入 ASR。声纹识别暂未接入，因为在当前单人项目中容易误拒绝小声、情绪化或距离变化后的 Owner 语音，投入产出比低。

### LiveKit 数据通道本身是否 E2EE？

锁定的桌面 SDK 不提供与 Android 对等的原生 data packet E2EE，因此不能直接这样宣称。当前是在应用层把每个控制/事件包用本次通话 key 派生出的方向密钥加密和认证；LiveKit 仍可看到包的大小、时间、topic 和路由，但看不到名称、摘要或命令正文。

### 为什么不切 Android MediaAudioType？

它更适合只播放的媒体应用。Cyrene 同时发布麦克风，需要通信模式的回声消除、路由和双向行为。

### 覆盖安装和卸载重装有什么区别？

同签名覆盖安装通常保留 SecureStore 配对；卸载会删除应用数据，应重新配对。不要为了升级先卸载。

### LiveKit token 到期会立即挂断吗？

token TTL 主要限制初始连接/重连授权，不是业务终止时钟。通话超时、撤销和结束由 Cyrene 控制面状态机负责。

### 可以把 Agent 整体迁到 LiveKit Agents Cloud 吗？

技术上可以重构，但会改变隐私、模型凭据、角色状态、GPT-SoVITS、本地成本与桌面在线边界。当前个人方案只复用 LiveKit 媒体层，更符合“角色能力留在桌面”的目标。

### 能直接使用 Expo Go 吗？

不能。LiveKit React Native WebRTC 需要自定义原生模块，必须使用 development build 或签名 APK。

### 如何反馈一个可排查的问题？

提供“本地时间 + 完成轮数 + 手机最后显示状态 + 是否听到完整语音 + 网络类型 + 截图”。不要发送 token、二维码原图、Recovery Key、设备 credential 或包含 Secret 的日志。

## 12. 维护者交付清单

- [ ] 代码与锁文件已提交；
- [ ] 主进程/preload/renderer/mobile 类型检查通过；
- [ ] 移动语音相关测试通过；
- [ ] Cloudflare dry-run 通过；
- [ ] Git Secret 检查无真实值；
- [ ] 最终桌面构建已启动且运行上下文明确；
- [ ] 最终 APK 覆盖安装；
- [ ] 真实 Android 五轮/60 秒通话通过；
- [ ] 自定义名称历史退出后可选择并续聊；
- [ ] 自动/手动模式切换及手动门控真机通过；
- [ ] 音色与桌面一致、无沙声；
- [ ] 分支推送、PR/合并完成；
- [ ] 交付中说明当前能力、未验收对象和用户是否还需操作。
