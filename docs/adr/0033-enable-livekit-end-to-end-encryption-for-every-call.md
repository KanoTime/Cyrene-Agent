# 每通 LiveKit 电话启用端到端加密

> 状态：Owner 已于 2026-07-23 接受方案 A，并接受 ADR-0038 的短时加密媒体资料信封。每通 LiveKit E2EE 与“绝不降级”已确认；选定的公网控制面是短暂可读每通共享密钥的受信分发组件，但不持久化明文密钥。

V1 的每个 LiveKit Media Session 都启用 LiveKit E2EE，并为该通电话使用独立随机 Call E2EE Key；明文密钥不进入 URL、二维码、数据库、审计或日志，只在本次通话的两个端点和受信控制面的当前执行内存中出现，并在资料领取窗口结束或电话终态时丢弃。为适配 CloudBase 无状态、多实例调用，数据库只可短时保存 ADR-0038 定义的 AES-256-GCM 端点专属加密信封，最长 30 秒且单次领取。V1 使用 LiveKit 的内置共享密钥路径，不自研通话中轮换或逐参与者密钥；一对一、每通独立且最长 4 小时的边界使其可验收，未来多人或通话内轮换必须单独选择并验证自定义 key provider。只有手机和桌面都确认 E2EE 已启用后，Voice Call 才能进入 ACTIVE；不支持、密钥不匹配或初始化失败时必须终止，禁止静默或手动降级为普通传输加密。

端点就绪确认不得依赖某个 SDK 是否发出 `ParticipantEncryptionStatusChanged`：React Native LiveKit 2.11/2.12 在远端订阅路径不会可靠发出该回调。Android 端以“本机预连接启用 E2EE、本机麦克风音轨已作为 GCM 加密音轨发布、已订阅预期桌面身份的 GCM 加密音轨”作为接通硬门槛；桌面端保留 rtc-node 可观测的远端加密确认。进入 `ACTIVE` 后仍由原生 EncryptionError、真实解码音频流和 TTS playout 共同监测媒体健康，任何密码器失败都必须终止，不能降级。rtc-node 0.13.x 尚未提供与 Android 对称的数据通道 E2EE，因此 V1 不把数据 nonce 挑战伪装成媒体密钥证明；未来升级双方 SDK 后可把它增加为 `ACTIVE` 后健康检查，但不能在未验证跨端兼容前成为接通硬门槛。

在 `CONNECTING_MEDIA`，控制面生成本通 Call E2EE Key，并仅以手机和桌面各自已认证的 HTTPS Media Join Grant 直接送入端点内存；两份 grant 仍彼此隔离，不能换取对端 Token 或另一通电话的资料。此选择降低 V1 复杂度并符合暂缓 Device Credential 私钥绑定的范围，但其安全陈述必须精确：媒体对 LiveKit Cloud 端到端加密，而控制面本身不是零知识组件，短暂可以读取当前通话的密钥。控制面不得把密钥写入任何持久层、审计、日志、URL、二维码或错误正文；电话终态、撤销、授权重建或资料领取窗口结束后必须清除它。要求控制面永远不可读的端点间密封传递、设备 E2EE wrapping key 生命周期与恢复/轮换语义不属于 V1，未来如需采用必须单独决策与验证。具体比较见 [E2EE 密钥分发信任边界](../research/e2ee-key-distribution-trust-boundary.md)，领取、重连、撤销与清除的共同约束见 [E2EE 媒体加入授权契约](../research/e2ee-media-join-contract.md)。
