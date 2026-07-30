# Issue #69：端点 E2EE 休眠 WebSocket 中继原型验证

> 日期：2026-07-30
> 对应议题：[#69](https://github.com/KanoTime/Cyrene-Agent/issues/69)
> 分支：`codex/issue69-relay-prototype`（throwaway，不得合入正式实现）
> 状态：自动门槛部分通过；真实 Android、后台、目标 VPN 网络与完整可观测性门槛待 Owner 真机
> 数据边界：只使用固定假设备、throwaway key 和唯一 sentinel；没有接入生产 Device Credential、角色内容、对话、文档或配置

## 阶段结论

候选骨架在 Node↔Node、本地 `workerd` 和隔离 Cloudflare Worker 上已经证明可行：

- Durable Object 使用 `acceptWebSocket()`、tag、serialized attachment 和
  `webSocketMessage()`，空闲时可丢弃内存而不关闭客户端连接；
- relay 只校验外层路由/大小/序号并原样转发 HPKE Auth 密文，端点完成加解密；
- 一次性 30 秒 ticket、错误 key、错误 Device ID、密文篡改、中继重放、
  端点重放、旧 epoch、100 个 operation 的重连乱序重发、离线恢复、
  10 MiB 背压、活动撤销和 storage sentinel 审计均已通过；
- 独立 Expo SDK 56 / React Native 0.85.3 Android 原生 debug APK 已成功编译，
  证明 `hpke-js` 可与 `react-native-quick-crypto` 的原生 WebCrypto 路径打包；
- 这还**不能**替代真实 Android 端运行、Android 后台/Doze、目标 VPN 网络
  50 次循环、Worker Logs/Analytics 与网络抓包检查，所以本报告不建议关闭 #69。

如果剩余门槛通过，推荐继续采用“Cloudflare Hibernatable WebSocket relay +
端点应用层 E2EE”；生产握手、设备公钥生命周期和正式业务协议仍应由后续 ADR
单独冻结。若真实 Android 或目标 VPN 门槛失败，只否决当前网络/运行时组合，
不得降级到 relay 可读正文或取消身份/重放校验。

## 隔离资源与复现入口

| 项目 | 值 |
| --- | --- |
| Worker | `cyrene-issue69-e2ee-relay-prototype` |
| Origin | `https://cyrene-issue69-e2ee-relay-prototype.cyrene-agent.workers.dev` |
| Durable Object | SQLite-backed `Issue69RelayDurableObject` |
| 当前验证部署 | `2916db21-7208-4c8b-8fd4-fd74381d9303` |
| 云端 secret | `ISSUE69_PROTOTYPE_RUN_TOKEN` |
| 本机 secret | macOS Keychain service `com.cyrene.prototype.issue69`、account `issue69-relay-prototype` |
| Android package | `com.cyrene.prototype.issue69` |
| APK | `prototype/issue69-android/android/app/build/outputs/apk/debug/app-debug.apk`（gitignored，170 MiB） |
| APK SHA-256 | `bc1db1fd145af182aee73a767ef9b939dbe0a30c67fb0172a3d4a5d2428ab5f9` |

本地全场景：

```sh
npm run prototype:issue69-relay:scenario
```

远端全场景（不要把 token 写进 shell history）：

```sh
NODE_USE_ENV_PROXY=1 \
ISSUE69_ORIGIN=https://cyrene-issue69-e2ee-relay-prototype.cyrene-agent.workers.dev \
ISSUE69_RUN_TOKEN="$(security find-generic-password \
  -a issue69-relay-prototype \
  -s com.cyrene.prototype.issue69 -w)" \
npm run prototype:issue69-relay:remote
```

加入 `ISSUE69_LONG_GATE=1` 会执行 30 秒和 5 分钟两段离线恢复。

## 已通过证据

### 1. 跨运行时密码学准备

- 套件：RFC 9180 Auth mode，DHKEM(X25519, HKDF-SHA256)、
  HKDF-SHA256、ChaCha20Poly1305。
- `hpke-js@1.8.0` 通过 CFRG 固定提交的官方 RFC 9180 JSON known-answer
  vector；`enc` 与 `ct` 均逐字节匹配。
- 桌面 Node 使用标准 WebCrypto；Android 原型以
  `react-native-quick-crypto@1.1.6` 安装全局 WebCrypto，再复用同一
  `hpke-js` 协议实现。
- Android 原型位于独立 `prototype/issue69-android/`，没有改动正式
  `mobile/` 入口、app config、依赖、EAS project 或包名。
- Android TypeScript、Expo public config 和 303 项 Gradle
  `assembleDebug` 任务通过。
- 独立 Android 原型的 `npm audit --omit=dev` 当前报告 11 个 moderate、
  0 个 high/critical；因此这些版本只用于 throwaway 技术验证，生产选型仍须
  锁版本、审计完整依赖链并逐项处置，不能把“成功打包”解释成供应链放行。

官方/一手来源：

- [RFC 9180](https://www.rfc-editor.org/rfc/rfc9180.html)
- [CFRG RFC 9180 test vectors](https://github.com/cfrg/draft-irtf-cfrg-hpke/blob/5f503c564da00b0687b3de75f1dfbdfc4079ad31/test-vectors.json)
- [`hpke-js` official repository](https://github.com/dajiaji/hpke-js)
- [`react-native-quick-crypto` official repository](https://github.com/margelo/react-native-quick-crypto)

### 2. 身份、认证与重放

- ticket 随机、30 秒有效、设备/Owner/peer/type 绑定并在 DO transaction
  中取出后立即删除；第二次消费失败；
- relay attachment 固定 sender/target/Owner；错 Device ID 在解密前拒绝；
- peer key 错误和密文 bit flip 均在端点 AEAD open 时失败；
- relay 按同一 socket 的 `channelEpoch + senderSequence` 拒绝倒退/重复；
- 接收端独立保存每个 peer epoch 的最高序号，并拒绝已退休 epoch；
- 100 个稳定 operation ID 先正常提交，再以新连接、新 epoch、逆业务顺序
  重发；桌面记录 100 个 duplicate，但权威效果仍恰好 100 个。

Relay 的序号检查只是廉价 DoS/replay 前置过滤；业务幂等仍以解密后的稳定
`operationId` 为准，不能把 WebSocket 有序性当成跨重连业务顺序。

### 3. Hibernation、离线与背压

- 两端连接空闲 12.5 秒后继续收发；audit 中 `objectStarts=1`，说明 reset
  后对象内存至少被重建一次，serialized attachment 足以恢复路由/序号状态。
- 目标离线时 relay 只返回 `TARGET_OFFLINE`，不保存 frame；发送端保留相同
  operation ID，重连后再投递，并随后接收有界 snapshot。
- 10 MiB 假文本连续生产时，发送端在 256 KiB 高水位暂停；本地样本
  `maxBuffered=264648` bytes、45 次暂停；远端代理样本
  `maxBuffered=315577` bytes、2,675 次暂停，最终 drain probe 均到达。
- 隔离公网 Worker 的长门槛中，30 秒离线不需要重连桌面；5 分钟离线时
  本机代理已经关闭桌面 WSS，桌面显式领取新 ticket 重连一次。两段均以
  同一 operation ID 恢复 outbox、取得 snapshot，并拒绝旧 mobile epoch。
- 长门槛最终 audit：`objectStarts=4`、6 次 ticket/连接、428 个成功入站
  frame、426 个转发、最大 JSON frame 66,162 bytes；storage 仍只有
  `metrics` 与 `revoked`。
- 边界固定为 96 KiB JSON frame / 64 KiB decoded ciphertext；Cloudflare
  平台当前允许更大的单消息，但 Cyrene 不使用平台上限作为应用上限。

Cloudflare 官方说明：Hibernation API 只适用于 DO 作为 WebSocket server；
serialized attachment 在连接健康时跨 hibernation 存活，单 attachment 上限
16,384 bytes；无 timer、未完成 I/O、standard WebSocket API 或出站 socket
时，对象在约 10 秒无事件后进入 hibernation。参见
[WebSocket best practices](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)、
[Durable Object lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)。

### 4. 撤销与控制面数据边界

- 撤销写入最小 `revoked:<deviceId>` 标记；
- `getWebSockets("device:<id>")` 找出活动/休眠连接并以 4003 关闭；
- 被撤销设备的新 ticket 和重新连接失败；
- 每条迟到 frame 在转发前再次检查撤销；
- audit storage 只有 `metrics` 与 `revoked`；唯一 sentinel 和 ciphertext
  均未出现，attachment 也只含 ticket 路由元数据和最后 epoch/sequence。

这只证明本原型代码和 DO storage 的边界。正式通过还必须检查 Worker Logs、
Analytics、异常、代理/抓包和 Android logcat；在这些证据齐全前不能宣称
“零明文控制面”全部完成。

## 成本投影

Cloudflare 2026-06-19 的官方价格页给出的当前规则：

- Free plan 的 SQLite-backed DO 每天含 100,000 request 与 13,000 GB-s；
- Paid plan 每月含 1,000,000 request 与 400,000 GB-s，另有最低月费；
- WebSocket 建连算一次 request；入站 WebSocket message 按 20:1 折算
  request；出站 message 不单独收费；
- 符合 hibernation 条件的空闲 DO 不计 duration，即使 runtime 尚未实际
  把它移出内存。

来源：[Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)。

公网长场景共 6 次 ticket/建连、428 个成功入站 frame；忽略少量 HTTPS
控制请求时约为 `6 + 428 / 20 = 27.4` 个计费 request 等价。即便个人保守模型
按每天 20 次连接、10,000 个入站 frame计算，也约为每天 520 request 等价，
低于 DO Free 日请求额度的 1%。这是按官方计费规则的投影，不是账号账单：
正式门槛仍需在目标账号 Analytics 核对 request、CPU/GB-s，并与已有 Worker
共享用量合并后确认低于每月 ¥20 告警线。

## Android 后台边界

原型不应该通过 foreground service 把 WebSocket 伪装成可靠后台总线。
Android 官方说明：

- Doze 会暂停普通应用网络，App Standby 会推迟后台网络；
- Data Saver 可在计量网络上阻止后台数据；
- 需要用户立即看到的下行事件应使用产生可见通知的 FCM high-priority
  message；Android 官方不建议每个 App 自己维持长期后台连接；
- Android 12+ 从后台启动 foreground service 受到限制，target 34+ 还必须
  声明准确的 service type/权限。

来源：

- [Android Doze and App Standby](https://developer.android.com/training/monitoring-device-state/doze-standby)
- [Android Data Saver](https://developer.android.com/develop/connectivity/network-ops/data-saver)
- [Foreground service declarations](https://developer.android.com/develop/background-work/services/fgs/declare)

因此真机门槛的正确期望是：前台 WSS；短后台允许自然断开；系统回收后依赖
Opaque Wake Signal/可见通知；重新打开后新 ticket、新 epoch、outbox/cursor
收敛。聊天通知和自动任务提醒即使锁屏也必须显示中文可见通知；不得以隐藏
高优先级 push 只为唤醒 socket。

## 可复用与必须自研

### 可复用

- Cloudflare SQLite-backed Durable Object、Hibernation WebSocket、tag、
  serialized attachment、平台限流和计费模型；
- `hpke-js` 的 RFC 9180 实现与官方 test vector；
- Android `react-native-quick-crypto` 原生 WebCrypto；
- Node `ws`，以及 `https-proxy-agent` 对当前桌面 HTTPS proxy 的显式支持；
- 现有 Device Credential / Access Token / Revocation、SecureStore、
  桌面权威状态、Opaque Wake Signal 和中文通知边界。

### Cyrene 必须自研

- Pairing Approval 对端公钥/指纹绑定和 key replacement/recovery；
- 一次性 WebSocket ticket 与 authorization-version 每帧复核；
- 生产握手、channel epoch、方向密钥、AEAD AAD 与升级格式；
- outbox、cursor、snapshot、authority version、operation id 和冲突语义；
- 正式消息 schema、流式分片、速率/队列限制、审计与前后台 UI 状态。

不整套接入 Matrix/Signal/MLS，是因为它们会引入账户、房间、云端密文历史、
prekey/group epoch、恢复和多成员状态，改变“桌面权威、控制面最小 relay”的
领域模型。原型复用标准密码学和平台原语，但不自行发明密码学算法。

## 尚未通过与关闭 #69 的剩余证据

1. **真实 Android：** 在 Owner 手机运行 APK，Android 端通过同一 RFC
   vector，与桌面 Node 双向解密，并验证错误 key、篡改、旧 epoch、重放。
2. **后台：** 前台→后台→强制 Doze/App Standby→系统回收→可见通知→重开；
   事务不能在后台 socket 丢失时错误显示“已应用”。
3. **目标网络：** 家中 Mac 与 Android 在实际 VPN、目标 Wi‑Fi、5G 和外部
   Wi‑Fi 各累计 50 次连接/恢复；前台成功率 ≥98%，连接 p95 ≤5 秒，
   30 秒恢复 p95 ≤10 秒。
4. **完整零明文审计：** Worker Logs、Analytics、异常、DO storage、
   WebSocket attachment、桌面代理/抓包与 Android logcat 均搜索 sentinel。
5. **账号成本：** 读取该 Worker 的真实 request、duration/GB-s 用量，并与
   账号已有 Worker 合并投影；每月 >¥20 则失败。
6. **生命周期：** 门槛结束后删除 Worker、DO namespace/version 和本机
   Keychain prototype token；在证据确认前暂不删除。

以上六项全部通过后，才能在 #69 发布 Resolution 并关闭；本 throwaway
分支不得直接合入正式功能代码。
