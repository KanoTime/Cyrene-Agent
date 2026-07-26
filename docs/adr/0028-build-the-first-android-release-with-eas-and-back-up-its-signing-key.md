# 首个 Android 版本使用 EAS 构建并双重保管签名密钥

Cyrene Voice 的首个异地版本只交付个人自用的 Android 内部分发 APK，使用 Expo EAS Build 生成不依赖 Metro 的独立安装包，iOS 和应用商店分发留到公网配对闭环稳定之后。EAS 可以生成并托管 release keystore，但首次成功构建后必须立即通过 `eas credentials` 下载一份仓库外的加密备份；keystore、密码、`credentials.json`、LiveKit Secret 和任何真实设备凭据均不得进入 Git。V1 每次升级都由 EAS Build 生成使用同一 application ID 和 release keystore 的完整 APK，用户收到提示后手动覆盖安装并保留应用数据与设备凭据，暂不启用 EAS Update 的 JavaScript OTA。默认只使用 EAS Free；免费 Android 构建额度耗尽时等待下月重置或使用同一签名身份执行本地 EAS 构建，任何付费套餐或超额计费都必须由 Owner 再次明确批准。这样以第三方托管换取构建便利，同时保留迁出 EAS 和持续升级已安装应用所需的签名身份。

## Beta 0 实施证据（2026-07-22 至 2026-07-23）

`preview` 内部分发构建已成功生成 `com.cyrene.agent.voice` `1.0.0` 的独立 APK。本地验证确认 APK Signature Scheme v2 有一个有效签名者；Owner 已在真机完成桌面生成二维码、手机扫码和前台语音通话的人工验收。该事实仅证明 EAS 内部分发与既有短时二维码语音桥接可用，不代表长期设备配对、异地一键呼叫或连接前 E2EE 已完成。

该次构建创建并使用 EAS 托管的 release keystore。2026-07-23 已通过 `eas credentials` 在隔离临时工作树下载 `credentials.json` 与对应 JKS，并用 Android Studio 自带 `keytool` 验证 keystore 可按下载凭据打开。随后只把这两个文件写入 AES-256-CBC、PBKDF2-SHA-256（600,000 次迭代）的加密归档：

`/Users/kano/Documents/Cyrene Private Backups/cyrene-eas-android-signing-20260723-115808.tar.gz.enc`

归档权限为 `0600`，大小为 2,752 bytes，SHA-256 为 `eb35d61df656a40d79cb7fac5e73e6ce91086c33c585ad9e405e3d7d1d43a5d9`。随机归档口令只存于 macOS 钥匙串，服务名为 `com.cyrene.agent.eas-keystore-backup`、账户名为 `cyrene-eas-keystore-backup`；文档、终端输出和 Git 均不保存口令。加密后已实际解密复核归档摘要与成员清单，临时明文目录随后删除，并确认仓库内没有 release `credentials.json`、JKS 或 keystore 导出。

因此当前签名身份已形成 **EAS 托管副本 + 本机仓库外加密副本** 的双重保管。恢复时必须同时取得加密归档及当前 Owner 钥匙串中的口令；不得把归档解密到仓库，也不得用新的 release keystore 覆盖同一 application ID 的升级链。

2026-07-23，Owner 确认已将同一加密归档上传到百度网盘，形成额外的异地副本。网盘只保存已经过 AES-256 加密的归档，不保存或导出口令；口令仍只在 Owner 的 macOS 钥匙串中。该副本增加地域与设备故障韧性，但不改变 EAS 托管签名身份和本机可离线恢复副本作为升级链依据的边界。
