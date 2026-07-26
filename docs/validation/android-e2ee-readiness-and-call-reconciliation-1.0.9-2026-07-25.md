# Android E2EE 就绪与通话终态收敛验证（1.0.9）

日期：2026-07-25

## 变更边界

- Android 不再等待 React Native LiveKit 未可靠发出的远端 `ParticipantEncryptionStatusChanged`。
- Android 仅在本机 GCM 音频发布和预期桌面身份的 GCM 音频订阅均成立后上报媒体就绪。
- 任何相关音频 publication 为非加密时保持 fail-closed。
- 通话期间每 1.5 秒读取控制面的权威状态；`bridge ended` 只触发低延迟复核。
- 远端 `ENDED` 只清理本机通话，不重复上报为手机主动挂断。

## 自动验证

- `npm test -- --reporter=dot`
  - 219 个测试文件通过
  - 1303 项测试通过
- `mobile: npm run typecheck`
  - 通过
- `mobile: npm run test:android-bootstrap`
  - 3 项测试通过
- `mobile: npm run android:check`
  - Android SDK、ADB、Android Studio JBR 环境通过
- Expo 配置
  - `versionName=1.0.9`
  - `versionCode=10`
  - `package=com.cyrene.agent.voice`

## 签名 APK

- EAS Build ID：`9ca9f776-55c8-4ebd-a84c-fd5c4166e280`
- 状态：`FINISHED`
- APK：`https://expo.dev/artifacts/eas/pGlxw_q1Mv_eRlq1cTT2fZrTUVpbZTXdmN0Q9Kgqt4g.apk`
- 本机文件：`/Users/kano/Desktop/Cyrene-Voice-1.0.9-build10.apk`
- SHA-256：`ab73d38ad8bdc08568579d94d9c974080f26faba82baf39138e0b94655e6a871`
- APK Signature Scheme v2：通过
- 签名证书 SHA-256：`0083894c80bb86c6a26df1874cd8c41aefee13add8fea1d963c1ff0d39998932`
- APK 内 Hermes bundle 已确认包含 `E2EE_PUBLICATION_NOT_ENCRYPTED`、`observeEncryptedAudioPublication` 与 `monitorRemoteCallState`。

## 尚需外部证据

当前没有连接到 ADB 的 Android 设备，因此无法在本机自动完成覆盖安装和真实 VPN/LiveKit 多轮通话验收。最终验收需要在原已配对手机覆盖安装 build 10，进行一通至少五轮的语音对话，并观察是否超过原 30 秒终止点。
