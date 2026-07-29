# ADR-0041：在应用层加密 LiveKit 通话数据包

- 状态：Accepted
- 日期：2026-07-27
- 决策者：Owner

## 背景

当前锁定的 `@livekit/rtc-node 0.13.31` 只能与 Android 端共同强制媒体帧 E2EE，不能为 LiveKit user data packet 提供对等的数据通道加密。新增的 Voice Conversation 目录含名称、摘要和轮数，继续使用明文 data packet 会让 LiveKit 基础设施看到这些角色私有元数据，违反本地优先和最小外传边界。

## 决策

1. 每通媒体授权中的 32 字节 E2EE key 同时作为 HKDF 输入，但不直接作为数据加密密钥。
2. HKDF-SHA-256 派生独立的“桌面到手机”和“手机到桌面”密钥，防止跨协议复用和反射。
3. 每个 data packet 使用 XChaCha20-Poly1305 和新的 24 字节随机 nonce；版本、方向和密文都受认证，篡改或方向错误时 fail closed。
4. 应用层信封只包装 `cyrene.call.control` 与 `cyrene.call.event`；HTTPS 权威状态和媒体帧继续使用各自已有安全边界。
5. 单个可靠包不超过 LiveKit 建议的 15 KiB。Voice Conversation Catalog 每页最多 12 条，只传标题、摘要、轮数和时间；完整 Turn 历史不发送到手机。12 条上限同时覆盖标题和摘要全部使用四字节 Unicode 的最坏情况。
6. 桌面和手机依赖同一锁定版本的、已审计的 `@noble/ciphers` 与 `@noble/hashes`，不自行实现密码学原语。

## 后果

- LiveKit 仍能看到 data packet 的时间、大小、topic 和参与者路由，但不能读取控制命令、会话名称或摘要。
- 媒体与数据都依赖同一通话主密钥的可用性，但使用 HKDF 隔离后的方向密钥。
- 旧客户端无法解析新信封，必须与对应桌面版本一起升级。
- XChaCha20-Poly1305、HKDF 和分页协议成为移动通话的兼容性门禁，升级时必须做跨端已知向量、篡改拒绝、单包上限和真机续聊验证。

## 参考

- [noble-ciphers 官方说明](https://github.com/paulmillr/noble-ciphers)
- [LiveKit Data packets 的 15 KiB 限制](https://docs.livekit.io/transport/data/packets/)
