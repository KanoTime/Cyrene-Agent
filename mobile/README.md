# Cyrene Voice

Cyrene Voice 是 Cyrene Agent 的 Android/iOS 一对一前台语音客户端。手机负责配对、麦克风和扬声器；角色、记忆、ASR、模型与 TTS 留在桌面端。当前生产控制面是 Cloudflare Worker + Durable Object，媒体由 LiveKit 承载并强制启用音频媒体帧 E2EE。

完整架构、代码地图、依赖、从零部署、APK 构建、验证矩阵和 FAQ：

- [移动端语音通话从零部署与排障手册](../docs/mobile-voice-call-setup-runbook.md)
- [移动端语音通话实现与从零构建指南](../docs/mobile-voice-call-implementation-guide.md)
- [平台一手资料研究](../docs/research/mobile-voice-call-from-zero-primary-sources-2026-07-27.md)

## 本地开发

LiveKit 包含原生 WebRTC 模块，不能使用 Expo Go。

```bash
npm ci
npm run android:check
npm run typecheck
npm run android
```

需要 Android Studio、Android SDK 和已连接的模拟器/真机。首次打开请允许相机与麦克风权限。

## 内部发行 APK

```bash
npx eas-cli@latest login
npx eas-cli@latest build --platform android --profile preview
```

新版本必须递增 `app.json` 中的 `version` 与 Android `versionCode`。保留已有配对时，应使用相同 application ID、相同 release keystore，并直接覆盖安装；不要先卸载旧版。

## 当前范围

支持长期设备配对、桌面批准、手机公网呼叫、前台一对一语音、静音/挂断、
自动聆听/手动轮次、命名历史的新建/继续/重命名/删除、蓝牙/扬声器切换、
短时重连、权威状态收敛和本地角色语音。桌面必须在线且双方必须能访问控制面与 LiveKit。

暂不支持系统级来电、后台保活、视频、群组、多 Owner 或桌面离线云端 Agent。
