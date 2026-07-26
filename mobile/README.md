# Cyrene Voice（V1）

这是 Cyrene Agent 的 iOS / Android 一对一前台语音通话客户端。手机只负责麦克风、扬声器和扫码配对；活动角色、记忆、ASR、模型与 TTS 都留在桌面端 Cyrene Agent。

## 使用前提

1. 在桌面端 `ASR 设置 → 手机实时通话` 填写 LiveKit Server URL、API Key 和 API Secret。
2. 先完成桌面端的模型、ASR 和当前角色的 TTS 配置。
3. 使用可输出 WAV 的 TTS：MiniMax 与 MiMo 会自动使用 WAV；GPT-SoVITS / 自定义云端请选择 `wav`。
4. 桌面端与手机都必须能访问同一个 LiveKit 服务。

## 本地开发

LiveKit React Native 依赖原生模块，不能用 Expo Go。请使用 Android / iOS 的开发构建。

### Android（macOS）

#### 需要下载什么

1. [Android Studio](https://developer.android.com/studio)：按 Mac 芯片类型下载 Apple Silicon 或 Intel 版本。
2. Android Studio 首次启动时的 **Setup Wizard** 会下载 Android SDK。无需单独下载 `adb` 或 Java；`adb` 随 Android SDK Platform-Tools 安装，Android Studio 自带可供 Gradle 使用的 Java。

#### 第一次配置

1. 将 Android Studio 拖入“应用程序”文件夹并启动，完整走完 Setup Wizard。
2. 打开 **Android Studio → Settings → Languages & Frameworks → Android SDK**：
   - 在 **SDK Platforms** 勾选一个当前稳定的 Android API；
   - 在 **SDK Tools** 勾选 **Android SDK Platform-Tools**、**Android SDK Build-Tools**、**Android SDK Command-line Tools (latest)**；
   - 若要用模拟器，再勾选 **Android Emulator**；点击 Apply 完成下载。
3. 保持默认 SDK 位置即可：`~/Library/Android/sdk`。本项目的 `npm run android` 会自动找到该目录、`adb` 和 Android Studio 内置 Java，无需额外设置环境变量。
4. 若你把 SDK 安装在其他目录，先在当前终端执行（将路径换成实际位置）：

   ```bash
   export ANDROID_HOME="/实际的/Android/sdk"
   ```

5. 回到本目录，验证环境：

   ```bash
   npm install
   npm run android:check
   ```

   看到 `环境就绪`、SDK、ADB 和 Java 路径即表示配置完成。

#### 选择运行设备

- **Android 模拟器：** 打开 Android Studio → Device Manager → Create device，选择任一 Pixel 设备，并下载与本机芯片兼容的系统镜像（Apple Silicon 通常选择 ARM64）。启动该模拟器。
- **真实 Android 手机：** 在手机的“关于手机”连续点击“版本号” 7 次开启开发者选项；在开发者选项中启用“USB 调试”；用 USB 连接 Mac 后，在手机上接受调试授权。然后运行：

  ```bash
  ~/Library/Android/sdk/platform-tools/adb devices
  ```

  输出中设备状态为 `device` 即可。

#### 安装开发版

```bash
npm install
npm run android
```

首次执行会下载 Gradle 与构建所需组件，通常比后续启动慢。若同时连接了多个设备，可指定设备：

```bash
npm run android -- --device
```

应用安装完成后，若需要单独启动 Metro 开发服务：

```bash
npm start
```

首次打开 App 时允许“相机”和“麦克风”权限；相机用于扫桌面端配对二维码，麦克风用于语音通话。

### iOS（macOS）

安装 Xcode 与 CocoaPods 后执行：

```bash
npm install
npm run ios
```

## 配对与通话

1. 保持桌面端 Cyrene Agent 运行。
2. 在桌面端的 `ASR 设置 → 手机实时通话` 点击“生成手机配对二维码”。
3. 打开 Cyrene Voice，允许相机和麦克风权限，扫描二维码。
4. 通话中可静音或挂断；结束后在桌面端点击“结束手机通话”。

配对后，桌面设置页会依次显示“等待手机加入”和“语音通话进行中”，手机加入后二维码会自动隐藏。网络短暂波动时，桌面端和手机端都会显示“正在自动重连”；LiveKit 恢复连接后会继续当前通话。若连接无法恢复，双方会结束本次会话并允许重新生成二维码。

可选的断线恢复检查：保持通话时将手机 Wi-Fi 关闭数秒后重新开启。预期手机端先显示“正在自动重连”，随后显示“连接已恢复”；桌面端不应创建第二个通话房间。

二维码中的手机令牌只用于一次短时房间配对，不写入手机存储；LiveKit API Secret 和桌面 Agent Token 永远不会发送到手机。

当前 V1 仅支持用户主动发起、前台、一对一纯语音通话。系统级来电、后台保活、视频与群组通话不在此版本范围内。

## Android 可安装测试包（Beta 0）

`preview` 是不依赖 Metro 的 Android 签名 APK：安装后可直接打开、扫描桌面端当前通话二维码，并测试手机麦克风、桌面 ASR/模型/TTS、静音、挂断及短暂网络重连。它不等同于“长期配对后一键异地呼叫”；后者依赖正在独立验证的公网控制面，会作为下一阶段加入，不阻塞这个测试包。

首次生成前需要登录 Expo 账号一次：

```bash
cd mobile
npx eas-cli@latest login
```

登录后由项目维护者执行以下命令初始化该 Expo 项目并发起签名构建：

```bash
npx eas-cli@latest build:configure
npx eas-cli@latest build --platform android --profile preview
```

`eas.json` 的 `preview` profile 明确要求内部发行 APK。构建完成后，EAS 提供的下载链接可直接在 Android 手机上打开并安装；不需要 Metro、USB 或同一局域网。桌面端仍需在线，并与手机共同可访问 LiveKit。
