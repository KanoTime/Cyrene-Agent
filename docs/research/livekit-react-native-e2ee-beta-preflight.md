# LiveKit React Native E2EE Beta 1 兼容性预检

> 状态：仅研究与版本预检，未修改产品代码、依赖、Expo/EAS 凭据或云资源；**没有启用、构建或实机测试 E2EE**。结论适用于 2026-07-23 工作树中锁定的依赖版本。V1 已确认采用方案 A：控制面可在内存中短暂读取每通 `Call E2EE Key`，但密钥绝不进入 URL、二维码、持久层、审计或日志，详见 [ADR-0033](../adr/0033-enable-livekit-end-to-end-encryption-for-every-call.md)。

## 结论

**Android Beta 1 具备接入 LiveKit 内置共享密钥 E2EE 的依赖与 Expo 原生基础，但不能直接把 Beta 0 的 `<LiveKitRoom connect audio>` 加一项 `options` 就宣称安全。** 当前锁定的 React Native SDK 已导出 `useRNE2EEManager`、`RNKeyProvider` 和 `RNE2EEManager`，其 WebRTC 依赖也包含 Android `FrameCryptor` / data-packet cryptor 原生实现；现有 Expo config plugins 已配置，未发现 E2EE 额外需要的新 Android 权限或手写原生文件。

不过，严格的“禁止降级”需要一个受 Cyrene 控制的连接前门槛：先把每通密钥写入端点内存、创建带 `encryption` 的 `Room`、显式 `await room.setE2EEEnabled(true)`，再允许连接和开麦。错误密钥、缺少密钥、加密状态不成立或加密握手超时，都必须结束为 `E2EE_REQUIRED`，而不是继续普通 LiveKit 通话。此判断来自锁定源码，不是对官方网页示例的猜测。

## 已核对的版本与兼容性

本轮只读检查了 [mobile/package.json](../../mobile/package.json)、[mobile/package-lock.json](../../mobile/package-lock.json)、[mobile/app.json](../../mobile/app.json) 与已安装模块；`npm ls` 对下列顶层依赖无冲突。

| 项目 | 已锁定版本 | 预检结论 |
| --- | ---: | --- |
| Expo | `56.0.16` | 与 `@config-plugins/react-native-webrtc@15.0.1` 的 `expo: ^56` peer range 匹配。 |
| React / React Native | `19.2.3` / `0.85.3` | 与 Expo 56 已安装的 bundled native modules 一致；LiveKit RN 的 peer range 接受任意 React Native。 |
| `@livekit/react-native` | `2.11.1` | 已导出实验性 `useRNE2EEManager`、`RNKeyProvider`、`RNE2EEManager`。它要求 `@livekit/react-native-webrtc ^144.1.1` 与 `livekit-client ^2.19.0`。 |
| `@livekit/react-native-webrtc` | `144.1.1` | 满足上述 peer range；源码含 Android `RTCFrameCryptorFactory`、`RTCKeyProvider` 与 data-packet cryptor bridge。 |
| `livekit-client` | `2.20.2` | 满足 LiveKit RN 的 peer range；`RoomOptions.encryption` 支持 React Native 的 `{ e2eeManager }` 形式。 |
| `@livekit/react-native-expo-plugin` | `1.0.2` | 已在 `app.json` 注册；官方插件为 Expo Application lifecycle 调用 LiveKit 原生初始化。 |
| `@config-plugins/react-native-webrtc` | `15.0.1` | 已在 `app.json` 注册，且已覆盖录音、网络、音频设置、唤醒锁等 WebRTC 权限。 |

官方源码与本地安装包版本可一一对应：[`@livekit/react-native@2.11.1`](https://github.com/livekit/client-sdk-react-native/tree/%40livekit/react-native%402.11.1)、[`livekit-client@2.20.2`](https://github.com/livekit/client-sdk-js/tree/v2.20.2)、[`@livekit/components-react@2.9.23`](https://github.com/livekit/components-js/tree/%40livekit/components-react%402.9.23) 和 [LiveKit Expo plugin `v1.0.2`](https://github.com/livekit/client-sdk-react-native-expo-plugin/tree/v1.0.2)。

### Expo / Android 原生前置是否已满足

- LiveKit 官方 React Native README 明确说明 Expo 只能使用 development build / 原生构建，并要求入口最先调用 `registerGlobals()`；当前 [mobile/index.ts](../../mobile/index.ts) 已这样做，且 Beta 0 已用 EAS 内部发行 APK 做过普通语音实测。[官方 README](https://github.com/livekit/client-sdk-react-native/blob/%40livekit/react-native%402.11.1/README.md)
- `@livekit/react-native-expo-plugin` 已负责 Android `LiveKitReactNative.setup(...)` 的 Application lifecycle 初始化；`@config-plugins/react-native-webrtc` 已负责 WebRTC 需要的权限。两者的官方源码没有声明 E2EE 额外的 Android manifest permission 或独立 Gradle 开关。[LiveKit Expo plugin 源码](https://github.com/livekit/client-sdk-react-native-expo-plugin/blob/v1.0.2/android/src/main/java/io/livekit/reactnative/expo/LiveKitApplicationLifecycleListener.kt)、[WebRTC Expo plugin 源码](https://github.com/expo/config-plugins/tree/main/packages/react-native-webrtc)
- Expo 说明 config plugin 会在 CNG 的 prebuild / EAS Build 时应用，并且含原生代码的库需要原生开发/发行构建，不能以 Expo Go 验证。[Expo：使用 config plugins](https://docs.expo.dev/config-plugins/plugins/)、[Expo：添加原生代码](https://docs.expo.dev/workflow/customizing/)

因此，**E2EE 不要求为 Android 再设计一套原生接入；Beta 1 仍必须产生新的签名 APK 来验证新 JavaScript/房间配置路径。** `@config-plugins/react-native-webrtc` 的公开版本表主要列的是上游 `react-native-webrtc`，而本项目使用 LiveKit fork `144.1.1`；这不是已证实的不兼容，但意味着不能用“Beta 0 普通通话成功”替代真实 E2EE APK 验收。

## 锁定版本中的 E2EE API 形态

### 可复用的部分

1. `useRNE2EEManager({ sharedKey, keyProviderOptions? })`：返回 `keyProvider` 与 `e2eeManager`；`sharedKey` 可为 `string | Uint8Array`。这是 LiveKit 官方 React Native 的共享密钥入口，标为 `@experimental`。[锁定源码](https://github.com/livekit/client-sdk-react-native/blob/%40livekit/react-native%402.11.1/src/hooks/useE2EEManager.ts)
2. `RoomOptions.encryption = { e2eeManager }`：这是 `livekit-client@2.20.2` 为 React Native 定义的受支持形态。使用较新的 `encryption` 字段会使 data channel E2EE 打开；旧 `e2ee` 字段已被官方标记为弃用。[类型定义](https://github.com/livekit/client-sdk-js/blob/v2.20.2/src/e2ee/types.ts)、[Room 实现](https://github.com/livekit/client-sdk-js/blob/v2.20.2/src/room/Room.ts)
3. LiveKit 内置共享 key provider：与已确认的“一对一、每通独立、最长四小时、不做通话中轮换”的 V1 边界相符。LiveKit 要求应用自行生成和安全分发密钥；只有逐参与者密钥或通话中轮换才需要自定义 key provider。[LiveKit 加密指南](https://docs.livekit.io/transport/encryption/start/)、[加密概览](https://docs.livekit.io/transport/encryption/)
4. 现有 `registerGlobals()`、Expo plugins、麦克风权限、前台会话 UI、LiveKit data event 处理和 EAS preview APK 流程可继续复用。

### 不能照抄网页示例的关键差异

LiveKit 当前网页的 React Native 示例含 `dataChannelEncryption: true`，但**当前锁定的 `useRNE2EEManager@2.11.1` 类型只有 `sharedKey` 与可选 `keyProviderOptions`，没有该参数**；它内部以 `new RNE2EEManager(keyProvider, false)` 创建 manager，并异步调用 `setSharedKey`。[网页示例](https://docs.livekit.io/transport/encryption/start/)、[锁定 hook 源码](https://github.com/livekit/client-sdk-react-native/blob/%40livekit/react-native%402.11.1/src/hooks/useE2EEManager.ts)

这不是让 V1 关闭 data channel E2EE 的理由。锁定的 `Room` 源码会在使用 **`options.encryption`** 时把 `e2eeManager.isDataChannelEncryptionEnabled` 置为 `true`；不要给 hook 传未被类型支持的 `dataChannelEncryption`，也不要改用弃用的 `e2ee` 字段。[Room E2EE 初始化](https://github.com/livekit/client-sdk-js/blob/v2.20.2/src/room/Room.ts)

更重要的是，`useRNE2EEManager` 会把 `setSharedKey` 的异常吞为日志警告，且不返回“密钥已就绪/失败”状态。它适合复用 manager 的创建，但**单独使用它不足以构成 Cyrene 的 fail-closed 门槛**。

## 推荐的 Beta 1 fail-closed 连接顺序

这是一份实施前置，不是本轮实现方案代码。

1. `CONNECTING_MEDIA` 才由已认证控制面按方案 A 生成一份随机 `Call E2EE Key`，并通过两份独立 HTTPS `Media Join Grant` 仅送入手机和桌面内存；不得重用 Beta 0 的二维码 URL 作为 Token 或 key 载体。
2. Android 端先校验 grant 的 call / 端点 / 时限，以及 key 存在且格式符合本次固定编码；任何缺失或解析错误都不创建可连接的 Room。
3. 用锁定 SDK 的 `RNKeyProvider` / `RNE2EEManager`（可由 hook 包装，但必须有自建的 ready/error 状态）**等待** `setSharedKey` 成功；之后创建 `new Room({ encryption: { e2eeManager } })`，并在允许连接前 `await room.setE2EEEnabled(true)`。
4. 将这个预配置 Room 交给 UI，或保持 `connect={false}` 直到第 3 步成功。当前 `LiveKitRoom` 只会 `new Room(options)` 并在 `connect` 时调用 `room.connect()`；它不会替调用方执行 `room.setE2EEEnabled(true)`。而 `LocalParticipant` 的初始 encryption type 是 `NONE`，所以仅传 `options.encryption` 并不等于本地音轨必然以 GCM 发布。[`useLiveKitRoom` 源码](https://github.com/livekit/components-js/blob/%40livekit/components-react%402.9.23/packages/react/src/hooks/useLiveKitRoom.ts)、[`Room.setE2EEEnabled`](https://github.com/livekit/client-sdk-js/blob/v2.20.2/src/room/Room.ts)、[`LocalParticipant` 源码](https://github.com/livekit/client-sdk-js/blob/v2.20.2/src/room/participant/LocalParticipant.ts)
5. 只有手机和桌面都确认：本地 E2EE 状态为真、已发布/订阅的音轨标示为 encrypted、完成一轮双向加密音频探针，且收到 `GCM` encryption type 的应用层 challenge/ack，控制面才可将 Voice Call 改为 `ACTIVE`。`RoomEvent.Connected` 本身不充分。
6. `setSharedKey`、`setE2EEEnabled`、连接、加密事件、加密 data challenge、媒体就绪或 30 秒时限任一失败，立即断开、清除内存 key/token、记录无秘密的终态码 `E2EE_REQUIRED`；严禁调用 `setE2EEEnabled(false)`、移除 `encryption` 选项、重试为普通房间或显示“仍可继续未加密通话”。

错误 key 不一定会在连接瞬间被 SDK 拒绝。官方 Agents 文档明确说明：参与者可加入 E2EE 房间，但若 key 缺失或不匹配则无法解密入站媒体，进而没有转写或回复。[LiveKit：E2EE with agents](https://docs.livekit.io/transport/encryption/agents/)。另外，当前 RN `RNE2EEManager` 源码没有把底层 `RTCFrameCryptor` 的状态事件直接提升成可靠的应用层“key mismatch”结论；`LiveKitRoom` 只是把 `RoomEvent.EncryptionError` 转给 `onEncryptionError`，并不会主动断开。[RN manager 源码](https://github.com/livekit/client-sdk-react-native/blob/%40livekit/react-native%402.11.1/src/e2ee/RNE2EEManager.ts)、[`useLiveKitRoom` 源码](https://github.com/livekit/components-js/blob/%40livekit/components-react%402.9.23/packages/react/src/hooks/useLiveKitRoom.ts)。因此 `onEncryptionError` 应接入终止路径，但不能作为唯一错误探测；上述有界的双端加密 challenge 与媒体就绪门槛是必要的 Cyrene 自研编排。

## 复用、自研与不整套接入的边界

| 类别 | Beta 1 策略 | 原因 |
| --- | --- | --- |
| 复用 | LiveKit RN `RNKeyProvider` / `RNE2EEManager`、`RoomOptions.encryption`、native FrameCryptor、Expo plugins、EAS preview | 已安装且版本匹配，覆盖 Android 媒体与 data channel 的底层加密能力。 |
| 自研 | 方案 A 的一次性 Media Join Grant、连接前密钥就绪门槛、`E2EE_REQUIRED` 状态、双端 GCM challenge/ack、30 秒时限、密钥清除与无秘密审计 | LiveKit 明确把密钥生成/保存/分发留给应用；SDK 也不会把 Cyrene 的业务状态、撤销与零降级策略做完整。 |
| 不整套接入 | 不引入 MLS / MEGOLM / 自定义逐参与者 provider、设备 wrapping key、通话中 key rotation | V1 已限定为每通独立共享 key；这些能力会扩大到被暂缓的设备私钥生命周期、恢复与轮换。 |
| 不作为通过证据 | 当前 Beta 0 手动二维码普通通话、网页示例、单纯 `RoomEvent.Connected` | 它们都没有证明 Android 与桌面使用同一 key 后的加密媒体、data channel、错误 key 及无降级路径。 |

## Beta 1 开始实现前的最小前置与验收

1. 单独完成桌面 `@livekit/rtc-node@0.13.31` 的 E2EE API / native runtime 预检；本文件只证明 Android React Native 端具备候选 API，**没有证明桌面端已能使用同一共享 key**。
2. 固定本次 `Call E2EE Key` 的生成强度、二进制/字符串编码和桌面—Android 互操作格式；密钥值、哈希、Token、房间 URL 不得出现在测试夹具、日志或截图中。
3. 在正式控制面以外先完成可丢弃的双端实测：正确 key 的双向加密音频探针和 GCM data challenge；错误 key、缺少 key、主动禁用 E2EE、加密初始化失败均在 30 秒内 `E2EE_REQUIRED`，且不存在未加密音频或数据回退。
4. 使用新的 EAS signed preview APK 与实际 Android 设备验证；不使用 Expo Go，不把 Beta 0 的普通通话结果复用为 E2EE 通过证据。
5. 之后才接入方案 A 的 Media Join Grant、30 秒媒体建连、立即撤销、桌面挂起终态和中国大陆网络门禁；这些依旧受 [E2EE 媒体加入授权契约](e2ee-media-join-contract.md) 与现有控制面/媒体选择门禁约束。

## 本轮未覆盖的风险

- Android SDK 的源代码存在 FrameCryptor，并不等于目标机型、桌面 Node runtime、LiveKit 部署和网络路径已经互操作通过。
- 旧版本 hook 与当前网页示例的参数差异意味着升级依赖前必须重新跑本预检，不能宽泛地写成“LiveKit E2EE 示例可直接复制”。
- 方案 A 仍把控制面置于密钥分发信任边界内；LiveKit Cloud 无法读媒体，不等于控制面从未读过 key。
- 大陆网络、TURN、预加入撤销、长期设备配对、后台/锁屏通话和成本仍是独立门禁；本预检没有改变它们的状态。

## 推荐的下一步

先做桌面 `@livekit/rtc-node@0.13.31` E2EE 兼容性预检，并把 Android 与桌面共用的“连接前 key ready → 显式启用 E2EE → GCM challenge/ack → ACTIVE / E2EE_REQUIRED”写成一个可丢弃的双端原型验收协议。只有该协议在真实签名 APK、桌面端和目标网络上通过，才开始把它接入长期配对正式流程。
