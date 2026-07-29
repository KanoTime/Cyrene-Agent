# Android EAS 构建与 E2EE：实现前闸门

> 状态：Android Beta 0 已交付可安装的 EAS 内部分发 APK，完成 Owner 真机手动二维码语音验收，并完成 release keystore 的 EAS 托管副本与仓库外加密副本双重保管；它不改变 V1 必须在连接前强制 E2EE 并锁定控制面后才开始长期配对实现的门槛。领域与不可逆取舍以 [CONTEXT.md](../../CONTEXT.md)、[ADR-0028](../adr/0028-build-the-first-android-release-with-eas-and-back-up-its-signing-key.md) 和 [ADR-0033](../adr/0033-enable-livekit-end-to-end-encryption-for-every-call.md) 为准。

## 已验证的 Beta 0 构建（2026-07-22）

`mobile/package.json` 已声明 `@livekit/react-native`、`@livekit/react-native-webrtc`、`@livekit/react-native-expo-plugin` 与 WebRTC config plugin，`mobile/app.json` 已登记原生插件，`mobile/eas.json` 已提供不含 `developmentClient` 的 `preview` Android APK 内部分发 profile。项目通过 TypeScript、Android 工具链和 Android bundle 检查后，EAS 成功生成独立 APK；本地 Android 工具确认包名 `com.cyrene.agent.voice`、版本 `1.0.0`，且 APK Signature Scheme v2 有一个有效签名者。

Owner 已在真实 Android 手机上安装并完成桌面二维码发起的前台语音通话，报告效果正常。该证据仅证明 Beta 0 的 Manual QR Voice Session 可安装、可加入当前短时房间并复用既有桌面语音桥接；它不证明 E2EE、长期 Device Credential、后台接听、即时撤销或异地大陆媒体可用。

EAS 托管 release keystore 已生成。2026-07-23 已在隔离目录导出 `credentials.json` 与 JKS，用 Android `keytool` 验证后生成仓库外 AES-256 加密归档，并以 macOS 钥匙串单独保存随机口令；归档解密与成员摘要复核通过，临时明文已删除，仓库中未留下 release 凭据。因此“签名密钥双重保管”闸门已经通过；任何凭据、`credentials.json` 或 release keystore 仍不得写入仓库。

## 可复用与不自研的部分

- **复用 EAS Build。** Expo 的 `eas.json` 在项目根目录配置构建 profile；`distribution: "internal"` 会产生可直接安装的 Android APK，且 EAS 可使用同一 application ID 的既有 Android keystore 或生成首个 keystore。[Expo：配置 `eas.json`](https://docs.expo.dev/build/eas-json/)、[Expo：内部发行](https://docs.expo.dev/build/internal-distribution/)
- **复用 LiveKit React Native 的内置共享密钥 E2EE。** 官方加密指南给出了 React Native `useRNE2EEManager` 的共享密钥示例；不需要为一对一 V1 自研 MLS、MEGOLM 或自定义 key provider。Owner 已选择方案 A：控制面以已认证的直接 Media Join Grant 提供每通共享密钥，并只在短暂进程内存中可读，绝不持久化。[LiveKit：开始使用加密](https://docs.livekit.io/transport/encryption/start/)
- **仍需自研 Cyrene 规则。** EAS 不知道 Owner、Device Credential、配对批准、Media Join Grant、撤销或通话状态机；LiveKit 也不生成或安全分发密钥。控制面、设备和媒体边界仍必须按既有 ADR 与契约实现，不能整套接入任一 SDK 来替代。

## 未来正式实现的最小构建轮廓

现有 `mobile/eas.json` 已具备一个不含 `developmentClient`、使用 `distribution: "internal"` 的 Android `preview` APK profile，用于个人内部分发及手动覆盖升级；后续构建必须保持既定的 `android.package` 和同一 release keystore。开发 profile 可保留 `developmentClient: true`，但不能被当成真实网络、签名或 E2EE 验收包。Expo 文档明确说明内部发行会生成 APK，而默认的商店方向 Android 产物是不可直接安装的 AAB。[Expo：内部发行](https://docs.expo.dev/build/internal-distribution/)、[Expo：APK 构建](https://docs.expo.dev/build-reference/apk/)

首个成功的已签名 APK 与签名身份双重保管均已存在。仓库外加密归档及其非秘密校验信息记录在 ADR-0028；解密口令只保存在 macOS 钥匙串。EAS 登录态、Android keystore、密码、`credentials.json`、控制面 Secret、Device Credential、Media Join Grant 或 E2EE 密钥仍不能进入 Git、构建日志或公开构建变量。

## E2EE APK 验收顺序

1. 锁定经验证的 LiveKit React Native / WebRTC 依赖版本；在连接 Room **之前**，只从本端内存的 Media Join Grant 取得或解封共享密钥，并配置 E2EE manager。
2. 用同一版本的桌面端和真实签名 Android APK 连接一通新的 LiveKit Media Session；双方报告 E2EE 就绪后才允许 `ACTIVE`。
3. 用错误密钥和“一个端点未启用 E2EE”分别验证媒体不可用，并确认状态机以 `E2EE_REQUIRED` 或 `MEDIA_CONNECT_TIMEOUT` 终止，绝不调用关闭 E2EE 的回退路径。
4. 搜索 APK 构建输出、Android 日志、URL、二维码、控制面数据库、审计和移动端持久存储，确认没有 Token、E2EE 密钥或 Media Join Grant；撤销期间还须验证活动和未加入的两个 call-scoped identity 均不能继续加入。

只有这些实机证据通过，才能把“LiveKit 的 React Native 示例可用”升级为 Cyrene Android V1 的事实。此前它只是一个可复用的候选能力。
