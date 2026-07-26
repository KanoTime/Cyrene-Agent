# 异地语音与长期配对：设计验收闸门

> 本文是已确认决策的验证映射，不是第二份规格，也不授权开始正式实现。领域语义以 [CONTEXT.md](../../CONTEXT.md) 为准；不可逆取舍以对应 ADR 为准。
>
> 状态（2026-07-23）：需求访谈已结束。Android Beta 0 的真实手机手动二维码通话已验证；Android Beta 1 又通过了正式 CloudBase 公网长期配对、桌面六位码核对与批准、获批凭据安全保存，以及应用进程重启后的配对恢复。它们仍不构成异地一键呼叫、强制 E2EE、即时媒体撤销或大陆异地媒体验收。Owner 已选择 E2EE 方案 A：控制面短暂可读每通共享密钥但绝不持久化。CloudBase 与 LiveKit Cloud 的完整门禁仍在进行中。

## 已可进入规格的产品与安全边界

| 主题 | 已确认结果 | 规范来源 |
| --- | --- | --- |
| V1 范围 | 只支持 Android、EAS Build、一个 Owner；音频继续由 LiveKit E2EE 承载，公网控制面不保存音频、转写、角色记忆或模型内容。每通媒体资料只能以端点独立的 Media Join Grant 进入内存。Owner 已选择方案 A：控制面是短暂可读本通共享 E2EE 密钥的受信分发组件，但密钥绝不进入数据库、审计、日志、URL、二维码或任何持久存储；因此只能声称媒体对 LiveKit Cloud 端到端加密，不能声称控制面零知识。设备撤销的媒体终止需要身份级旧 token 撤销能力；在当前已核验候选中，只有 LiveKit Cloud 的公开能力符合，但它尚无大陆网络承诺，因而只是候选，必须通过大陆实测、活动撤销、预加入撤销与容量拒绝路径，不能用短 TTL 或自托管行为替代。腾讯 TRTC 有大陆路径和结束当前房间能力，但其官方私有加密的成本、Electron 支持与预加入撤销都不满足当前范围，不能静默替换。 | [ADR-0027](../adr/0027-use-a-managed-serverless-public-control-plane.md)、[ADR-0028](../adr/0028-build-the-first-android-release-with-eas-and-back-up-its-signing-key.md)、[ADR-0033](../adr/0033-enable-livekit-end-to-end-encryption-for-every-call.md)、[E2EE 契约](../research/e2ee-media-join-contract.md)、[密钥分发选择](../research/e2ee-key-distribution-trust-boundary.md)、[撤销研究](../research/livekit-token-revocation-and-immediate-device-revocation.md)、[大陆网络与成本闸门](../research/livekit-cloud-mainland-network-and-cost-gate.md)、[媒体候选验收协议](../research/media-candidate-acceptance-protocol.md)、[大陆媒体替代调研](../research/china-mainland-media-e2ee-and-immediate-revocation-alternatives.md) |
| 新设备配对 | 必须由现有桌面明确批准；二维码为主、短码为备用；挑战 2 分钟有效，成功、拒绝、取消、超时或 5 次短码错误均终止。二维码、短码与校验码只能建立候选，不能直接授予设备；有效授权最多 3 台 Desktop Instance 与 5 台 Mobile Device，达到上限先撤销同类设备。 | [ADR-0036](../adr/0036-require-desktop-approved-short-lived-device-pairing.md)、[配对挑战契约](../research/device-pairing-challenge-contract.md) |
| 凭据与撤销 | 每台设备独有 Credential Family；15 分钟 Device Access Token；轮换重放撤销整条链；每个受保护的控制面决定都复核 Family 有效性，因而撤销立即终止关联通话并使尚未到期的 Access Token 失效。重装或安全存储丢失视为新设备并重新配对。手机闲置 180 天或初次配对满 1 年必须重新配对；桌面无绝对期限但离线 180 天失效；V1 不做 DPoP/设备私钥绑定。 | [ADR-0032](../adr/0032-use-per-device-rotating-credential-families.md)、[设备凭据链契约](../research/device-credential-family-contract.md)、[CONTEXT.md](../../CONTEXT.md) |
| Owner 恢复 | 无可用授权桌面时，单次 Owner Recovery Key 可恢复 Owner 并撤销旧桌面；展示后必须以随机片段确认已在 Cyrene 外保存；使用后立即轮换，恢复密钥不能当作日常设备凭据。 | [ADR-0029](../adr/0029-recover-the-passwordless-owner-with-an-offline-key.md) |
| 授权灾难恢复 | 授权数据不可恢复丢失时，不允许从旧备份复活授权；旧凭据、恢复密钥和通话全部失效，使用新的 Deployment Bootstrap Code 重建并让全部设备重新配对。 | [ADR-0034](../adr/0034-rebootstrap-after-control-plane-authorization-data-loss.md) |
| 呼叫语义 | 只有 Preferred Desktop 可处理；不排队、不广播、不自动改呼；每 Owner 最多一通；桌面确认 10 秒、媒体连接 30 秒、重连 30 秒、最长 4 小时。只有手机有效说话或桌面实际输出角色语音才重置空闲计时；连续 10 分钟没有该互动即结束，保活/UI/重连不重置。V1 只支持前台主动呼叫，移动端应用连续后台 10 秒结束，不含来电通知、后台接听或锁屏通话。 | [ADR-0035](../adr/0035-use-one-immediate-idempotent-call-state-machine-across-clients.md)、[状态机契约](../research/remote-call-state-machine-contract.md) |
| 桌面常驻 | 用户登录后启动、运行时意外崩溃 10 分钟内最多重启 3 次、登录后预热 ASR；接通电源时防止自动睡眠，但普通合盖是预期的 Desktop Suspension。唤醒后必须显式重建运输层并进行权威读取，不能把旧订阅或已终态通话自动恢复；同一未终态 Media Session 只可在既有 30 秒窗口内恢复。 | [ADR-0031](../adr/0031-supervise-the-desktop-and-locally-managed-runtimes-after-login.md)、[桌面挂起与唤醒复核契约](../research/desktop-suspension-reconciliation-contract.md)、[CONTEXT.md](../../CONTEXT.md) |
| Android 构建前提 | 已生成 `preview` 内部分发签名 APK，包名 `com.cyrene.agent.voice`、版本 `1.0.0`，并已通过 APK v2 签名校验和 Owner 真机手动二维码语音测试。它只验证 Beta 0 前台扫码会话，不能证明 E2EE、长期配对、即时撤销或大陆异地媒体可用。EAS 托管 keystore、本机仓库外 AES-256 加密归档与 Owner 已确认的百度网盘加密归档副本均已存在；归档已完成解密复核，随机口令只存 macOS 钥匙串且不随网盘副本上传，临时明文与仓库内 release 凭据检查均通过。 | [Android EAS 与 E2EE 闸门](../research/android-eas-e2ee-build-gate.md)、[ADR-0028](../adr/0028-build-the-first-android-release-with-eas-and-back-up-its-signing-key.md)、[ADR-0033](../adr/0033-enable-livekit-end-to-end-encryption-for-every-call.md) |
| 运输层安全 | CloudBase `watch()` 只传 Opaque Wake Signal 的无业务内容；收到信号后，端点必须用 Cyrene 的权威 HTTPS 授权重新读取状态。运输层身份永远不是第二授权源。 | [ADR-0037](../adr/0037-use-content-free-wake-signals-before-authoritative-reads.md) |
| 数据与成本保护 | 公网控制面只留白名单内的设备、配对、即时 Call Coordination Record、可用性/无内容唤醒和最小审计；禁止内容、秘密、硬件指纹与原始诊断。电话结束、撤销或授权重建后立即封住资料领取，并仅以短时 Media Revocation Work Item 保留房间/参与者映射直到已选媒体服务撤销确认，随后删除；安全审计最多保留 90 天。优先免费，20/40 元告警，达到 ¥50 时拒绝新配对、新呼叫和新媒体凭据，但保留撤销、恢复与审计；不得自动购买或提高额度。这个 ¥50 边界只属于公网控制面；媒体服务独立发生权威容量拒绝时，按 Media Capacity Protection 拒绝新会话或安全终止正在建立的通话，绝不隐性付费或伤及既有通话。 | [数据边界契约](../research/public-control-plane-data-boundary-contract.md)、[状态机契约](../research/remote-call-state-machine-contract.md)、[媒体候选验收协议](../research/media-candidate-acceptance-protocol.md)、[撤销研究](../research/livekit-token-revocation-and-immediate-device-revocation.md)、[ADR-0027](../adr/0027-use-a-managed-serverless-public-control-plane.md)、[CONTEXT.md](../../CONTEXT.md) |

## 已验证的 Android Beta 0（2026-07-22）

- EAS `preview` 内部分发构建已完成；得到的独立 APK 不依赖 Metro，包名为 `com.cyrene.agent.voice`、版本 `1.0.0`，本地以 Android APK Signature Scheme v2 验证为单签名者安装包。
- Owner 已在真实 Android 手机上安装，并报告“手动二维码 → 前台语音通话”的端到端效果正常。该证据覆盖手机麦克风/扬声器与桌面 ASR、模型、TTS 的既有桥接路径；它不声称验证了后台、锁屏、来电通知、长期设备身份或公网控制面。
- 这项成功只属于 [Manual QR Voice Session](../../CONTEXT.md)；二维码及当前房间资料是短时会话资料，不能替代桌面批准的 Pairing Challenge 或 Device Credential。
- release keystore 的 EAS 托管副本与仓库外加密副本已经完成双重保管；尚未执行的 Android V1 闸门包括：连接前强制 E2EE、错误密钥与绝不降级、活动/预加入媒体撤销，以及大陆 5G 与外部 Wi-Fi 的异地媒体。

## 厂商锁定前的唯一未完成实验

最初“连续 72 小时不合盖”的 CloudBase 观测在第一次正常合盖返家后停止并保留原始证据；它暴露了 SDK 自动 `REBUILD_WATCH` 不能作为产品恢复策略，但不把 Owner 已明确允许的合盖暂停计为失败。修订后的原型仍只观察一个无业务内容唤醒订阅及每约 10 分钟一次的短函数脉冲；不使用真实设备、真实 LiveKit 或正式代码。

修订观察的第一个 epoch 也不能续用：本机监测进程在累计 3.361 清醒小时后未写终态便消失，已标记为 `OBSERVATION_INTERRUPTED`。当时 20/20 脉冲确认成功且 `schemaViolations`、调用错误、脉冲超时、订阅错误均为零；这些只是部分证据，既不构成通过，也不把正常合盖计为 CloudBase 失败。下一轮必须是新的独立 epoch，使用下述修订门槛；旧连续实验和中断 epoch 都不得续算、重写或因自动重启而被包装成连续通过。

该原型只验证运输层在睡眠后的显式重建与成本计量，不能把测试用户的脉冲成功等同于真实 Call Availability 已恢复；正式实现仍须在新订阅后做 Cyrene 权威 HTTPS 读取和本机运行时就绪检查，才允许重新报告可接听。

通过条件：

- 窗口至少覆盖 72 个日历小时，累计至少 12 个桌面清醒且新订阅已就绪的小时，并覆盖至少 3 次真实 Desktop Suspension / Wake Reconciliation。合盖、通勤或系统睡眠期间不要求保活，也不计入清醒时长。
- 每次唤醒先显式关闭/丢弃旧订阅、重新认证并建立新订阅；只有初始快照与一次 30 秒内脉冲确认都成功，才恢复 Call Availability。SDK 自动 `REBUILD_WATCH` 不构成成功恢复证据。
- 所有有效清醒段的 `schemaViolations`、调用错误与脉冲超时均为零，每次脉冲都有对应确认。若发生实时错误，必须保留证据，并以显式新订阅、初始快照与后续脉冲确认完成恢复；否则失败。
- 结束后读取观察日期范围的资源点用量，与最初基线（0.47 资源点）比较，作为共享免费环境总增量的保守上界；结合已就绪清醒连接小时和实际脉冲数推导月度用量仍在 3,000 点免费额度与 ¥50/月硬上限内。合盖时间不得外推为持续连接成本。
- 清理时仅删除明确命名的原型函数、原型集合和原型测试用户，并逐项验证；**不得删除 CloudBase 环境本身**。

失败条件：清醒段或唤醒复核后订阅出现不可恢复中断、字段白名单被突破、脉冲无法补齐、成本投影越过边界，或测试资源无法按上述范围清理。普通合盖本身不是失败条件；它只会让桌面在恢复完成前保持 `DESKTOP_UNAVAILABLE`。任一项失败都只否决 CloudBase 当前形态；已确认的领域模型、E2EE、设备凭据和呼叫语义不回退。

## 进入正式规格与实现前后的证据分层

| 阶段 | 必须先具备的证据 | 当前状态 |
| --- | --- | --- |
| 厂商无关设计收口 | 已确认的通话阶段、终态理由、计时归属、并发与最小数据不变量可由后续控制面 Adapter 统一验收；不假定任何具体云厂商。 | 已完成（[状态机契约](../research/remote-call-state-machine-contract.md)） |
| 锁定控制面候选 | 72 日历小时 / 12 清醒小时 / 3 次唤醒复核通过，资源点结算记录完成，原型资源按精确清单清理。 | 进行中 |
| 受限 Beta 提前部署 | Owner 可在累计 12 个清醒小时后单独授权最小正式资源，用于尽早验收长期配对；这不等于锁定候选，也不改变完整门禁与失败处理。 | 已授权：只允许 HTTP Access Service、正式授权函数和 `/v1` 路由 |
| 编写正式规格 | 本文上表的决策无冲突，控制面与媒体候选均已锁定，CloudBase 观测和媒体大陆/撤销/容量拒绝闸门都已通过；规格只把 ADR 行为落实为接口、状态和错误语义。 | 等待控制面与媒体门禁 |
| 正式实现后验收 | Credential Family 轮换/重放/撤销立即生效；在已锁定且已通过大陆网络门禁的媒体项目验证撤销能移除活动参与者，且已签发但未加入的本次媒体凭据无法加入；以锁定版本的 LiveKit React Native SDK 在真实签名 Android APK 与桌面验证连接前 E2EE、错误密钥失败和绝不降级；不透明唤醒无法触发业务状态转移；大陆 5G 与外部 Wi-Fi 的真实手机完整呼叫通过。 | Beta 0 手动二维码语音与 Beta 1 长期配对/重启恢复已在真机通过；异地一键呼叫、强制 E2EE、即时媒体撤销和大陆异地媒体仍待验收 |

## 当前人工边界

无需为观测改变日常习惯：接通电源时可正常使用，通勤时可以合盖带走。合盖期间桌面本就应被视为不可接听；唤醒后原型会把它记录为一次恢复样本，而不是失败。Owner 已于 2026-07-23 在累计 14.412 个清醒小时后授权最小正式资源部署；CLI 授权已完成，部署引导码必须仅在本机钥匙串保存，首次初始化时再由 Owner 手动确认恢复密钥已经外部保存。

## 长期配对实施进度（2026-07-23）

Owner 已将长期配对列为高优先级并明确要求在 CloudBase 正常使用观察期间并行推进。当前完成的是厂商无关的安全核心与客户端接缝，不是可用性宣称：

- Device Authorization Module 的内存测试 Adapter 已覆盖“扫码不授权”、桌面明确批准、批准幂等、2 分钟到期、新挑战使旧挑战失效、5 次错误短码、5 台手机上限和独立设备撤销。
- 厂商无关 HTTPS 合约已验证桌面创建/批准响应不含 Device Credential，只有持有候选临时回执的获批安装可领取自己的凭据。
- HTTPS 合约已增加桌面待审读取：现有桌面能读取候选的最小标签、设备类型、两端校验码和挑战终态，但拿不到候选回执或任何 Device Credential。
- Android 已引入 Expo SecureStore 和 Expo Crypto；安装实例 ID 与获批凭据进入 Android Keystore 加密存储，卸载后不会从 Android Auto Backup 恢复旧身份。
- Android HTTPS 配对客户端已实现邀请解析、认领、校验码等待、结果领取和批准后安全保存；现有 UI 已能区分长期配对与 Beta 0 通话二维码，显示两端校验码、等待桌面决定并在成功后显示已配对。
- 桌面 Device Credential 已有系统安全存储 Adapter：macOS 使用 Keychain 设备绑定加密，安全存储不可用时禁止降级；桌面 HTTPS 客户端只在主进程内部把凭据放入授权请求头，向界面返回的对象不含凭据。
- 单 Owner 持久化事务 Module 和 CloudBase 数据库 Adapter 已在本地完成：不同函数实例可接续同一挑战，并发批准只有一个幂等设备结果；批准/拒绝终态清除邀请、短码与校验码资料。候选凭据由未持久化 Candidate Receipt 在领取时确定性派生，数据库只有回执哈希和凭据哈希，不保存明文或可解密副本。
- CloudBase Node 20 函数部署包已经生成并锁定依赖，本地依赖审计为 0 个已知漏洞。首次 Owner 初始化后端也已完成：部署引导码只保存 SHA-256 验证值，只允许空环境初始化一次；首台桌面凭据与 Owner Recovery Key 只返回一次，持久状态不含明文；恢复密钥确认前禁止新增桌面。
- 桌面首次初始化界面与安全 IPC 已完成：未授权桌面可以输入控制面 HTTPS 地址、一次性部署引导码和桌面名称；主进程把签发的 Device Credential 直接写入 macOS 钥匙串，Renderer 永远拿不到该凭据。Owner Recovery Key 只展示一次，页面随机选择 4 个正文字符位置，用户从外部保存副本中正确填写后才调用控制面确认；确认或取消都会清除页面明文，已配对桌面也可以用外部保存的完整密钥补做确认。
- Owner Recovery 的领域事务、HTTPS 入口、桌面主进程客户端和界面已经完成本地验证：45 秒内存在桌面可用租约时拒绝恢复；租约全部失效后撤销旧桌面、作废未终态挑战、保留手机但标记重新审查，并立即签发新桌面凭据和替代恢复密钥。同一恢复回执重试幂等，旧密钥换回执重放失败；替代密钥仍必须完成一次性保存确认。
- 桌面可用性协调器已完成本地验证：应用启动或首次配对后自动发现本机身份，清醒时每 30 秒续租，合盖/退出时停止并尽力清除，唤醒后显式恢复；10 秒请求超时和瞬时网络错误不会阻止后续重试，也不会记录原始运输层诊断。按单桌面 30 天持续在线保守估算，函数调用和事务数据库读写的刊例成本约每月 ¥4 以内，仍须由正式环境资源点增量验证。
- 设置页已经加入长期配对批准卡片：可显示二维码、备用短码、候选标签、两端校验码，以及“允许这台手机/拒绝”动作；它与 Beta 0 手动二维码通话明确分区。原始邀请与任何设备凭据不进入 Renderer IPC。
- 正式 CloudBase 授权函数、`/v1` 路由、Owner 初始化/恢复密钥确认和 Beta 1 Android 长期配对已经完成真实公网验收。Owner 在关闭并重新打开 Android 应用后仍保持已配对，证明获批 Device Credential 能从 Android 安全存储恢复；该证据不覆盖卸载重装，卸载重装仍按已确认规则视为新实例并要求重新配对。
- Android 首次请求曾在启用 VPN 时报告 `SSLHandshakeException: connection closed`；关闭 VPN 后同一正式 Origin 完成长配对，服务端证书链、域名匹配和 TLS 1.2/1.3 已独立验证。该结果只说明本次 VPN 路径干扰 TLS，不能替代后续中国大陆 5G、家庭宽带与外部 Wi-Fi 的异地媒体门禁。
- 长期配对后的一键呼叫实现已进入 Beta 2：手机用 Device Credential 发起幂等 Call，桌面轮询权威 HTTPS 状态并在本机 ASR/模型/TTS 就绪时自动确认；当前活动角色在确认时锁定并动态回传名称。手机和桌面分别一次性领取自己的 30 秒 AES-256-GCM 加密 Media Join Grant，数据库不保存明文 Token 或 E2EE Key。
- 双端只有在 LiveKit SDK 明确报告指定对端已加密后才上报媒体就绪；两端均确认后 Call 才进入 `ACTIVE`。加密错误、错误密钥、未加密对端、信封过期/重复领取均 fail-closed，禁止降级。211 个测试文件共 1270 项回归、桌面正式构建和 Android 类型检查已通过，正式 CloudBase 函数已更新且原环境/路由仍正常。
- Beta 2 Android 1.0.2（versionCode 3）已进入 EAS 构建队列。尚未完成的是 Owner 在真实公网的一键呼叫/桌面自动接听验收、错误密钥与实际撤销的端到端破坏性演练、大陆 5G/家庭宽带/外部 Wi-Fi 媒体矩阵，以及将 Beta 阶段的短周期 HTTPS 桌面探测替换为已通过原型边界的 Opaque Wake Signal 正式 Adapter。

## 受限 Beta 正式资源部署（2026-07-23）

Owner 明确授权后，环境 `cyrene-agent-d2gfztehj201e3df3` 已创建以下正式资源：

- Event 函数 `cyrene_device_authorization_control`：Node.js 20.19、128 MB、5 秒超时、`entry.main`，状态 `Active / Available`。
- HTTP Access Service 路由 ID `cebb9079-39d6-4544-9cdc-f04ef2002a5e`：`/v1` → `cyrene_device_authorization_control`。
- 正式 Origin：`https://cyrene-agent-d2gfztehj201e3df3-1456695787.ap-shanghai.app.tcloudbase.com`。

体验套餐在 CLI 对已为 Enabled 的 HTTP Access Service 再次执行“Enable”时返回 `OperationDenied.FreePackageDenied`，但没有关闭或改变服务；随后创建 `/v1` 路由成功。实测网关会从 Event `path` 剥离路由前缀，因此只在 CloudBase Adapter 层还原 `/v1`，厂商无关合约未改变。使用格式正确但哈希错误的 Deployment Bootstrap Code 请求正式 `/v1/owner/bootstrap`，公网返回 `401 DEPLOYMENT_BOOTSTRAP_REQUIRED`，并带 `cache-control: no-store`、JSON Content-Type 与 `x-content-type-options: nosniff`。

真实 Deployment Bootstrap Code 明文只保存在 macOS 钥匙串服务 `Cyrene Deployment Bootstrap Code - cyrene-agent-d2gfztehj201e3df3`；函数环境变量只有 SHA-256 Base64URL 验证值，部署输出和聊天均未出现明文。Owner 随后单独授权创建 `cyrene_device_authorization` 集合；`CreateTable` 请求 `36e0853e-ac88-44cf-983e-e507d58444b9` 成功，`DescribeTable` 复核集合存在且只有系统 `_id` / `_openid` 索引，`DescribeDatabaseACL` 复核为 `ADMINONLY`。此后 Owner 初始化、Recovery Key 外部保存确认、桌面授权与 Android 长期配对均已成功写入该正式集合；观察原型函数、集合、用户和当前 epoch 始终未被正式资源部署改动。
