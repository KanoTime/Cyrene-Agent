# Cyrene 移动端异地通话与长期配对：一手资料研究

## 研究信息

- 研究日期：2026-07-21
- 研究范围：让家中常驻的 Cyrene Agent 与外网手机进行一对一语音通话，并把“每次扫码”升级为安全的长期设备配对
- 研究方法：只采用 Expo、LiveKit、IETF、W3C、Android、Apple、Electron 与 OWASP 的官方资料
- 当前边界：本文给出技术决策和演进建议，不在本文件中实现公网服务、账号体系或发布包

> **2026-07-22 术语与参数校正（优先适用）**：本研究早于需求访谈收口。下文保留的 `refresh token` 是早期 OAuth 类比，当前领域术语一律以可撤销、轮换的 **Device Credential / Credential Family** 为准，短期 **Device Access Token** 固定为 15 分钟；每通初次加入的 LiveKit Token 固定为 5 分钟。二维码和短码现在统称 **Pairing Invitation**，只能使新安装成为 Pairing Candidate，仍须现有桌面完成 Pairing Approval；媒体 Token 与 E2EE 密钥则只作为端点独立、内存限定的 **Media Join Grant** 交付。下文把 LiveKit Cloud 写为既定媒体路径的表述也已过时：它目前仅是具备公开即时撤销能力的候选，官方没有中国大陆可用性承诺，必须通过大陆真实网络和预加入撤销门禁后才能锁定。若下文的早期表述与这些边界冲突，以 [CONTEXT.md](../../CONTEXT.md)、[ADR-0030](../adr/0030-let-only-the-public-control-plane-sign-livekit-tokens.md)、[ADR-0032](../adr/0032-use-per-device-rotating-credential-families.md)、[ADR-0033](../adr/0033-enable-livekit-end-to-end-encryption-for-every-call.md)、[ADR-0036](../adr/0036-require-desktop-approved-short-lived-device-pairing.md)、[配对挑战契约](device-pairing-challenge-contract.md)、[E2EE 媒体加入授权契约](e2ee-media-join-contract.md) 与 [LiveKit Cloud 中国大陆网络与成本闸门](livekit-cloud-mainland-network-and-cost-gate.md) 为准。

## 结论摘要

推荐路线不是“给二维码或 LiveKit JWT 加一个无限有效期”，而是：

1. 把手机端从 Expo Development Build 改成 `preview` 内部分发包，之后再升级为 `production` 包；这样 JavaScript 和资源进入安装包，手机启动不再依赖 Mac 上的 Metro。
2. 保留 LiveKit Cloud 作为公网音频候选。Mac 与手机可各自主动向其建立出站连接，因而该架构不要求同一 Wi-Fi 或家中 Mac 的公网入站端口；但其必须先通过中国大陆真实网络与撤销门禁，不能现在视为已锁定。
3. 增加一个很小的公网“配对与通话控制服务”，负责身份验证、设备登记、设备在线状态、呼叫协调，以及签发每次通话专用的短期 LiveKit JWT。
4. 第一次仍可扫码，但二维码只承载一次性 Pairing Invitation；配对成功后，手机保存可撤销、可轮换的独立 Device Credential，以后打开 App 即可自动恢复登录并点击“呼叫星野”。
5. LiveKit API Secret 只保存在受控后端，绝不下发到手机；每通初次加入的 LiveKit Token 固定为 5 分钟、限定单个房间和端点身份，并只随本端 Media Join Grant 留在内存中。
6. 单用户 V1 不必先自建传统账号密码库。优先实现“一次扫码 + 设备凭据”；需要换机恢复、多设备或多用户时，再接入 passkey 或 OAuth 2.0 Authorization Code + PKCE。

## 1. 当前限制究竟来自哪里

当前安装的是 Expo Development Build。Expo 官方说明，开发客户端只是应用的原生部分，继续运行 JavaScript 仍需要启动 bundler，即 `npx expo start`。Metro 默认通过局域网地址提供代码，所以手机通常需要与 Mac 位于同一网络，或者通过 USB 反向映射端口。[Expo：创建 Development Build](https://docs.expo.dev/develop/development-builds/create-a-build/)

这不是 LiveKit 的网络限制。Expo 官方同时说明，production build 会导出项目并把文件嵌入原生二进制；EAS 默认配置也明确区分：

- `development`：`developmentClient: true`，用于连接开发服务器；
- `preview`：`distribution: internal`，用于内部安装和真实用户路径验收；
- `production`：用于商店/TestFlight 等正式分发。

来源：[Expo CLI](https://docs.expo.dev/more/expo-cli/)、[Expo `eas.json` 配置](https://docs.expo.dev/build/eas-json/)、[Expo 内部分发构建](https://docs.expo.dev/tutorial/eas/internal-distribution-builds/)、[Expo production build](https://docs.expo.dev/deploy/build-project/)。

### 建议

- Android 近期使用 EAS `preview` 生成可直接安装的 APK，替换当前 Development Build。
- iOS 测试阶段使用 EAS internal distribution/TestFlight；长期使用走 TestFlight 或 App Store。
- `preview` 和 `production` 包不再要求家中 Mac 运行 Metro。EAS Update 可在以后用于更新 JavaScript，但不是公网语音的前置条件。

## 2. Mac 在家、手机在外的公网媒体路径

LiveKit Cloud 是托管全球实时通信的候选。若它通过后续大陆网络门禁，客户端加入房间只需要 LiveKit WebSocket 地址和参与者 access token。[LiveKit Cloud](https://docs.livekit.io/intro/cloud/)、[连接到 LiveKit](https://docs.livekit.io/intro/basics/connect/)

LiveKit Cloud 会按网络条件依次尝试 ICE/UDP、TURN/UDP、ICE/TCP、TURN/TLS；TURN/TLS 可在网络只允许出站 TLS 时工作。官方防火墙资料列出的关键路径包括：

- `*.livekit.cloud` TCP 443：安全 WebSocket 信令；
- `*.turn.livekit.cloud` TCP 443：TURN/TLS；
- UDP 3478、50000～60000：更优的实时媒体路径。

来源：[LiveKit 连接可靠性](https://docs.livekit.io/intro/basics/connect/)、[LiveKit Cloud 防火墙配置](https://docs.livekit.io/deploy/admin/firewall/)。

若候选在真实网络门禁中通过，家中 Mac 可使用家庭宽带，手机可使用 5G 或外部 Wi-Fi。双方只需具备正常的出站网络访问，不要求：

- 同一局域网；
- USB 数据线；
- Mac 拥有公网 IP；
- 路由器端口映射；
- 对公网开放 Electron 本地 HTTP 服务。

### 仍然缺少的控制面

LiveKit 解决音频和数据的实时传输，但它不会自动知道“这台手机属于哪个用户”“应该唤醒哪台家中 Mac”“用户是否撤销了这台手机”。手机在外主动发起新通话，还需要公网控制面来协调两端并取得新的短期房间令牌。

建议结构：

```text
手机 Preview/Production App
  ├─ HTTPS：登录、刷新凭据、请求开始/结束通话
  └─ WebRTC：连接已验证的媒体候选（当前为 LiveKit Cloud）
                 ↕
公网配对与通话控制服务
  ├─ 用户与设备记录
  ├─ Device Credential / Credential Family 轮换与撤销
  ├─ 短期 LiveKit token endpoint
  └─ 向在线桌面发送呼叫事件
                 ↕ 出站 WSS/HTTPS
家中常驻 Cyrene Agent
  ├─ 保持在线心跳并接收呼叫
  └─ WebRTC：连接已验证的媒体候选（当前为 LiveKit Cloud）
```

Mac 需要保持 Cyrene Agent 运行、系统不睡眠，并在登录后自动启动。它通过 WSS/HTTPS 主动连接控制服务，无需接受公网入站连接。

## 3. 长期配对与“永久连接”的正确含义

真正应该长期保存的是“这台手机已获授权”的设备身份，而不是某一个 LiveKit 房间 JWT。

### 推荐的单用户首次配对

1. 桌面生成一次性高熵配对挑战，二维码只包含挑战 ID、服务域名和短期校验数据，不包含 LiveKit API Secret 或永久令牌。
2. 手机扫码，并由用户在手机/桌面确认设备名称和校验码。
3. 控制服务建立 `paired_device` 记录，记录设备 ID、所属用户、创建时间、最近使用时间和撤销状态。
4. 手机获得可撤销、可轮换的独立 Device Credential；Mac 获得自己的 Desktop Instance Device Credential。
5. 手机把 Device Credential 放入平台安全存储，普通业务数据库不保存明文凭据，只保存凭据哈希和 Credential Family 状态。
6. 后续打开 App 时自动刷新短期应用 access token；用户点击“呼叫星野”即可，无需重新扫码。
7. 桌面端提供“已配对设备”列表和“一键撤销”。手机丢失后，撤销该设备及其整条 Credential Family。

### 为什么 Device Credential 仍不能“永不过期”

OAuth 2.0 Security Best Current Practice 对公开客户端的 refresh token 要求发送方约束或 rotation，并要求支持撤销和长期不活跃后失效；这些是 Cyrene Device Credential 轮换、撤销与闲置过期设计的安全依据。它同时要求 access token 权限最小化。[RFC 9700：OAuth 2.0 Security Best Current Practice](https://www.rfc-editor.org/rfc/rfc9700.html)

Cyrene V1 可先采用 rotation：

- 每次轮换都签发新的 Device Credential，并立即废止旧凭据；
- 发现已废止凭据被重放时，撤销整个 Credential Family；
- 每台设备独立记录和撤销；
- 设置绝对最长生命周期和不活跃过期时间；
- Device Access Token 保持 15 分钟，只能调用设备和通话相关接口。

更高安全等级可让手机在 Android Keystore/iOS Secure Enclave 中生成不可导出的设备私钥，并用 DPoP 或等价的签名挑战把 Device Credential 绑定到设备；这适合后续阶段，不必阻塞单用户 V1。

## 4. 账号密码、Device Authorization Grant 与 passkey 的取舍

### 不建议优先自建传统账号密码

账号密码表面上容易理解，但会立刻引入密码哈希、找回、邮箱验证、暴力破解防护、多因素认证和数据泄露响应。OWASP 的移动安全指导建议不要在设备上保存用户密码，而应使用安全且可撤销的 access token，并使用平台 Keychain/Keystore。[OWASP Mobile Application Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Mobile_Application_Security_Cheat_Sheet.html)

对于当前个人单用户产品，“一次扫码登记设备 + 可撤销设备凭据”开发量更小，也更贴近实际需求。

### OAuth 2.0 Device Authorization Grant

RFC 8628 的 Device Authorization Grant 面向缺少浏览器或输入受限的设备，例如电视和游戏机：设备展示 URL/用户代码，由用户在另一台设备授权；请求设备只需要能够发出 HTTPS 请求。它还允许以二维码优化验证 URL。[RFC 8628](https://www.rfc-editor.org/rfc/rfc8628.html)

适合 Cyrene 的位置：

- 可用于桌面端首次登录/登记：桌面展示代码或二维码，用户用已登录手机批准家中 Mac。
- 可借鉴其一次性代码、短有效期、轮询限速和设备确认 UX。

不适合的位置：

- 不应把 Device Authorization Grant 当成手机 App 的常规登录。RFC 8628 明确说明，它不用于替代具备浏览器能力的智能手机原生登录；手机应采用原生应用 OAuth 最佳实践。

### 手机原生 OAuth

若接入现成身份提供商，手机端应使用系统外部浏览器的 Authorization Code + PKCE。RFC 8252 要求公开原生客户端实施 PKCE，并强调原生 App 不能被假定能够保守一个随安装包分发的客户端 Secret。[RFC 8252：OAuth 2.0 for Native Apps](https://www.rfc-editor.org/rfc/rfc8252.html)

### Passkey

WebAuthn/passkey 使用限定到 Relying Party 的公钥凭据。认证器保存私钥，服务端保存公钥并验证签名断言；应用脚本不会获得私钥。[W3C Web Authentication Level 3](https://www.w3.org/TR/webauthn-3/)

Passkey 适合：

- 多设备登录与换机恢复；
- 避免自建密码库；
- 对高风险操作进行重新认证，例如撤销所有设备或导出数据。

Passkey 不是完整的通话配对服务，也不能取代 Device Credential 生命周期、设备清单、撤销和 LiveKit Token endpoint。它需要公网 HTTPS 域名、认证后端，以及 Android/iOS 关联配置，因此建议在单用户 V1 闭环后再加入。

## 5. 为什么不能把 LiveKit API Secret 或永久 JWT 存进手机

### API Secret 不能进入客户端

LiveKit 的 access token 是由 API Secret 签名的 JWT，令牌包含参与者身份、房间、发布/订阅等权限。官方明确指出：生成 token 需要 API keys，因此必须在后端完成；生产环境应使用带自有身份验证的 token endpoint。[LiveKit Authentication](https://docs.livekit.io/frontends/build/authentication/)、[LiveKit Access Tokens & Grants](https://docs.livekit.io/frontends/reference/tokens-grants/)

如果把 API Secret 写进 APK、JavaScript bundle 或手机安全存储，能够取得应用安装包或控制设备的人就可能提取它，并伪造任意参与者、房间和权限的令牌。这不是“这台手机的个人凭据”，而是项目级签发能力。

因此 API Secret 只能位于：

- 受控公网后端的 secret manager/运行时环境；或
- 当前实验版的家中桌面端本地安全存储，但此方案仍需要安全的公网控制通道把短期手机 token 交付给已认证手机。

生产推荐是放在公网 token endpoint 后端，因为 LiveKit 官方的生产认证流程就是由后端生成并发送前端 JWT。

### 永久 LiveKit JWT 同样不安全

LiveKit JWT 是 bearer credential：持有者可按令牌中的房间与权限加入。令牌的 `exp` 只限制初次连接；LiveKit 会为正在连接的客户端处理当前会话所需的 token refresh，但这不意味着旧 JWT 应被当作永久登录凭据。[LiveKit Access Tokens & Grants](https://docs.livekit.io/frontends/reference/tokens-grants/)

永久 JWT 会造成：

- 泄露后长期可重放；
- 难以单独撤销某台丢失的手机；
- 令牌长期绑定固定房间或被迫授予过宽权限；
- 无法在每次通话重新决定参与者身份、房间和最小权限。

正确做法是每次通话动态签发初次加入有效期固定为 5 分钟的 JWT，并限制为：

- 指定的一次性房间；
- 指定参与者身份；
- 手机仅发布麦克风、订阅角色音频；
- 不授予管理、任意房间、任意数据发布等额外权限。

## 6. 手机与桌面的安全存储

Expo SecureStore 在 Android 上使用 Android Keystore 加密的 SharedPreferences，在 iOS 上使用 Keychain，适合保存小型可撤销 token。Android 卸载应用后相关数据会丢失；iOS 的卸载后行为存在平台差异，因此不能把 SecureStore 当作不可替代的业务事实来源。[Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/)

Android 官方说明，Keystore 中的密钥材料可以保持不可导出，并能限制密钥用途或要求用户认证。[Android Keystore](https://developer.android.com/privacy-and-security/keystore)

建议：

- 手机：用 Expo SecureStore 保存 Device Credential 或未来设备私钥引用；普通 AsyncStorage 只保存非敏感 UI 状态。
- Mac：用 Electron `safeStorage` 加密桌面设备凭据；其 macOS 实现把加密密钥放入 Keychain。[Electron `safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage)
- 服务端：只保存 Device Credential 哈希、未来设备公钥、Credential Family 与撤销状态，不保存手机明文 Device Credential。

## 7. 可复用什么、需要自研什么

| 能力 | 选择 | 理由 |
|---|---|---|
| 手机独立安装与发布 | 复用 Expo EAS `preview` / `production` | 直接消除 Metro、同 Wi-Fi 和 USB 依赖；不需要自研移动端打包系统 |
| 公网音频、NAT 穿透、TURN、网络重连 | 优先验证 LiveKit Cloud | 它具备 WebRTC、TURN/TLS 与网络切换路径，但未获中国大陆可用性承诺；通过大陆/E2EE/撤销门禁前不锁定，也不因此自研媒体服务器或音频中继 |
| LiveKit JWT 格式与房间权限 | 复用 LiveKit Server SDK/token endpoint 规范 | 避免自研 JWT 兼容层；仍需由 Cyrene 后端决定用户与设备是否有权领 token |
| 手机秘密存储 | 复用 Expo SecureStore/Android Keystore/iOS Keychain | 不在业务代码中自研加密存储 |
| 标准账号登录 | 后续复用成熟 OIDC/OAuth 提供商或 passkey 服务 | 避免自建密码哈希、恢复和 MFA；手机采用 Authorization Code + PKCE |
| 设备登记、归属、在线状态、呼叫协调、撤销 | Cyrene 自研薄控制面 | 这些是 Cyrene 的业务模型，LiveKit/Expo/OAuth 均不会替产品决定“哪台手机能呼叫哪台 Mac” |
| 通话状态、角色 ASR/LLM/TTS 编排 | 复用现有 Cyrene VoiceSession 与 LiveKit bridge | 现有链路已通过真机验证，只需要改变启动凭据和远程控制入口 |

## 8. 为什么不直接整套接入某一个现成系统

- Expo 只解决构建、分发和更新，不提供 Cyrene 的用户/设备关系和 LiveKit 房间授权。
- LiveKit 只解决实时媒体、房间和 token 校验；其官方生产流程仍要求应用后端根据自己的身份系统签发 token。
- OAuth/OIDC 或 passkey 提供商能确认“用户是谁”，但不知道“哪个 Cyrene 桌面实例属于他”“是否在线”“该呼叫应使用哪个角色、ASR 和 TTS”。
- 通用远程桌面、VPN 或端口映射虽然可能绕过局域网问题，却会扩大 Mac 的公网暴露面，也无法自然解决每次通话的最小权限与丢失设备撤销。

所以应组合成熟基础设施，并只自研很薄的领域控制面，而不是引入一套同时替换 Cyrene 角色运行时和 LiveKit 音频桥接的完整第三方通话产品。

## 9. 推荐实施顺序

### 阶段 A：先消除 Metro（低风险、立即改善）

1. 新增 EAS `preview` 构建配置。
2. 构建并安装 Android preview APK；iOS 使用 internal distribution/TestFlight。
3. 在手机 5G、Mac 家庭网络下验证当前短期二维码 LiveKit 通话。

验收：手机冷启动不出现 Development Build 启动器，不运行 `npm start` 也能进入 Cyrene Voice。

### 阶段 B：一次配对后长期使用（核心目标）

1. 部署 HTTPS/WSS 配对与通话控制服务。
2. 增加用户、桌面设备、手机设备、Credential Family 和 call session 数据模型。
3. 首次二维码从“携带 LiveKit JWT”改为“一次性配对 challenge”。
4. 手机加入 SecureStore、refresh rotation、自动登录和“呼叫星野”。
5. 桌面加入安全凭据、出站长连接、开机/登录自启动、在线心跳和自动加入房间。
6. 后端按每次通话签发短期、最小权限 LiveKit JWT。
7. 桌面设置页加入配对设备列表、最后在线时间和撤销按钮。

验收：首次配对后，无论手机使用 5G 还是外部 Wi-Fi，都能点击一次发起通话；不再扫码；撤销手机后旧 Device Credential 和新通话请求均失败。

### 阶段 C：恢复与多设备

1. 接入 passkey 或成熟 OAuth/OIDC 提供商。
2. 增加换机恢复、多个手机、多个桌面和高风险操作重新认证。
3. 评估 DPoP/设备公钥绑定、推送通知、后台来电和系统级 CallKit/Android Telecom。

## 10. 最终建议

Cyrene 的下一步应定义为“公网常驻 + 可信设备”，而不是“把当前二维码保存更久”。近期最合理的产品体验是：

> 第一次在家扫描二维码登记手机；以后 Mac 常驻家中，用户在外打开 Cyrene Voice，自动登录后点击“呼叫星野”，控制服务为手机和桌面各签发一次性短期房间凭据，两端通过已验证的媒体服务通话。当前 LiveKit Cloud 只是待大陆网络与撤销门禁的候选；手机丢失时可以在桌面一键撤销。

这条路线复用 Expo 的发布能力、LiveKit 的公网实时媒体、系统安全存储和 OAuth/WebAuthn 标准，只自研 Cyrene 独有的设备归属与呼叫协调，能够同时解决异地网络、无需 Metro、不重复扫码和设备可撤销四个核心问题。
