# E2EE 媒体加入授权契约

> 状态：厂商无关的设计契约，不是正式接口、SDK 代码或密钥管理实现授权。领域含义以 [CONTEXT.md](../../CONTEXT.md)、[ADR-0030](../adr/0030-let-only-the-public-control-plane-sign-livekit-tokens.md) 与 [ADR-0033](../adr/0033-enable-livekit-end-to-end-encryption-for-every-call.md) 为准。每通 E2EE、禁止降级与方案 A 的直接密钥分发已确认；控制面是短暂可读本通共享密钥的受信组件，详见 [密钥分发信任边界](e2ee-key-distribution-trust-boundary.md)。

## 已知基础与已确认边界

LiveKit 的内置 E2EE 覆盖媒体与数据通道，但每个参与端都必须配置相同的密钥；密钥的生成、存储和安全分发由应用负责，LiveKit 不保存或传输它。[LiveKit Encryption Overview](https://docs.livekit.io/transport/encryption/) 官方的共享密钥路径要求端点在连接前配置 key provider 与 E2EE；需要逐参与者密钥或通话中的密钥轮换时，才需要自定义 key provider。[LiveKit E2EE Guide](https://docs.livekit.io/transport/encryption/start/)

因此 V1 的每个 LiveKit Media Session 使用独立随机共享密钥和 LiveKit 的内置共享密钥路径，而不自研 MLS、MEGOLM、逐参与者密钥或通话中手动轮换。单 Owner、严格一对一且 4 小时上限使这比引入尚未验证的自定义 key provider 更小、更可验收；这不是降级，双方仍必须全程启用 E2EE。若未来需要通话内轮换或多人媒体，必须单独选择并验证自定义 key provider，不能静默把共享密钥复用到另一通电话。LiveKit 当前官方加密指南还提供了使用 `useRNE2EEManager` 与共享密钥的完整 React Native 示例，因此 Android V1 可以把“真实签名 APK 双端 E2EE”列为可验证前提；仍须在锁定的 SDK 版本与实际设备上验收，不能把文档示例当成通过证据。

密钥的生成与分发是 LiveKit 之外的应用职责。Owner 已选择方案 A：控制面在 `CONNECTING_MEDIA` 生成本通 Call E2EE Key，并短暂在进程内存读取它，以两份独立、已认证的 HTTPS Media Join Grant 直接交给两个端点；它不写入持久层、审计、日志、URL 或二维码。其余生命周期约束如下。

## Media Join Grant 的领取与使用

1. 只有 Voice Call 已通过桌面预检并进入 `CONNECTING_MEDIA` 后，控制面才创建房间、两个 call-scoped participant identity、两个最小权限 LiveKit Token 与一份本次随机 Call E2EE Key；明文只在当前执行内存与两个指定端点的内存中出现。
2. 控制面以两个独立的、已认证的 HTTPS 响应分别形成 Media Join Grant；手机只能领取手机的 grant，桌面只能领取桌面的 grant。每份 grant 都有本端 Token 与同一份直接 Call E2EE Key；Token 初始加入有效期为 ADR-0030 已确认的 5 分钟。为适配无状态函数，grant 可按 ADR-0038 形成最长 30 秒、端点专属、单次领取的 AES-256-GCM 加密信封；数据库、日志与审计仍不得出现明文 grant。
3. 同一端因 HTTPS 重试只能在同一尚未终态的 call-scoped 幂等结果窗口内重新取得自己的同一 grant；它不能借此取得对端 Token、另一通电话的密钥，或在 `ENDED` 后重新领取资料。
4. 每个端点先在内存创建带 E2EE 的 LiveKit Room/key provider、设置本次密钥并启用 E2EE，再使用自己的 Token 连接。双方都确认 E2EE 已启用且媒体连接成功后，控制面才把 Voice Call 转为 `ACTIVE`。
5. 任何端点不支持 E2EE、无法配置同一密钥、E2EE 状态不成立、媒体服务明确拒绝本次新会话容量，或媒体无法在 30 秒内建立时，Voice Call 分别以 `E2EE_REQUIRED`、`MEDIA_CAPACITY_UNAVAILABLE` 或 `MEDIA_CONNECT_TIMEOUT` 结束；不得调用“关闭加密后继续”的 SDK 路径，也不得因容量拒绝自动购买或升级。

## 重连、挂起、撤销与销毁

- 正常的 30 秒 LiveKit 媒体重连只能继续使用端点内存中已有的本次 key provider 与同一 LiveKit Media Session；控制面断线而媒体正常时不重新领取或重发密钥。
- 如果端点丢失内存状态、桌面发生 Desktop Suspension 后旧通话已不能按既有媒体规则恢复，或移动端连续后台超过 10 秒，则该端不得以旧 Media Join Grant 重新构造 Room；现有 Voice Call 结束，下一次通话必须创建新的 Call Request、新房间、身份、Token 和密钥。
- Device Revocation、Authorization Rebootstrap、取消、超时或其他 `ENDED` 终态会让控制面停止 grant 领取、端点立即清除内存中的 Token/密钥，并按已选媒体服务的已验证撤销路径移除两个 call-scoped identity。在当前已核验候选中，只有 LiveKit Cloud 的身份级撤销能力有该公开证据，且它仍须通过大陆网络与预加入撤销门禁，见 [LiveKit Cloud 中国大陆网络与成本闸门](livekit-cloud-mainland-network-and-cost-gate.md)；终态不能被密钥、缓存 Token、`watch()` 信号或唤醒事件复活。
- 控制面在签发期间短暂接触共享密钥是已确认的方案 A 边界，但它不得把明文密钥写入持久层、审计、日志、URL、二维码、错误正文或崩溃报告；唯一允许的持久形态是 ADR-0038 的短时加密信封。资料领取窗口结束、撤销、授权重建或其他终态时，控制面与两个端点都必须清除信封和内存密钥；不能把“LiveKit E2EE 已开启”误述为“控制面从未读取密钥”。

## 最小审计与后续验收

Security Audit Event 只可记录 Voice Call、端点类别、grant 已签发/已拒绝、E2EE 成功或终态理由与时间；不得记录 Token、房间 URL、participant identity、密钥、密钥哈希或媒体内容。

正式实现后至少验证：Android 独立 APK 与桌面都在连接前配置 E2EE、错误密钥无法形成可用媒体、任一端 E2EE 初始化失败时没有明文回退、重连不重新分发或持久化密钥、Desktop Suspension 后不复活旧会话、撤销时活动参与者被移除且已签发未加入的 Token 不能加入，以及 URL、二维码、数据库、日志和审计均检索不到 Token 或密钥。React Native 的实际 E2EE API 以届时锁定的 LiveKit SDK 版本为准，不能把网页 worker 示例直接当成 Android 验收证据。
