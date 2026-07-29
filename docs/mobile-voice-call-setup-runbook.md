# Cyrene 移动端语音通话：从零部署与排障手册

> 已经克隆了上游 `Playa-0v0/Cyrene-Agent`？请先阅读
> [已有主仓代码：接入移动端语音功能](./mobile-voice-call-add-to-upstream-clone.md)，
> 再按本文完成个人服务配置。
>
> 适用版本：Cyrene Voice `1.0.15` / Android `versionCode 16`
>
> 目标：让第一次接触本项目的维护者，按顺序完成自己的控制面、媒体服务、
> 桌面端和 Android APK，并能把故障定位到明确的一层。
>
> 本文不会提供维护者的生产地址、EAS Project ID、签名文件或任何真实密钥。

## 0. 先确认你要部署的是什么

移动端不是独立运行的云端 AI。一次通话需要四部分同时工作：

```text
Android Cyrene Voice
  ├─ HTTPS → 你的 Cloudflare Worker + Durable Object
  └─ WebRTC/E2EE ↔ 你的 LiveKit 项目
                         ↕
                  在线的 Cyrene 桌面端
                  ASR → 角色/模型 → TTS
```

Cloudflare 只保存设备授权和通话状态；LiveKit 只承载加密实时媒体。对话正文、
模型凭据、ASR 和 TTS 留在桌面端。

开始前准备：

- Node.js 24、npm 10 或更高版本；
- Cloudflare、LiveKit Cloud、Expo/EAS 三个账号；
- Android 真机和数据线；
- Android Studio、SDK Platform-Tools、可用 JDK；
- 一台能持续在线运行 Cyrene Agent 的桌面电脑；
- 可用的模型、ASR 和 TTS 配置；
- 手机与桌面都能访问你的 Worker 和 LiveKit；
- Android 手机上可稳定访问 Cloudflare 与 LiveKit 的 VPN。

> [!IMPORTANT]
>
> 对当前已经完成真机验证的部署，VPN 是手机端必需前提，不是可选优化。手机
> 无论连接 5G 还是 Wi-Fi，都要先开启 VPN 并保持在线，再进行配对或呼叫。

> `@livekit/react-native-webrtc` 是原生模块，不能用 Expo Go 验收。

## 1. 获取代码并建立干净基线

```bash
git clone https://github.com/KanoTime/Cyrene-Agent.git
cd Cyrene-Agent
npm ci
npm run build

cd mobile
npm ci
npm run android:check
npm run typecheck
cd ..
```

通过标准：

- 根目录构建没有 TypeScript、Vite 或 Electron 错误；
- `android:check` 找到 Android SDK/JDK；
- 移动端类型检查通过。

如果这里失败，先修本地依赖，不要开始配置云服务。

## 2. 创建 LiveKit 项目

在 LiveKit Cloud 新建项目，记录以下三项：

```text
Server URL: wss://...
API Key: ...
API Secret: ...
```

规则：

- API Secret 只能进入 Cloudflare Worker Secret；
- 不能写入 `mobile/app.json`、二维码、README、提交记录或 APK；
- 不要把临时参与者 Token 当成长期设备凭据。

本关只验证控制台能看到项目和三项服务端资料，不需要先创建房间。

## 3. 创建 Cloudflare 控制面

### 3.1 登录并验证 Worker 能构建

```bash
npx wrangler login
npm run build:cloudflare-device-authorization
```

预期 dry-run 成功，并识别 `CYRENE_DEVICE_AUTHORIZATION` Durable Object binding。

### 3.2 生成自己的引导码和媒体信封主密钥

只在自己的终端运行：

```bash
node -e "const c=require('node:crypto'); console.log('bootstrap:', 'cy_db_'+c.randomBytes(32).toString('base64url')); console.log('media-master:', c.randomBytes(32).toString('base64url'))"
```

把结果立即存入密码管理器。不要截图、粘贴到聊天或写入仓库。

计算 bootstrap code 的 SHA-256 base64url：

```bash
read -s "BOOTSTRAP_CODE?Deployment bootstrap code: "; echo
BOOTSTRAP_CODE="$BOOTSTRAP_CODE" node -e "const c=require('node:crypto'); process.stdout.write(c.createHash('sha256').update(process.env.BOOTSTRAP_CODE).digest('base64url')+'\\n')"
unset BOOTSTRAP_CODE
```

### 3.3 上传 Secrets

依次运行，并在提示时粘贴对应值：

```bash
npx wrangler secret put CYRENE_DEPLOYMENT_BOOTSTRAP_CODE_HASH --config cloudflare/wrangler.jsonc
npx wrangler secret put CYRENE_LIVEKIT_SERVER_URL --config cloudflare/wrangler.jsonc
npx wrangler secret put CYRENE_LIVEKIT_API_KEY --config cloudflare/wrangler.jsonc
npx wrangler secret put CYRENE_LIVEKIT_API_SECRET --config cloudflare/wrangler.jsonc
npx wrangler secret put CYRENE_MEDIA_ENVELOPE_MASTER_KEY --config cloudflare/wrangler.jsonc
npx wrangler secret put CYRENE_CONTROL_PLANE_PUBLIC_ORIGIN --config cloudflare/wrangler.jsonc
```

最后一项应填写部署后的显式 `https://...` origin。首次不知道最终地址时，可先部署一次取得
Workers URL，再补该 Secret 并重新部署。

```bash
npx wrangler deploy --config cloudflare/wrangler.jsonc
curl --fail --silent --show-error https://<你的-worker-origin>/healthz
```

通过标准：健康检查返回成功，且响应中没有 Secret。

## 4. 初始化 Owner 和第一台桌面

### 4.1 配置通用环境变量

```bash
export CYRENE_KEYCHAIN_NAMESPACE="my-cyrene-production"
export CYRENE_CONTROL_PLANE_ORIGIN="https://<你的-worker-origin>"
export CYRENE_DESKTOP_LABEL="我的桌面"

export CYRENE_DEPLOYMENT_BOOTSTRAP_KEYCHAIN_SERVICE="Cyrene Deployment Bootstrap Code - $CYRENE_KEYCHAIN_NAMESPACE"
export CYRENE_LIVEKIT_SERVER_URL_KEYCHAIN_SERVICE="Cyrene LiveKit Server URL - $CYRENE_KEYCHAIN_NAMESPACE"
export CYRENE_LIVEKIT_API_KEY_KEYCHAIN_SERVICE="Cyrene LiveKit API Key - $CYRENE_KEYCHAIN_NAMESPACE"
export CYRENE_LIVEKIT_API_SECRET_KEYCHAIN_SERVICE="Cyrene LiveKit API Secret - $CYRENE_KEYCHAIN_NAMESPACE"
export CYRENE_MEDIA_ENVELOPE_MASTER_KEY_KEYCHAIN_SERVICE="Cyrene Media Envelope Master Key - $CYRENE_KEYCHAIN_NAMESPACE"
export CYRENE_OWNER_RECOVERY_KEYCHAIN_SERVICE="Cyrene Owner Recovery Key - $CYRENE_KEYCHAIN_NAMESPACE"
```

### 4.2 macOS：把材料写入 Keychain

每条命令都会静默读取，不把值写入 shell 历史：

```bash
read -s "VALUE?Deployment bootstrap code: "; echo
security add-generic-password -U -a "$USER" -s "$CYRENE_DEPLOYMENT_BOOTSTRAP_KEYCHAIN_SERVICE" -w "$VALUE"
unset VALUE

read -s "VALUE?LiveKit Server URL: "; echo
security add-generic-password -U -a "$USER" -s "$CYRENE_LIVEKIT_SERVER_URL_KEYCHAIN_SERVICE" -w "$VALUE"
unset VALUE

read -s "VALUE?LiveKit API Key: "; echo
security add-generic-password -U -a "$USER" -s "$CYRENE_LIVEKIT_API_KEY_KEYCHAIN_SERVICE" -w "$VALUE"
unset VALUE

read -s "VALUE?LiveKit API Secret: "; echo
security add-generic-password -U -a "$USER" -s "$CYRENE_LIVEKIT_API_SECRET_KEYCHAIN_SERVICE" -w "$VALUE"
unset VALUE

read -s "VALUE?Media envelope master key: "; echo
security add-generic-password -U -a "$USER" -s "$CYRENE_MEDIA_ENVELOPE_MASTER_KEY_KEYCHAIN_SERVICE" -w "$VALUE"
unset VALUE
```

Windows/Linux 维护者需要提供等价的系统安全存储适配，不能把这些值长期保存到明文 JSON。

### 4.3 执行初始化

```bash
npm run bootstrap:cloudflare-device-authorization
```

预期结果：

- `status` 为 `BOOTSTRAPPED`；
- `recoveryKeyConfirmed` 为 `true`；
- `desktopCredentialSaved` 为 `true`；
- Owner Recovery Key 已写入 Keychain。

立即把 Recovery Key 复制到独立的离线密码库。它不应只存在于当前电脑。

若提示 Owner 已存在，不要反复 bootstrap。只有所有旧桌面都无法恢复时，才执行：

```bash
CYRENE_ALLOW_OWNER_RECOVERY=1 npm run bootstrap:cloudflare-device-authorization
```

这会撤销旧桌面并轮换 Recovery Key。

## 5. 配置并验证桌面语音链

启动桌面端：

```bash
npm start
```

在设置中依次完成：

1. 模型 Provider、Base URL、模型和 API Key；
2. ASR 服务；
3. 当前角色及其 Voice Profile；
4. TTS 服务；GPT-SoVITS 或自定义 TTS 应输出可解码 WAV；
5. 移动语音控制面状态显示为已登录、可接听。

先完成一次桌面语音对话。通过标准：

- 能识别你的问题；
- 模型返回正确角色回答；
- TTS 完整播放且没有沙声；
- 回答后重新进入聆听。

桌面语音链失败时不要继续排查手机，因为手机只是在远程复用它。

## 6. 创建自己的 Expo/EAS 项目

公开仓库不会替你提供可复用的签名或 EAS Project ID。

```bash
cd mobile
npx eas-cli@latest login
npx eas-cli@latest whoami
npx eas-cli@latest init
npx eas-cli@latest project:info
```

然后检查 `mobile/app.json`：

- `expo.owner` 是你的 Expo 账号或团队；
- `expo.extra.eas.projectId` 是刚创建的项目；
- `expo.android.package` 是你控制的唯一包名；
- `version` 与 `android.versionCode` 随发行递增。

如果要覆盖安装自己之前的版本，包名和 release keystore 必须保持一致。卸载会删除
SecureStore 中的配对凭据；正常升级应直接覆盖安装。

提交内部 APK：

```bash
npx eas-cli@latest build --platform android --profile preview
```

`preview` 明确使用 APK；`production` 默认可能生成面向商店的 AAB，不能直接当作手机覆盖安装包。
Keystore 和密码必须在 Git 之外备份。

## 7. 手机与桌面配对

1. 保持桌面端处于在线、可接听状态；
2. 在桌面“长期设备配对”中选择“配对新手机”；
3. 手机打开 Cyrene Voice，扫描二维码；
4. 对照手机和桌面的六位校验码；
5. 只在两边一致时于桌面批准；
6. 手机显示已长期配对后，退出并重新打开一次；
7. 确认普通升级不要求重新配对。

二维码只允许手机领取候选挑战，不能替代桌面审批。

## 8. 第一次端到端通话

按以下顺序测试，每关通过后再继续：

1. 手机连接 5G 或 Wi-Fi，开启 VPN，并确认 VPN 能访问 Worker `/healthz`；
2. 点击“呼叫 Cyrene”，确认桌面在线时进入连接状态；
3. 新建一段空标题对话，完成第一轮问答；
4. 连续完成至少 5 轮，持续超过 60 秒；
5. 验证回答后会回到聆听，不自动挂断；
6. 挂断并彻底退出 App；
7. 重新呼叫，选择上一段历史，询问上一轮内容；
8. 重命名该历史；
9. 挂断后删除该历史，重新进入确认没有恢复；
10. 切到“手动轮次”，未开始时播放旁人语音，确认不会进入 ASR；
11. 开始说话、提交本轮，确认能正常回答；
12. 连接蓝牙耳机，在角色说话时切换蓝牙与扬声器，确认路由按钮有效；
13. 保持 VPN 在线，只切换 Wi-Fi/移动网络，确认重连成功或明确结束，不永久卡在假通话状态。

不要用开发包代替最终签名 APK 完成最后验收。

## 9. 分层排障

| 现象 | 先看哪一层 | 首要检查 |
|---|---|---|
| 配对 begin 超时 | Worker/桌面 | `/healthz`、控制面 origin、桌面 IPC |
| 5G/Wi-Fi 下无法连接 | 手机网络 | 先确认 VPN 已开启且能访问 Worker 与 LiveKit |
| 六位码不同 | 配对安全 | 立即拒绝，不要继续 |
| “桌面不可接听” | 桌面协调器 | 桌面是否登录、前台进程是否存活 |
| “当前已有一通电话” | 权威状态机 | 是否为同设备残留呼叫；升级桌面与手机到同一版本 |
| 连接后跳回选择页 | 对话选择协议 | 双端版本是否匹配、加密 control packet 是否可解码 |
| 回答后自动挂断 | E2EE/终态 | 最后状态、E2EE publication、控制面终态 |
| 显示说话但没有声音 | TTS/下行媒体 | WAV、采样率、重采样、captureFrame、手机订阅 |
| 声音沙哑或速度异常 | PCM 发布 | 必须重采样至 48 kHz，并按 20 ms/960 samples 发布 |
| 蓝牙比扬声器糊 | Android 路由 | 是否进入经典 HFP/SCO；对比扬声器并检查 LE Audio |
| 旁人抢先触发 ASR | 输入门控 | 在嘈杂环境改用手动轮次 |
| 历史不见了 | 角色/桌面存储 | 是否切换角色、桌面 Character State Root 是否变化 |
| 无法删除历史 | 活动会话保护 | 当前使用中的历史必须先结束通话 |

## 10. 报错时收集最小证据

请记录：

```text
测试本地时间：
手机 App version / versionCode：
桌面提交 SHA：
手机底层网络（Wi-Fi/5G）：
VPN 是否开启及出口地区：
耳机型号及是否启用 LE Audio：
完成轮数和持续时间：
最后显示状态：
是否听到完整语音：
可复现步骤：
截图：
```

不要提交：

- Owner Recovery Key；
- `cy_dc_...` 设备凭据；
- LiveKit API Secret 或参与者 Token；
- 配对二维码原图；
- Cloudflare Secret；
- 包含上述值的完整日志。

## 11. 发布门禁

自动检查：

```bash
npm run build
npx vitest run

cd mobile
npm run typecheck
cd ..

git diff --check
git grep -nE '(cy_dc_|cy_rk_|LIVEKIT_API_SECRET|MEDIA_ENVELOPE_MASTER_KEY)' -- ':!*.test.ts' ':!docs/**'
```

人工检查：

- [ ] APK 使用自己的 EAS Project 和 keystore；
- [ ] Worker 使用自己的 origin 和 Secrets；
- [ ] 桌面端与手机端来自同一提交；
- [ ] 五轮/60 秒通话通过；
- [ ] 历史新建、继续、重命名、删除通过；
- [ ] 自动与手动轮次通过；
- [ ] 蓝牙/扬声器切换通过；
- [ ] 覆盖安装保留配对；
- [ ] README、截图和日志不含生产凭据。

更深入的架构、安全和升级说明见
[移动端语音通话实现与从零构建指南](./mobile-voice-call-implementation-guide.md)。
