# 已有 Cyrene 主仓代码：接入移动端语音功能

> 适用情况：你已经克隆了 `Playa-0v0/Cyrene-Agent`，现在想使用
> `Liyang0701/Cyrene-Agent` 提供的 Android 公网语音功能。

## 1. 开始前检查

进入原来的 Cyrene Agent 目录：

```bash
cd Cyrene-Agent
git status
git remote -v
```

先看 `git status` 的结果：

- 显示 `working tree clean`：按第 2 节操作。
- 显示有修改或未跟踪文件：按第 3 节操作。

不要删除原仓库，也不要只复制 `mobile/` 目录。

## 2. 原仓库没有本地改动

### 2.1 添加移动语音 Fork

```bash
git remote add liyang https://github.com/Liyang0701/Cyrene-Agent.git
git fetch liyang
```

如果提示 `remote liyang already exists`，改用：

```bash
git remote set-url liyang https://github.com/Liyang0701/Cyrene-Agent.git
git fetch liyang
```

### 2.2 建立移动语音分支

```bash
git switch -c mobile-voice --track liyang/master
```

如果提示 `mobile-voice` 已存在：

```bash
git switch mobile-voice
git pull --ff-only liyang master
```

确认当前分支：

```bash
git branch --show-current
```

预期输出：

```text
mobile-voice
```

然后跳到第 4 节。

## 3. 原仓库有自己的修改

### 3.1 保存当前修改

```bash
git switch -c backup-before-mobile-voice
git add -A
git commit -m "chore: save local changes before mobile voice"
```

记下自己的提交：

```bash
git log --oneline -10
```

复制需要保留的提交 SHA，例如：

```text
abc1234 my local changes
```

### 3.2 从移动语音 Fork 建立新分支

```bash
git remote add liyang https://github.com/Liyang0701/Cyrene-Agent.git
git fetch liyang
git switch -c mobile-voice-integration --track liyang/master
```

如果 `liyang` remote 已存在：

```bash
git remote set-url liyang https://github.com/Liyang0701/Cyrene-Agent.git
git fetch liyang
git switch -c mobile-voice-integration --track liyang/master
```

### 3.3 移入自己的提交

每次移入一个提交：

```bash
git cherry-pick abc1234
```

有多个提交时，按照从旧到新的顺序重复执行：

```bash
git cherry-pick <第一个提交SHA>
git cherry-pick <第二个提交SHA>
```

如果出现冲突，先不要删除文件或强制覆盖。重点检查：

```text
src/main/index.ts
src/main/call/call-manager.ts
src/preload/index.ts
src/shared/ipc-channels.ts
src/renderer/settings/
package.json
package-lock.json
mobile/package.json
mobile/package-lock.json
```

解决冲突后：

```bash
git add <已经解决的文件>
git cherry-pick --continue
```

## 4. 安装依赖并验证代码

在仓库根目录运行：

```bash
npm ci
npm run build
npx vitest run
```

然后检查 Android 工程：

```bash
cd mobile
npm ci
npm run android:check
npm run typecheck
cd ..
```

通过标准：

- 桌面完整构建成功；
- 自动测试全部通过；
- Android SDK、ADB 和 Java 被识别；
- 移动端 TypeScript 检查通过。

## 5. 准备自己的服务

移动端语音不能直接使用维护者的生产账号。你需要自己的：

1. Cloudflare 账号、Worker 和 Durable Object；
2. LiveKit Cloud 项目；
3. Expo/EAS 项目；
4. Android release keystore；
5. 桌面端模型、ASR 和 TTS/GPT-SoVITS 配置。

按照[移动端语音通话从零部署与排障手册](./mobile-voice-call-setup-runbook.md)
依次完成：

```text
第 2 节：创建 LiveKit 项目
第 3 节：创建 Cloudflare 控制面
第 4 节：初始化 Owner 和第一台桌面
第 5 节：配置并验证桌面语音链
第 6 节：创建 Expo/EAS 项目
第 7 节：手机与桌面配对
第 8 节：第一次端到端通话
```

## 6. 创建自己的 EAS 项目和 APK

```bash
cd mobile
npx eas-cli@latest login
npx eas-cli@latest whoami
npx eas-cli@latest init
npx eas-cli@latest project:info
```

提交可直接安装的内部 APK：

```bash
npx eas-cli@latest build --platform android --profile preview
```

使用 `preview` 构建 APK。不要把 `production` 生成的 AAB 当成手机安装包。

后续覆盖升级必须保持：

- 相同 Android package；
- 相同 release keystore；
- 递增的 `version` 和 `android.versionCode`；
- 直接覆盖安装，不先卸载旧版。

## 7. 手机网络要求

当前已验证链路要求 Android 手机始终开启可用 VPN。

无论手机使用：

- 5G；
- Wi-Fi；

都要先开启 VPN，再进行扫码配对或呼叫。测试前用手机浏览器访问：

```text
https://<你的-worker-origin>/healthz
```

访问成功后再打开 Cyrene Voice。

## 8. 第一次验收

按顺序检查：

- [ ] 桌面显示已登录、可接听；
- [ ] 手机已开启 VPN；
- [ ] 手机与桌面完成六位码核对和批准；
- [ ] 呼叫后成功进入通话页；
- [ ] 连续完成至少 5 轮、持续超过 60 秒；
- [ ] 新建、继续、重命名和删除历史正常；
- [ ] 自动聆听和手动轮次正常；
- [ ] 蓝牙与扬声器可以切换；
- [ ] 挂断后可以重新呼叫；
- [ ] 覆盖安装新版 APK 后配对仍然保留。

## 9. 以后更新移动语音 Fork

没有额外本地提交的 `mobile-voice` 分支：

```bash
git fetch liyang
git switch mobile-voice
git merge --ff-only liyang/master
npm ci
npm --prefix mobile ci
```

带有自己提交的集成分支：

```bash
git fetch liyang
git switch mobile-voice-integration
git merge liyang/master
```

合并后重新执行第 4 节的全部构建和测试。

## 10. 遇到问题时提供什么

```text
当前分支：
git rev-parse HEAD：
桌面系统：
手机型号和 Android 版本：
手机底层网络（5G/Wi-Fi）：
VPN 是否开启及出口地区：
完成轮数和持续时间：
最后显示状态：
报错原文：
截图：
```

不要发送 Worker Secret、LiveKit API Secret、Owner Recovery Key、设备凭据或
配对二维码原图。
