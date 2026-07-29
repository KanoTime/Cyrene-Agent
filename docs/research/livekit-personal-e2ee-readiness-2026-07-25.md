# LiveKit 个人双设备 E2EE 就绪方案研究

> 日期：2026-07-25
> 范围：固定 Android 手机 + Mac 桌面、LiveKit Cloud、严格一对一语音、每通共享密钥、强制 E2EE。
> 状态：仅研究；没有修改产品代码、依赖、云资源或运行配置，也没有把静态源码结论冒充实机通过。
> 资料边界：只引用 LiveKit 官方文档、官方 SDK 源码、官方 issue / PR。

## 结论

此前提出的三个修复方向并非都可以原样采用：

1. **改写 E2EE 就绪握手可以生效，但不能继续依赖 React Native 的远端 `ParticipantEncryptionStatusChanged`。** 在项目锁定的 `@livekit/react-native@2.11.1` 与 2026-07-25 当前上游中，订阅远端加密轨只会安装接收 cryptor，不会自动发出远端参与者加密状态事件。因此等待“本机事件 + 远端事件”必然可能永远不完成。
2. **移动端读取控制面权威终态值得保留。** 它解决结束数据包丢失后页面永久停留在“正在说话/通话已结束”的一致性问题，但不解决 E2EE 本身。
3. **回归测试值得保留，但纯 TypeScript 模拟不能证明 Android 原生 cryptor 工作。** 最终仍需一台真实 Android 手机与当前 Mac 完成正确密钥、错误密钥、网络恢复和三轮通话验收。

针对个人固定双设备场景，推荐的最小可靠方案不是维护 LiveKit SDK fork，而是：

- 继续复用 LiveKit 内置共享密钥 E2EE；
- 用本机 E2EE 已启用、双方音轨均声明为 GCM 加密、身份严格匹配作为静态门槛；
- 用 **E2EE 数据通道上的双向 nonce challenge/ack** 作为双方持有同一密钥且数据加解密双向可用的动态证明；
- 由受信的桌面端向控制面提交一次权威 `media-ready`；
- 把音频首帧/实际播放作为 `ACTIVE` 后的健康信号，不再让一个 SDK 不会产生的事件阻塞 30 秒建连期限；
- 未见对端时保留有界超时，双方已加入并开始握手后不再用固定 30 秒“墙钟”截断正在进行的对话。

这比修改两个 SDK 的 native/FFI 状态上报链更适合当前个人项目。它不能严格证明“Android 已经成功解密第一帧桌面音频”，但能证明双方身份、轨道加密声明、共享密钥一致和 E2EE 数据双向可用；对固定双设备的一对一语音，这是安全性、稳定性和维护成本之间更合理的最小闭环。

## 1. `ParticipantEncryptionStatusChanged` 的真实语义

### 1.1 React Native 2.11.1

项目安装包对应的发布提交是 `3694d974f6e3180a475c821aded302f44cc0f5b9`。

`RNE2EEManager` 在 `TrackSubscribed` 时只调用 `setupE2EEReceiver`；后者看到 `publication.isEncrypted` 后创建并启用接收 `RTCFrameCryptor`。这条路径没有调用 `setParticipantCryptorEnabled`，也没有发出远端 `ParticipantEncryptionStatusChanged`：

- [RN 2.11.1：订阅监听](https://github.com/livekit/client-sdk-react-native/blob/3694d974f6e3180a475c821aded302f44cc0f5b9/src/e2ee/RNE2EEManager.ts#L76-L113)
- [RN 2.11.1：创建接收 cryptor](https://github.com/livekit/client-sdk-react-native/blob/3694d974f6e3180a475c821aded302f44cc0f5b9/src/e2ee/RNE2EEManager.ts#L140-L161)

`ParticipantEncryptionStatusChanged` 只在 `setParticipantCryptorEnabled` 内发出；manager 自动调用该方法的路径是 `SignalConnected`，传入的是**本机** identity。[RN 2.11.1：状态事件实现](https://github.com/livekit/client-sdk-react-native/blob/3694d974f6e3180a475c821aded302f44cc0f5b9/src/e2ee/RNE2EEManager.ts#L282-L313)

因此：

- 本机 `true` 表示本机 manager/cryptor 被设为启用；
- 远端事件不会因加密轨订阅而自动出现；
- 即使业务代码主动用远端 identity 调用内部 setter，得到的也只是“设置/标记已启用”，不是收到或成功解密媒体帧的证明。

### 1.2 当前上游

截至本研究日期，React Native 当前提交 `8a105f01b877b874b44a709d39b20591352642ec` 的上述实现与 2.11.1 相同：

- [当前上游：订阅监听](https://github.com/livekit/client-sdk-react-native/blob/8a105f01b877b874b44a709d39b20591352642ec/src/e2ee/RNE2EEManager.ts#L76-L113)
- [当前上游：接收 cryptor](https://github.com/livekit/client-sdk-react-native/blob/8a105f01b877b874b44a709d39b20591352642ec/src/e2ee/RNE2EEManager.ts#L140-L161)
- [当前上游：状态事件实现](https://github.com/livekit/client-sdk-react-native/blob/8a105f01b877b874b44a709d39b20591352642ec/src/e2ee/RNE2EEManager.ts#L282-L313)

所以单纯升级 `@livekit/react-native` 不能解决当前死等。

### 1.3 JS 与 rtc-node 也不能把该事件解释成“成功解密”

浏览器 JS SDK 的 manager 在收到 worker 的 `enable` 回执后转发参与者加密状态；worker 的 `enable` 处理是更新 enable map 并回执，不是等待解密成功帧：

- [JS E2EE manager 转发 enable](https://github.com/livekit/client-sdk-js/blob/48f9b8ab0a8a829bf698023a5f44604d3a9d192c/src/e2ee/E2eeManager.ts#L183-L214)
- [JS E2EE worker 的 enable/ack](https://github.com/livekit/client-sdk-js/blob/48f9b8ab0a8a829bf698023a5f44604d3a9d192c/src/e2ee/worker/e2ee.worker.ts#L41-L65)
- [JS Room 只转发 manager 事件](https://github.com/livekit/client-sdk-js/blob/48f9b8ab0a8a829bf698023a5f44604d3a9d192c/src/room/Room.ts#L485-L515)

rtc-node 同样只是把 Rust FFI 的布尔值转成 Room 事件。[rtc-node 当前事件转发](https://github.com/livekit/node-sdks/blob/0dbe1c689c0bb956da3b7e0cec64e5816bec7153/packages/livekit-rtc/src/room.ts#L858-L868) Rust 端该布尔值依据参与者 publication/data 的 encryption type 计算，并不读取某个媒体帧的解密结果。[Rust SDK 参与者加密状态](https://github.com/livekit/rust-sdks/blob/614c99a74f9d6d5a75a9a9f2065ce471f02a508a/livekit/src/room/participant/mod.rs#L347-L373)

**结论：该事件适合显示“端点/轨道配置为加密”，不适合做“双方已经成功解密媒体”的证明。**

## 2. 各种信号能证明什么

| 信号 | 可以证明 | 不能证明 | 是否适合作为唯一 ready |
| --- | --- | --- | --- |
| 本机 `ParticipantEncryptionStatusChanged(true)` | 本机 E2EE manager/cryptor 被设为启用 | 密钥与对端一致；远端媒体已解密 | 否 |
| 远端 `ParticipantEncryptionStatusChanged(true)` | 在能产生该事件的 SDK 中，通常表示对端 publication/cryptor 被标成启用 | 已收到媒体帧；已成功解密；RN 自动产生该事件 | 否 |
| `TrackSubscribed` | 已建立远端轨订阅并取得 track/publication 对象 | 轨道一定加密；收到帧；解密成功；音频已播放 | 否 |
| `publication.isEncrypted` | 轨道协议元数据中的 encryption type 不是 `NONE` | 本机已安装 cryptor；正确密钥；成功解密 | 否 |
| 没有 `EncryptionError` | 目前没有被 SDK 上送的错误 | RN/Node 底层没有错误；密钥正确；媒体可用 | 否 |
| 加密 data challenge/ack | 双方收发 E2EE 数据包成功，双方持有可互操作的共享密钥；challenge 与当前会话绑定时还能防止重放/串会话 | 音频 cryptor 已成功解密某一帧；扬声器真的发声 | 可作为个人场景的动态主证明，但需叠加加密轨检查 |
| 接收端首个可读音频帧 / cryptor `OK` | 相应方向的媒体 cryptor 已处理出可用帧 | 另一方向也正常；扬声器硬件一定播放 | 严格方案的媒体证明 |
| 用户实际听到声音 | 完整桌面→手机业务路径、媒体解密、解码和播放成功 | 自动化、每次连接前可判定 | 实机最终验收 |

### 2.1 `publication.isEncrypted`

`TrackPublication.isEncrypted` 的实现只是检查 `this.encryption !== Encryption_Type.NONE`。[JS 2.20.2 源码](https://github.com/livekit/client-sdk-js/blob/48f9b8ab0a8a829bf698023a5f44604d3a9d192c/src/room/track/TrackPublication.ts#L95-L101) RN manager 也只是据此决定是否创建接收 cryptor。

因此它是必要的 fail-closed 静态检查：任何语音 publication 为 `NONE` 都应立即拒绝；但它不是密钥正确或解密成功的证据。

### 2.2 `EncryptionError`

RN 底层 `RTCFrameCryptor` 实际具备 `Ok`、`EncryptionFailed`、`DecryptionFailed`、`MissingKey`、`InternalError` 等状态并发出 `framecryptorstatechanged`。[官方 RN WebRTC cryptor 类型](https://github.com/livekit/react-native-webrtc/blob/2edc2f064418a1924a13e0a6d86393f6e01735f8/src/RTCFrameCryptor.ts#L38-L50)、[状态事件](https://github.com/livekit/react-native-webrtc/blob/2edc2f064418a1924a13e0a6d86393f6e01735f8/src/RTCFrameCryptor.ts#L140-L163)

但 `RNE2EEManager` 创建 cryptor 后没有监听这个事件，也没有据此发出 `EncryptionError`。rtc-node 的底层 Rust manager 同样能产生 `Ok`、`DecryptionFailed`、`MissingKey` 等状态，[Rust manager 源码](https://github.com/livekit/rust-sdks/blob/614c99a74f9d6d5a75a9a9f2065ce471f02a508a/livekit/src/room/e2ee/manager.rs#L204-L210)，但当前 Node wrapper 只把 `INTERNAL_ERROR` 转成泛化错误，其他状态被忽略。[rtc-node wrapper](https://github.com/livekit/node-sdks/blob/0dbe1c689c0bb956da3b7e0cec64e5816bec7153/packages/livekit-rtc/src/room.ts#L820-L824)

因此在当前依赖下，“没有 `EncryptionError`”不能作为正面成功证据。

官方 React Native issue 也提供了现实例证：E2EE 曾出现没有应用层错误却冻结/无视频的 native cryptor 问题，[issue #190](https://github.com/livekit/client-sdk-react-native/issues/190)；另有报告记录加入 E2EE 房间时先出现无法解码噪声、数秒后才恢复，[issue #303](https://github.com/livekit/client-sdk-react-native/issues/303)。它们不能直接证明本项目故障，但支持“配置/订阅完成与 cryptor 真正可用不是同一个时刻”的判断。

### 2.3 E2EE data challenge/ack

LiveKit 官方说明：使用新的 `RoomOptions.encryption` 时，媒体和数据通道都使用 E2EE；信令/API 仍只有 TLS，不属于 E2EE。[官方加密概览](https://docs.livekit.io/transport/encryption/) 每个参与端都必须启用 E2EE，共享密钥由应用安全分发。[官方入门指南](https://docs.livekit.io/transport/encryption/start/)

在 JS 数据接收路径中，遇到 encrypted packet 时会先调用 E2EE manager 解密，成功后才产生上层 `DataPacketReceived`。[JS 2.20.2 RTCEngine](https://github.com/livekit/client-sdk-js/blob/48f9b8ab0a8a829bf698023a5f44604d3a9d192c/src/room/RTCEngine.ts#L1012-L1047) RN 使用同一个 `livekit-client` 数据路径和自己的 `RNE2EEManager.handleEncryptedData`。

因此，手机收到桌面随机 nonce、回传绑定该 nonce 的 ack，桌面再发回手机 nonce 的 ack，可以证明：

- 两端 E2EE 数据发送和接收均工作；
- 两端拥有能相互加解密的本次共享密钥；
- 包确实来自持有本次房间凭据和密钥的一端；
- 如果 payload 绑定 `callId`、room、双方 identity、协议版本和两个 nonce，可防止旧通话 ack 被重放到新通话。

它不能证明：

- 音频 frame cryptor 一定已经处理成功；
- Android 扬声器一定播放；
- 网络之后不会中断。

所以 challenge/ack 应与 `TrackSubscribed + publication.isEncrypted` 组合使用，不应被描述成“媒体首帧证明”。

## 3. 个人双设备场景的四种实现

### 方案 A：继续等待双方 `ParticipantEncryptionStatusChanged`

**不采用。** RN 2.11.1 和当前上游不会自动给出远端事件，当前故障会复现。人为调用内部 setter 只会制造一个自证循环，安全价值也不足。

### 方案 B：维护 RN + rtc-node SDK 补丁，暴露每条 cryptor 的 `OK` / failure

这是最严格的实现：

- RN manager 监听每个发送/接收 `RTCFrameCryptor` 的原生状态；
- rtc-node wrapper 暴露 Rust 的 `Ok`、`MissingKey`、`DecryptionFailed` 等状态；
- 两端以各方向首个 `OK` 作为媒体已实际加解密的证明。

优点是证明力最强。缺点是需要维护 React Native WebRTC/LiveKit RN 和 rtc-node/FFI 两条补丁链；每次升级都要重做 native 真机回归。对于固定个人手机 + Mac、严格一对一、无第三方端点，这个维护成本明显超过当前收益。

如果未来的安全目标明确要求“每次通话进入 ACTIVE 前必须密码学证明双向媒体首帧”，才应选择该方案。也可以把 Android 端迁移到 LiveKit 原生 Kotlin SDK；官方 Android SDK公开 `E2EEState.OK`、`MISSING_KEY`、`DECRYPTION_FAILED` 等状态，[Android E2EEState](https://docs.livekit.io/reference/client-sdk-android/livekit-android-sdk/io.livekit.android.e2ee/-e2-e-e-state/index.html)，但为此迁移现有 RN 应用或编写 native module 仍不是最小修复。

### 方案 C：加密轨门槛 + E2EE data challenge/ack + 桌面单边权威 ready

**推荐。**

桌面端是 Owner 已授权、固定且直接运行语音处理的受信端点。它可以在以下条件全部成立后向控制面提交一次 `media-ready`：

1. 房间和参与者 identity 与本次 grant 完全匹配；
2. 手机与桌面的本地语音 publication 均为 GCM，不接受 `NONE`；
3. 双方已订阅对方的加密音轨；
4. 两个方向的 E2EE data nonce challenge/ack 完成；
5. 桌面没有收到明确的 E2EE failure，且能消费手机音频帧时将其作为额外健康证据。

这里“桌面单边”指**只有桌面负责向控制面提交最终状态**，不是只检查桌面自己。challenge/ack 仍需要手机真实参与。固定手机、固定桌面和每通唯一密钥使第三个端点无法冒充；控制面仍需验证提交者是本通桌面凭据。

优点：

- 不改 LiveKit SDK；
- 消除等待不存在事件造成的假超时；
- 能证明双方共享密钥和 E2EE data 双向可用；
- fail-closed 仍成立，未加密 publication 或 challenge 失败不会进入 ACTIVE；
- 与当前个人一对一信任模型匹配。

剩余风险：

- 不能在首个 TTS 前严格证明手机已成功解密桌面音频帧；
- 极少数媒体 cryptor 实现故障可能出现“data challenge 成功、媒体仍失败”。

该风险应由 ACTIVE 后的媒体健康 watchdog、首轮 TTS 播放确认和真机验收覆盖，而不是用一个不存在的 SDK 事件制造更差的可用性。

### 方案 D：只延长或移除 30 秒期限

**不能单独采用。** 它能避免正在生成/播放的第二轮被墙钟截断，却不能区分正确密钥、错误密钥、未加密轨或永远卡住的会话。

期限应改成状态驱动：

- 在没有对端加入时保留约 60–90 秒初始加入期限；
- 双方加入后，challenge/ack 使用独立短期限，例如 10–15 秒；
- 进入 ACTIVE 后不再受“从通话创建起固定 30 秒”的建连期限影响；
- ACTIVE 后使用现有重连宽限、控制面心跳和用户挂断处理；
- challenge 失败、未加密轨、identity 不符或明确加密错误立即 fail-closed。

LiveKit Token 的签发 TTL 只限制加入资格，不应被当作已加入通话的持续时长；控制面仍需保留自己的陈旧会话清理规则。

## 4. 推荐的最小握手协议

以下是设计建议，不是已实现接口。

### 阶段 1：连接前

1. 控制面为每通生成独立随机 E2EE key，并按现有 Media Join Grant 只交给手机与桌面内存。
2. 两端先配置 `RoomOptions.encryption` 与共享 key，再连接和发布麦克风/桌面语音轨。
3. 任何 key 配置失败不得回退到 `e2ee` 旧字段、未加密 Room 或 `Encryption_Type.NONE`。

### 阶段 2：静态 fail-closed 检查

双方检查：

- peer identity 等于 grant 中固定 identity；
- 本地 publication 为 GCM；
- `TrackSubscribed` 的远端 publication 为 GCM；
- 只允许预期的一对一两个参与者；
- 出现未加密语音 publication、额外参与者或 identity 不符时立即结束。

不要等待 RN 的远端 `ParticipantEncryptionStatusChanged`。

### 阶段 3：E2EE data 双向 challenge

使用 reliable、定向到唯一 peer 的数据包：

```json
{
  "type": "cyrene.e2ee.challenge",
  "version": 1,
  "callId": "<本次通话>",
  "room": "<本次房间>",
  "from": "<发送者 identity>",
  "to": "<接收者 identity>",
  "nonce": "<至少 128 bit 随机值>"
}
```

ack 必须原样绑定 challenge nonce，并带接收端自己的随机 nonce：

```json
{
  "type": "cyrene.e2ee.ack",
  "version": 1,
  "callId": "<本次通话>",
  "room": "<本次房间>",
  "from": "<接收者 identity>",
  "to": "<发送者 identity>",
  "challengeNonce": "<收到的 nonce>",
  "responderNonce": "<至少 128 bit 随机值>"
}
```

发起方再确认 responder nonce。只有两个方向都完成才通过。每个 nonce 只接受一次；超时、重复、串房间、错误 identity 或错误 callId 都失败。payload 不得包含 E2EE key、Token 或其哈希。

由于 `RoomOptions.encryption` 会使数据包在 SDK 内先 E2EE 解密再交给应用，成功往返本身已经是密钥持有证明；无需再自研第二套内容加密。可以额外做应用层 transcript 哈希以简化状态机审计，但不能记录 key 或完整敏感 payload。

### 阶段 4：权威状态与运行期健康

1. 桌面完成上述检查后，以本通桌面凭据向控制面提交 `ACTIVE`。
2. 手机定期读取控制面权威状态；控制面进入 `ENDED` 后，手机必须停止媒体并离开通话页面，不能只依赖 LiveKit data 结束通知。
3. data channel 通知用于低延迟 UI；控制面状态用于收敛。
4. 首个手机→桌面可读音频帧、首轮桌面→手机 TTS 完成、持续音频帧时间戳作为 ACTIVE 后健康信号；异常时显示明确“媒体异常/正在重连”，而不是永久“正在说话”。

## 5. 验收测试

### 自动化状态机测试

1. RN 只产生本机 `ParticipantEncryptionStatusChanged(true)`，但双方加密轨和 challenge/ack 成功：应进入 ACTIVE。
2. 永远没有远端 encryption status 事件：不得触发 `MEDIA_CONNECT_TIMEOUT`。
3. 任一 publication 为 `NONE`：立即 `E2EE_REQUIRED`，不发送/播放未加密媒体。
4. challenge 正确但 callId/room/identity 不符：拒绝。
5. nonce 重放：拒绝。
6. challenge 超时或只完成单向：不得 ACTIVE。
7. 控制面已 ENDED、LiveKit data 结束包丢失：手机轮询后仍应退出。
8. ACTIVE 后网络短断并在宽限期恢复：不得创建新 call、不得重新分发 key。

### 真实 Android + Mac 测试

1. 正确 key：连续至少五轮对话，包含一轮 GPT-SoVITS 生成超过 30 秒墙钟边界的情况；通话不得自动结束。
2. 错误 key：challenge/ack 失败并 fail-closed；手机不得听到可理解的桌面音频。
3. 手机端人为关闭 E2EE 或发布未加密轨：立即拒绝，不能回退。
4. 断开 VPN/切换 Wi-Fi 与 5G 后在重连宽限内恢复：同一通话继续；超出宽限才结束。
5. 丢弃一次 LiveKit `bridge ended` data 消息：控制面权威终态仍能让手机退出。
6. 检查日志、控制面记录和 UI：不得出现 key、Token、grant 明文或 nonce 之外的敏感材料。

### 通过标准

- 正确密钥五轮通话均无 30 秒误终止；
- 错误密钥、未加密轨、错误 identity 均 fail-closed；
- 手机与桌面显示的结束原因与控制面一致；
- 真实手机能听到昔涟每轮回复；
- 上述通过必须来自新 APK 和当前桌面运行包，不能只用单元测试替代。

## 6. 最终建议

本项目当前不应为了个人一对一使用而 fork LiveKit 两套 SDK，也不应只把 30 秒改成更大的数字。建议实施方案 C：

1. 删除“必须收到 RN 远端 `ParticipantEncryptionStatusChanged`”这一门槛；
2. 保留本机 E2EE 和双方 `publication.isEncrypted` 的 fail-closed 检查；
3. 增加双向 E2EE data nonce challenge/ack；
4. 由桌面汇总后单次上报控制面 ready；
5. 改为分阶段期限，并让手机轮询控制面终态；
6. 用真实 Android + Mac 的错误 key 与五轮通话完成最终验收。

若实机仍出现“challenge 成功但手机无声”，再升级到方案 B：先只为 RN manager 接出 `RTCFrameCryptorState.OK/DECRYPTION_FAILED`，用小范围 patch 证明问题，再决定是否长期维护 SDK fork。不要在没有该证据前直接迁移整个移动端或重写媒体栈。
