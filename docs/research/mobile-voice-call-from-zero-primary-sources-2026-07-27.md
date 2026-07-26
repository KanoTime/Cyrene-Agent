# Cyrene 移动端语音通话：从零构建所需一手资料研究

> 研究日期：2026-07-27
> 范围：LiveKit、Cloudflare Workers / Durable Objects、Expo / React Native Android
> 来源原则：只引用平台官方文档或官方源代码仓库
> 安全边界：本文不记录任何真实凭据、设备标识、Owner 标识、部署域名或本机私密路径

## 1. 结论摘要

Cyrene 当前的移动端语音通话不是一个可以由某个官方示例“整套接入”的普通会议 App，而是三个成熟平台能力加上一层项目专属编排：

1. **LiveKit** 提供 WebRTC 房间、移动端麦克风采集、桌面端音频订阅与发布、短期房间令牌、重连事件和媒体 E2EE 原语。
2. **Cloudflare Worker + SQLite-backed Durable Object** 提供公网 HTTPS 入口、单 Owner 权威状态的串行协调与持久化，以及生产 Secret 注入。
3. **Expo development build / EAS Build** 提供包含 LiveKit 原生 WebRTC 模块的 Android 客户端、内部发行 APK 和稳定签名升级链。
4. **Cyrene 必须自研**设备配对批准、凭据链轮换、幂等通话状态机、一次性媒体授权、E2EE 密钥交付与就绪握手、桌面 ASR/模型/TTS 编排、角色锁定、故障收敛和安全审计边界。

当前实现选择是合理的：对于单 Owner、个位数设备、一次只允许一通电话的个人场景，一个固定名称的 Durable Object 既保存权威聚合状态又串行处理状态转移，比再引入 D1、消息队列或多租户服务更直接。LiveKit 媒体不经过 Worker，Worker 只处理控制面。

当前安全缺口也必须明确：截至本文日期，设备 credential 是按设备独立、仅存哈希但不自动轮换的长期 bearer credential；15 分钟 Device Access Token、Replay 自动撤销和公开设备撤销入口仍是规划能力。下文将“轮换/撤销”列入必须自研或从零构建步骤时，描述的是目标能力，不代表当前仓库已经实现。

## 2. 研究方法与“事实”标记

本文使用两种明确标记：

- **项目事实**：来自当前仓库代码、锁文件、配置或已接受 ADR，只描述 Cyrene 当前如何实现。
- **官方能力**：来自对应平台官方文档或官方仓库，只描述平台通用能力。

两者不能混写。例如，“LiveKit 支持 E2EE”是官方能力；“Cyrene 强制所有通话在 E2EE 就绪后才进入活动状态”是项目策略，不是 LiveKit 自动提供的业务保证。

## 3. 当前技术栈与锁定版本

以下版本来自 2026-07-27 只读检查 `package.json` 与 `package-lock.json` 的结果。声明范围与实际锁定版本应同时保留；从零复现时应以锁文件为准，升级时逐组回归。

### 3.1 桌面端与控制面

| 组件 | 声明 | 锁定版本 | 用途 |
|---|---:|---:|---|
| Node.js | `>=24 <25` | 环境约束 | Electron 主进程、构建和测试 |
| `@livekit/rtc-node` | `0.13.31` | `0.13.31` | 桌面作为实时媒体参与者；订阅手机 PCM、发布角色 TTS |
| `livekit-server-sdk` | `^2.17.0` | `2.17.0` | 控制面签发房间限定的短期参与者令牌 |
| `wrangler` | `^4.114.0` | `4.114.0` | Worker / Durable Object 构建、部署和 Secret 管理 |
| Electron | `^43.0.0` | `43.1.0` | 桌面宿主与安全存储入口 |
| Vitest | `^4.1.9` | 以根锁文件为准 | 状态机、控制面、媒体桥和回归测试 |

### 3.2 移动端

| 组件 | 声明 | 锁定版本 | 用途 |
|---|---:|---:|---|
| Expo | `~56.0.16` | `56.0.16` | React Native 工程、原生配置插件和构建流程 |
| React Native | `^0.85.3` | `0.85.3` | Android/iOS 客户端 |
| `@livekit/react-native` | `^2.11.1` | `2.11.1` | Room、音频会话、React Native E2EE 管理 |
| `@livekit/react-native-webrtc` | `^144.1.1` | `144.1.1` | 原生 WebRTC 能力 |
| `livekit-client` | `^2.20.2` | `2.20.2` | Room 事件、轨道和连接状态 |
| `expo-secure-store` | `~56.0.4` | `56.0.4` | 长期配对授权的设备安全存储 |
| `expo-camera` | `~56.0.8` | `56.0.8` | 配对二维码扫描 |
| `expo-crypto` | `~56.0.4` | `56.0.4` | 移动端安装标识和随机材料 |
| `expo-dev-client` | `~56.0.23` | `56.0.23` | 包含自定义原生模块的开发构建 |

### 3.3 Cloudflare 实际形态

**项目事实：**

- 公网入口是一个 Cloudflare Worker。
- 权威状态由一个固定名称、SQLite-backed 的 Durable Object 保存和协调。
- 当前 `wrangler.jsonc` 没有 D1 binding，也没有 KV binding。
- Durable Object 内当前通过 Storage KV API 保存一个聚合文档；底层仍是该 Durable Object 私有的 SQLite 存储。
- LiveKit 服务端资料、媒体信封主密钥和部署引导材料通过 Workers Secrets 提供，配置文件只声明代码和绑定，不保存值。
- 使用 `nodejs_compat` 兼容既有 Node.js 依赖。

因此，本文提到 D1 只用于说明为什么当前没有采用它，不能把 D1 写成 Cyrene 的现有依赖。

## 4. 总体架构

```text
手机 Cyrene Voice
  ├─ HTTPS：配对、呼叫、权威状态读取、一次性媒体授权
  │            │
  │            ▼
  │     Cloudflare Worker
  │            │ 固定名称路由
  │            ▼
  │     SQLite-backed Durable Object
  │       ├─ 单 Owner 权威聚合状态
  │       ├─ 配对挑战与设备凭据哈希
  │       ├─ 幂等通话状态机
  │       └─ 短时加密媒体授权信封
  │
  └─ WebRTC/E2EE 媒体 ───────┐
                              ▼
                         LiveKit Room
                              ▲
  桌面 Cyrene Agent ──────────┘
       ├─ 接收手机麦克风 PCM
       ├─ 本地 VAD / ASR
       ├─ 本地模型与角色上下文
       ├─ 本地 TTS
       └─ 48 kHz PCM 角色语音发布
```

**项目事实：**模型密钥、ASR、角色记忆、提示词、用户说话转写和 TTS 文本/音频不进入 Cloudflare 控制面。LiveKit 媒体连接也不经过 Worker。

## 5. LiveKit：可直接复用的能力

### 5.1 React Native 实时音频客户端

LiveKit 官方 React Native SDK 已提供：

- `Room` / `LiveKitRoom` 的连接与生命周期；
- 麦克风采集、远端音频订阅和系统音频会话；
- 连接、重连、断开、轨道发布/订阅等事件；
- Expo development build 所需的官方 config plugin；
- React Native E2EE 管理器和 key provider。

官方仓库说明安装组合为 `@livekit/react-native`、`@livekit/react-native-webrtc` 与 `livekit-client`，并要求调用 `registerGlobals()`；在 Expo 中使用 development build，而不是只依赖 Expo Go：

- [LiveKit 官方 React Native SDK](https://github.com/livekit/client-sdk-react-native)
- [LiveKit React Native Expo plugin 与示例](https://github.com/livekit/client-sdk-react-native-expo-plugin/tree/main/example)

Android 双向通话应使用默认的 `CommunicationAudioType`。官方仓库明确提示 `MediaAudioType` 适合“只消费音频、不发布音频”的场景；Cyrene 手机同时发布麦克风，因此不能为了音质直接切成播放型模式而不回归麦克风、回声消除和路由。

### 5.2 桌面 Node 实时媒体参与者

LiveKit 官方文档允许后端进程作为普通房间参与者发布媒体。`AudioSource` 接收指定采样率、声道数和帧长的原始 PCM；官方示例使用 48 kHz 单声道和固定长度帧：

- [LiveKit：从后端发布音频](https://docs.livekit.io/transport/media/publish/)
- [LiveKit 官方 Node SDK 仓库](https://github.com/livekit/node-sdks)

Cyrene 可以直接复用：

- `AudioStream`：读取手机远端麦克风轨道的解码 PCM；
- `AudioSource` / `LocalAudioTrack`：发布桌面生成的角色语音；
- `RoomEvent`：观察参与者、轨道、连接与 E2EE 事件；
- `AudioResampler`：通过 LiveKit FFI 所带 SoX 重采样器完成高质量采样率转换。

当前项目采用 48 kHz、单声道、20 ms 帧，即每帧 960 samples。官方文档没有规定 Cyrene 必须使用这一组参数，但它符合 PCM 帧发布模型，也避免把 32 kHz GPT-SoVITS 输出先劣化到 16 kHz。

官方 `@livekit/rtc-node` 源码中的 `AudioResampler` 提供 `QUICK` 到 `VERY_HIGH` 的 SoX 质量档位：

- [LiveKit Node SDK：AudioResampler 源码](https://github.com/livekit/node-sdks/blob/main/packages/livekit-rtc/src/audio_resampler.ts)
- [LiveKit Node SDK：AudioSource 源码](https://github.com/livekit/node-sdks/blob/main/packages/livekit-rtc/src/audio_source.ts)

这部分应继续复用，不需要自研采样率转换 DSP。

### 5.3 服务端令牌与最小权限

LiveKit access token 是由 API Secret 签名的 JWT，包含参与者身份、房间、发布/订阅能力和权限。官方文档说明：

- token 需要在受信后端生成；
- grant 可限制房间、是否发布、是否订阅和允许发布的源；
- token 到期主要影响初次连接，并不会自动断开已经建立的连接。

来源：

- [LiveKit：Access tokens 与 grants](https://docs.livekit.io/frontends/reference/tokens-grants/)
- [LiveKit：生产鉴权流程](https://docs.livekit.io/frontends/build/authentication/)
- [LiveKit JavaScript Server SDK](https://github.com/livekit/node-sdks/tree/main/packages/livekit-server-sdk)

**项目结论：**

- API Secret 只能存在于 Worker Secret，不能打进 APK、二维码或桌面正式远程配置。
- 手机与桌面每通电话使用不同的 call-scoped identity 和 token。
- token TTL 不能替代设备撤销、活动通话终止或控制面状态机；需要显式封住后续授权并终止参与者。

### 5.4 媒体 E2EE 原语

LiveKit 官方 E2EE 指南提供外部分发 shared key、key provider、启用 E2EE 和错误事件等原语，也提供 React Native 示例：

- [LiveKit：E2EE 入门](https://docs.livekit.io/transport/encryption/start/)
- [LiveKit React Native 官方 E2EE 示例](https://github.com/livekit/client-sdk-react-native/tree/main/example)

官方示例把 key 称为“externally distributed encryption key”。这意味着 LiveKit SDK 负责使用密钥加密媒体帧，但**不替应用设计设备如何可信配对、密钥如何送达、何时算两端都已启用、失败后是否允许降级**。

LiveKit 最新官方概览还区分了新 `RoomOptions.encryption` 与兼容旧版的 `e2ee` 字段：新字段可同时覆盖媒体和数据通道；旧字段继续兼容媒体 E2EE，但不会使数据通道消息获得同一层 E2EE。信令与 API 也只有 TLS 传输加密，不属于端到端加密：

- [LiveKit：Encryption overview](https://docs.livekit.io/transport/encryption/)

**项目当前兼容边界：**锁定的 React Native `2.11.1` 与 `rtc-node 0.13.31` 为保持跨端兼容，移动端仍使用 legacy `e2ee` room option，并明确关闭 data channel encryption；当前安全声明只覆盖音频媒体帧。LiveKit data packet 仅用于不含秘密和业务正文的低延迟提示，权威状态仍通过 HTTPS 读取。不能把最新版通用文档的“数据通道也 E2EE”直接冒充当前项目事实，也不能在没有跨端真机回归的情况下机械替换初始化方式。

Cyrene 因而必须自研：

- 每通电话独立 E2EE key 的生成与生命周期；
- 手机、桌面分离的一次性领取；
- key 与 call、endpoint、有效期的绑定；
- 两端在接通前启用 E2EE；
- 已发布和已订阅轨道的加密状态核验；
- 失败立即终止且禁止明文降级；
- 结束、撤销和超时后的内存/信封清除；
- 跨 SDK 的 E2EE 就绪握手及兼容性回归。

如果未来需要每参与者独立密钥、复杂轮换或 MLS 一类协议，LiveKit 官方文档要求使用自定义 key provider；这不属于当前个人 V1 的必要复杂度。

## 6. Cloudflare：可直接复用的能力

### 6.1 Worker 公网 HTTPS 入口

Worker 适合承载轻量 HTTPS API、读取 Secret，并把 `/v1/*` 请求路由到 Durable Object。当前控制面复用了项目原有厂商无关 HTTP handler，只新增 Cloudflare 请求和存储适配层。

Worker 不应承载音频中继：它既不是当前 LiveKit 媒体路径，也不应收到模型或语音内容。

### 6.2 SQLite-backed Durable Object

Cloudflare 官方说明 Durable Object 将计算与私有持久存储绑定到一个全局唯一对象，适合多个客户端共享状态和协调；SQLite-backed storage 是强一致、事务化存储，并可继续使用 Storage KV API：

- [Cloudflare Durable Objects 概览](https://developers.cloudflare.com/durable-objects/)
- [Cloudflare：Durable Objects 设计规则](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
- [SQLite-backed Durable Object Storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Durable Objects 快速开始](https://developers.cloudflare.com/durable-objects/get-started/)

**项目事实：**

- 单 Owner 所有设备与唯一活动通话被建模为一个聚合；
- 所有 `/v1/*` 请求路由到同一个固定名称对象；
- 一个对象内完成并发呼叫竞争、幂等重放、撤销和状态转移；
- 当前通过 `get()` / `put()` 保存聚合文档，仍由 SQLite-backed DO 提供强一致存储。

这正好利用了 Durable Object 的协调语义，不需要另外发明分布式锁。

### 6.3 为什么当前不使用 D1

Cloudflare 官方将 D1 定位为 serverless SQL 数据库，将 Durable Objects 定位为需要强一致协调的实时状态组件：

- [Cloudflare：为 Web 应用选择数据存储](https://developers.cloudflare.com/use-cases/web-apps/store-data/)

当前个人场景：

- 只有一个 Owner；
- 设备数量很少；
- 同一时刻只允许一通远程电话；
- 关键问题是原子占用和串行状态转移，不是跨 Owner 的复杂查询；
- 权威状态已经和一个 Durable Object 共置。

因此额外接入 D1 会增加 binding、schema、迁移、跨服务一致性和备份边界，却没有提供当前需要的协调能力。只有未来进入多 Owner、大量历史审计、跨聚合查询或分析报表时，才值得单独评估 D1；即使如此，D1 也不应直接替代活动通话的协调器。

### 6.4 Workers Secrets

Cloudflare 官方把 Secrets 定义为绑定到 Worker 的加密文本值，适合 API key 和 auth token，并明确警告不要用 Wrangler 明文 `vars` 保存敏感值：

- [Cloudflare Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

**项目应放入 Secret 的材料类别：**

- LiveKit 服务地址、API key 和 API secret；
- 媒体授权信封主密钥；
- 部署引导材料的验证值。

文档、测试 fixture、日志和配置文件只允许出现变量名或假值，不能出现实际值。部署流程应在上传前检查 Secret 是否齐全，轮换时先验证新值再退役旧值。

### 6.5 Web Crypto

Cloudflare Workers 提供全局 `crypto.subtle`，官方支持 AES-GCM、HMAC、SHA-2、HKDF 等算法：

- [Cloudflare Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)

Cyrene 的媒体授权信封使用 AES-256-GCM，并通过附加认证数据绑定版本、通话、目标端点和截止点。Web Crypto 能提供密码学原语，但以下内容仍必须由 Cyrene 定义：

- nonce 唯一性；
- AAD 的规范编码；
- 信封单次消费；
- 30 秒级过期和删除；
- 端点绑定；
- 主密钥轮换；
- 解密或匹配失败时 fail-closed。

算法存在不等于协议自动安全；协议字段、状态机和清理时机仍需要项目测试。

## 7. Expo / React Native Android：可直接复用的能力

### 7.1 必须使用 development build

LiveKit React Native 依赖原生 WebRTC 模块。Expo 官方说明 Expo Go 只包含一组预编译原生库，加入额外原生代码或 config plugin 时必须生成自己的 development build：

- [Expo：Development builds FAQ](https://docs.expo.dev/develop/development-builds/faq/)
- [Expo：添加自定义原生代码](https://docs.expo.dev/workflow/customizing/)

**项目事实：**移动端使用 LiveKit Expo plugin、React Native WebRTC config plugin 和 SecureStore plugin，因此不能把 Expo Go 当成通话验收载体。

### 7.2 Android APK 与签名升级链

Expo 官方说明 Android 默认 EAS 产物通常是 AAB；若要直接安装到个人设备，需要在 build profile 中生成 APK。EAS 可以托管或使用自备 Android keystore；已安装应用的升级必须保持 application ID 与签名身份一致：

- [Expo：构建可安装 APK](https://docs.expo.dev/build-reference/apk/)
- [Expo：Android app credentials](https://docs.expo.dev/app-signing/app-credentials/)
- [Expo：Android build 流程](https://docs.expo.dev/build-reference/android-builds/)
- [Expo：本地运行 EAS Build](https://docs.expo.dev/build-reference/local-builds/)

**项目事实：**

- V1 是个人内部发行 APK；
- preview profile 使用 internal distribution 和 APK；
- 覆盖安装保留应用数据与配对授权；
- 卸载再安装会丢失 Android SecureStore 数据，必须重新配对；
- release keystore、密码和 `credentials.json` 绝不能进入 Git。

### 7.3 SecureStore 的边界

Expo 官方说明 Android 上 SecureStore 使用经 Android Keystore 加密的 SharedPreferences；它适合跨应用重启和覆盖升级保存小型敏感键值，但卸载应用后不会保留。官方也提醒不能把它当作不可替代数据的唯一事实源，Android Auto Backup 必须排除无法在恢复后解密的 SecureStore 条目：

- [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/)

**项目事实：**

- 手机把安装标识和长期设备授权保存在 SecureStore；
- 配置采用仅本机、解锁后可用的访问边界；
- 短期 LiveKit token 与本通 E2EE key 只在内存使用，不作为长期授权写入 SecureStore。

从零实现时还应验证：

- 覆盖安装后配对仍存在；
- 卸载后凭据确实消失；
- 备份恢复不会产生不可解密的“幽灵授权”；
- SecureStore 不可用或读写失败时安全拒绝，而不是退回明文存储。

## 8. 必须由 Cyrene 自研的功能

以下内容不能由 LiveKit、Cloudflare 或 Expo 示例自动提供。

### 8.1 设备与 Owner 信任模型

- 单 Owner 的 bootstrap 与恢复边界；
- 已授权桌面批准新手机；
- 两分钟挑战、二维码/短码和六位校验码；
- 设备数量上限、撤销和灾难恢复；
- 每设备独立 credential family；
- credential 轮换、短时幂等重取和 replay 检测；
- 手机 SecureStore 与桌面安全存储之间不同的平台语义。

### 8.2 权威通话状态机

- `AWAITING_DESKTOP → CONNECTING_MEDIA → ACTIVE → RECONNECTING → ENDED`；
- 同一 Owner 单通占用；
- 幂等发起、取消和挂断；
- 桌面确认、媒体连接、重连、空闲和硬时长上限；
- 控制面权威终态与 LiveKit 建议性事件的区分；
- 手机定期读取权威状态并最终收敛；
- 应用后台、设备撤销和 E2EE 失败的终止策略。

### 8.3 一次性媒体授权协议

- 为手机与桌面分别签发最小权限 token；
- 为每通生成独立 E2EE key；
- endpoint-scoped 媒体授权；
- AES-GCM 短时信封；
- 单次领取、截止点和删除；
- token、key 和 identity 的 call binding；
- API 响应 `no-store`；
- 数据库和日志中不出现明文。

### 8.4 跨端 E2EE 就绪协议

LiveKit 提供“启用 E2EE”，但 Cyrene 还要证明：

1. 两端拿到的是同一通电话的正确 key；
2. key provider 在连接/发布前已就绪；
3. 手机本地麦克风 publication 已加密；
4. 桌面发布和手机订阅到的角色音频均加密；
5. 任一端出现 encryption error 时全通终止；
6. SDK 事件乱序或缺失时不会错误接通；
7. 不存在“失败后自动用未加密媒体继续”的降级路径。

### 8.5 桌面语音 Agent 桥

- 只消费已配对手机的麦克风轨道；
- PCM VAD 与 turn 切分；
- 接入现有 `VoiceSession` 的 ASR → 模型 → TTS；
- 接通时锁定 Active Character，整通电话不漂移；
- TTS WAV/MP3 解码、单声道转换；
- SoX `VERY_HIGH` 重采样到 48 kHz；
- 20 ms / 960 samples 音频帧发布；
- 正确等待 playout，避免回答播完即错误结束；
- 用户打断、会话结束和队列清理。

### 8.6 可诊断但不泄密的观测

- 记录状态、阶段耗时和有限错误码；
- 不记录 token、E2EE key、设备 credential、原始音频或转写；
- 区分控制面错误、LiveKit 信令错误、媒体错误和本地模型错误；
- 以 call-scoped、去标识化 ID 做关联；
- 轮换与撤销保留最小审计，不保留 Secret。

## 9. 为什么不能直接整套接入现成方案

### 9.1 LiveKit 示例不是设备授权系统

示例可以连接房间、发布麦克风、订阅音频和启用共享 key，但不会替 Cyrene 处理长期手机配对、桌面批准、设备撤销、凭据轮换或 Owner Recovery。

### 9.2 LiveKit token 不是完整通话状态机

token 决定“能否以及以什么权限加入房间”。官方明确说明 token 到期只约束初始连接，不能作为活动连接的即时撤销、空闲超时、应用后台终止或双方 UI 收敛机制。

### 9.3 E2EE SDK 不负责可信分发

官方 API 接受“外部分发”的 key。如何确认两端身份、如何避免错通复用、如何单次领取和如何在失败时终止，必须由应用协议实现。

### 9.4 Durable Object 不是完整业务领域

Durable Object 解决串行协调与持久化，但不会自动定义挑战、credential family、幂等键、replay 撤销或通话终止原因。这些必须保存在平台无关的领域模块中，Cloudflare 只做适配层。

### 9.5 LiveKit Agents 不是当前桌面角色系统的直接替代

将完整 Agent 搬到云端会改变隐私、角色状态、模型凭据、TTS 模型和成本边界；当前目标恰恰是让 ASR、模型、记忆和角色语音留在个人桌面。因此应复用 `rtc-node` 媒体原语，把现有桌面 `VoiceSession` 暴露为一个窄适配接口，而不是整体迁移到托管 Agent。

### 9.6 通用会议 UI 不符合个人一对一场景

现成会议 UI 通常假定自由加入、多参与者、摄像头和房间列表。Cyrene 需要的是前台主动呼叫、一个 Owner、一个首选桌面、一个锁定角色、强制 E2EE 和不排队的即时状态机；直接接入会议 UI 会扩大权限和状态面。

## 10. 从零构建的推荐顺序

这是一条最小闭环路线，不包含真实部署值。

### 阶段 1：冻结信任边界与状态机

1. 定义 Owner、Desktop Instance、Mobile Device、Credential Family、Pairing Challenge、Voice Call、Media Join Grant。
2. 定义单通状态和所有终止原因。
3. 明确哪些字段允许持久化、进入日志或进入客户端存储。
4. 写出强制 E2EE、无降级和单通占用不变量。

通过标准：纯领域测试可覆盖并发呼叫、幂等重放、撤销、超时和终态不可逆。

### 阶段 2：建立 LiveKit 最小媒体闭环

1. 创建 LiveKit 项目或自托管服务。
2. 在受信测试后端生成两个房间限定、最小权限 token。
3. React Native development build 发布麦克风。
4. Node `rtc-node` 订阅手机音频，并用 `AudioSource` 回送测试音。
5. 验证重连和双方主动断开。

通过标准：不接模型时也能稳定完成至少五轮采集/回放与一分钟连接。

### 阶段 3：接入强制 E2EE

1. 每通生成随机 key；
2. 两端在连接前设置 key provider；
3. 显式启用 E2EE；
4. 对本地 publication 与远端 subscription 做加密状态核验；
5. 注入错 key、漏 key 和 SDK 错误，确认一律 fail-closed。

通过标准：正确 key 可通话，任何错误 key 或未加密轨道都不能进入活动状态。

### 阶段 4：实现 Cloudflare 控制面

1. Worker 提供无状态健康检查；
2. 固定名称路由到 SQLite-backed Durable Object；
3. 接入平台无关状态机和 storage adapter；
4. 通过 Workers Secrets 注入签发与信封所需材料；
5. 使用 AES-GCM 创建 endpoint-scoped 短时信封；
6. 添加 payload 大小、content type、速率和错误正文边界；
7. 在本地 `wrangler dev` 与生产预览环境验证。

通过标准：并发请求只能有一个获准，重放可判定，撤销后权威读写立即失败，持久层没有明文 token/key。

### 阶段 5：长期设备配对

1. 桌面生成两分钟 challenge；
2. 手机扫码或输入短码 claim；
3. 两端核对验证码；
4. 桌面 approve 后签发独立设备 credential；
5. 手机写入 SecureStore，桌面写入平台安全存储；
6. 实现轮换、幂等重取、replay 撤销和重新配对。

通过标准：扫码本身不能授权；拒绝、取消、超时和错误校验均不能获得长期 credential。

### 阶段 6：接入真实桌面语音 Agent

1. 用 adapter 将远端 PCM 喂给现有 VAD/ASR；
2. 将完整 turn 交给 `VoiceSession`；
3. 锁定接通时角色；
4. 将 TTS 转为 48 kHz mono PCM；
5. 以固定 20 ms 帧发布；
6. 等待实际 playout，再回到聆听状态；
7. 将挂断与错误传播到权威状态机。

通过标准：用户至少五轮连续对话，手机听感与桌面 TTS 一致，无沙声、无错误自动结束。

### 阶段 7：Android 签名发行与升级

1. 使用 Expo development build 做原生调试；
2. `eas.json` 的内部发行 profile 生成 APK；
3. 建立并备份固定 release keystore；
4. 以同一 application ID 与签名覆盖安装；
5. 验证覆盖升级保留配对，卸载后需要重新配对；
6. 不把 keystore 或 credentials 文件提交 Git。

通过标准：签名 APK 可离线安装，覆盖升级成功，原生 LiveKit/E2EE/SecureStore 都在正式包中工作。

## 11. 需要重点回归的跨版本兼容面

依赖升级不能只跑 TypeScript 检查。至少验证：

1. `@livekit/react-native`、`@livekit/react-native-webrtc` 与 `livekit-client` 的版本组合；
2. Expo SDK / React Native / Gradle / Android plugin 的原生构建；
3. `@livekit/rtc-node` 的 Electron/Node ABI 与目标架构；
4. RN 与 rtc-node 之间的 E2EE shared key 编码；
5. E2EE 事件是否在两端仍按预期触发；
6. `AudioStream` PCM 采样率与帧格式；
7. `AudioResampler` 的 flush、资源释放和输出长度；
8. 48 kHz / 20 ms / 960 samples 发布；
9. SecureStore 覆盖升级与卸载行为；
10. Worker `nodejs_compat` 下 server SDK 与加密实现；
11. Durable Object storage 的序列化格式与旧数据迁移；
12. token grant 字段、TTL 和 participant removal 行为；
13. 控制面轮询、LiveKit 建议性数据事件与权威终态收敛。

## 12. 安全和隐私检查清单

- [ ] LiveKit API Secret 只存在于 Worker Secret。
- [ ] APK、二维码、日志和错误正文不包含 server secret。
- [ ] 手机 token 只能加入当前随机房间并使用最小发布/订阅权限。
- [ ] 每通房间、participant identity 和 E2EE key 不复用。
- [ ] E2EE key 不写入 SecureStore、数据库、URL、二维码或审计。
- [ ] 只允许短时 AES-GCM 加密信封进入持久层。
- [ ] 信封绑定 call、endpoint、类型与截止点，且只能领取一次。
- [ ] 媒体 E2EE 未就绪或出现错误时不允许明文降级。
- [ ] 手机长期 credential 只存 SecureStore。
- [ ] Android 卸载后要求重新配对，不能从不可解密备份恢复旧授权。
- [ ] Worker 日志不记录请求 Authorization header 或完整 payload。
- [ ] 音频、转写、模型提示和角色记忆不进入控制面。
- [ ] 控制面终态是权威事实，LiveKit 数据事件只作低延迟提示。
- [ ] release keystore 和密码保存在仓库外，并有可恢复备份。

## 13. 常见问题

### Q1：为什么不用 Expo Go？

LiveKit React Native 和 WebRTC 包含原生模块。Expo Go 的原生库集合是预先固定的，不能承载项目自定义的原生依赖；必须使用 development build 或正式 APK。

### Q2：为什么手机不能直接拿 LiveKit API Secret 生成 token？

API Secret 能签发任意受其权限控制的 token。放入 APK 后无法保密和集中轮换。官方 token 模型也要求由受信后端签名，客户端只接收最小权限的短期 token。

### Q3：为什么有 LiveKit E2EE 还需要控制面协议？

E2EE SDK 需要应用提供“外部分发”的 key。它不会判断手机是否经过 Owner 批准，也不会自动处理 key 的一次性领取、错通绑定、两端就绪或失败后的业务终止。

### Q4：为什么不把 E2EE key 长期存在 SecureStore？

当前 key 是每通独立的会话材料，不是长期设备身份。长期存储会扩大泄露窗口和错通复用风险；正确做法是一次性领取、仅驻留内存，并在电话终止后清理。

### Q5：为什么使用 Durable Object 而不是 D1？

当前核心问题是一个 Owner 内的强一致串行协调，而不是大规模关系查询。一个 Durable Object 正好充当聚合协调器并自带私有 SQLite 存储；D1 会增加跨系统一致性却不替代该协调语义。

### Q6：Durable Object 底层是 SQLite，为什么代码还在用 `get/put`？

Cloudflare 官方说明 SQLite-backed Durable Object 仍支持 Storage KV API，数据存储在隐藏 SQLite 表中。当前聚合是一个小型版本化文档，`get/put` 足够；将来只有出现明确查询或迁移需求时才需要改用显式 SQL 表。

### Q7：LiveKit token 设置五分钟 TTL，五分钟后通话会自动断吗？

不会。官方文档明确说到期主要限制初次连接，不影响已经建立的连接和后续重连。因此单通硬上限、撤销和挂断必须由 Cyrene 状态机和媒体管理 API 显式执行。

### Q8：为什么角色 TTS 要发布成 48 kHz？

LiveKit 的 `AudioSource` 支持指定 PCM 采样率，官方示例使用 48 kHz。当前桌面 TTS 经过 SoX 高质量重采样后以 48 kHz 发布，避免旧的无抗混叠 32→16 kHz 降采样造成折返噪声和高频损失。48 kHz 是当前已由真人听感验证的项目选择，不应在依赖合并时静默回退。

### Q9：能否把 Android 音频切成 MediaAudioType 进一步提高音质？

不应直接切。LiveKit 官方说明 MediaAudioType 适合只播放、不发布的场景；Cyrene 同时采集麦克风，需要 CommunicationAudioType 的双向通话路由和回声处理。只有在独立真机实验覆盖扬声器、听筒、蓝牙、麦克风和回声后才可更改。

### Q10：为什么覆盖安装后仍配对，卸载重装却要重新配对？

覆盖安装保留应用数据；Expo 官方说明 Android SecureStore 数据在卸载后不会保留，因为对应 Keystore 条目被删除。这是安全边界而不是故障。

### Q11：手机或桌面必须使用 VPN 吗？

这是部署网络条件，不是 LiveKit、Cloudflare 或 Expo SDK 能保证的能力。Cloudflare 控制面与 LiveKit 媒体是两条独立网络路径：控制面可达不等于 WebRTC 媒体可达。当前个人部署应分别做手机 5G/Wi-Fi、桌面网络、LiveKit WebSocket 与 UDP/TURN 的真实验收。

### Q12：可以把整个语音 Agent 搬到 LiveKit Agents Cloud 吗？

技术上可以另做架构，但这会改变当前“模型、角色记忆、ASR 与 GPT-SoVITS 留在个人桌面”的隐私和运行边界，也会引入云端模型凭据与成本。当前更合适的是只复用 LiveKit RTC 媒体层，让桌面现有 `VoiceSession` 继续承担 Agent 逻辑。

## 14. 一手资料索引

### LiveKit

- [React Native SDK 官方仓库](https://github.com/livekit/client-sdk-react-native)
- [React Native Expo plugin 官方仓库](https://github.com/livekit/client-sdk-react-native-expo-plugin)
- [React Native Expo 官方示例](https://github.com/livekit/client-sdk-react-native-expo-plugin/tree/main/example)
- [React Native E2EE 官方示例](https://github.com/livekit/client-sdk-react-native/tree/main/example)
- [Node SDK 官方仓库](https://github.com/livekit/node-sdks)
- [从后端发布音频](https://docs.livekit.io/transport/media/publish/)
- [Encryption overview](https://docs.livekit.io/transport/encryption/)
- [E2EE 入门](https://docs.livekit.io/transport/encryption/start/)
- [生产鉴权流程](https://docs.livekit.io/frontends/build/authentication/)
- [Access tokens 与 grants](https://docs.livekit.io/frontends/reference/tokens-grants/)

### Cloudflare

- [Durable Objects 概览](https://developers.cloudflare.com/durable-objects/)
- [Durable Objects 设计规则](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
- [SQLite-backed Durable Object Storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Durable Objects 快速开始](https://developers.cloudflare.com/durable-objects/get-started/)
- [数据存储产品选择](https://developers.cloudflare.com/use-cases/web-apps/store-data/)
- [Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)

### Expo

- [Development builds FAQ](https://docs.expo.dev/develop/development-builds/faq/)
- [添加自定义原生代码](https://docs.expo.dev/workflow/customizing/)
- [构建 Android APK](https://docs.expo.dev/build-reference/apk/)
- [Android build 流程](https://docs.expo.dev/build-reference/android-builds/)
- [Android app credentials](https://docs.expo.dev/app-signing/app-credentials/)
- [本地 EAS Build](https://docs.expo.dev/build-reference/local-builds/)
- [SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/)

## 15. 对主实施文档的建议

后续面向维护者的正式说明文档应将本文作为“外部能力依据”，另行补充：

1. 当前代码文件清单与模块职责；
2. 实际 API 路由和状态字段；
3. 不含真实值的配置变量模板；
4. 本地开发、Cloudflare 部署、APK 构建的可复制命令；
5. 测试矩阵与真人验收步骤；
6. 依赖升级和上游合并时必须保护的不变量；
7. 生产轮换、撤销、恢复和故障处置 runbook。

不得把本文中的平台通用能力误写成“项目已经验证”，也不得把当前项目策略误写成平台官方保证。
