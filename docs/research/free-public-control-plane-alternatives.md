# 免费公网控制面替代方案研究

> 调研日期：2026-07-22
>
> 产品边界：Cyrene V1，单 Owner、最多 3 台桌面与 5 台手机、同一 Owner 最多一通远程语音；公网只承载设备配对、鉴权、呼叫状态与 LiveKit 短期凭据，不承载媒体或对话内容。
>
> 当前原型范围：只验证 1 台桌面与多台移动设备；不验证多桌面并发，也不删除产品中未来新增桌面的能力。
> 约束：中国大陆 5G 与普通 Wi-Fi 必须可用；优先 ¥0/月，硬上限 ¥50/月。

## 结论

有免费办法，而且最值得先验证的不是迁移到境外平台，而是改变 CloudBase 的实时通道：**短时 HTTPS 云函数 + 文档数据库 `watch()` 实时推送**。此前原型否定的是“让云函数实例承载常驻 WebSocket”这一实现；CloudBase 免费体验版另含 **10 条数据库实时推送连接**，`watch()` 由数据库托管长连接，不需要让云函数为连接持续运行。它只传递无业务内容的唤醒信号，3 台桌面各保持一条订阅只占 3 条，手机来电操作走 HTTPS 即可，因此容量上有余量。[CloudBase 免费额度与实时连接数](https://cloud.tencent.com/document/product/876/127357) [数据库实时监听 API](https://docs.cloudbase.net/api-reference/webv1/database)

推荐顺序如下：

1. **CloudBase HTTPS + 数据库 `watch()`：当前首选，但 `watch()` 只用作无业务内容唤醒通道。** 大陆网络、延迟和多移动设备互斥实测通过；Owner 已于 2026-07-22 接受 Opaque Wake Signal 方案的有限时序元数据残留，后续安全原型也证明已撤销桌面的旧 `watch()` 只能看到随机值，无法直接读权威集合，而同一 Cyrene Device Credential 被撤销后权威读取会立即返回 `DEVICE_REVOKED`。该方案现已通过安全分层闸门，待 72 小时计量/稳定性观测和正式 HTTPS 集成验证后才能最终锁定。
2. **CloudBase HTTPS/数据库 + Ably Free Pub/Sub：第二原型。** CloudBase 保留权威状态与鉴权，Ably 只做通知，不存在常驻函数计费；Ably 官方明确称服务可在中国使用，但同时警告中国防火墙可能无预告阻断。免费包是 best-effort、定位于试验/原型，而非有 SLA 的生产承诺。[Ably 中国连接说明](https://ably.com/docs/platform/architecture/edge-network) [Free package](https://ably.com/docs/platform/pricing/free)
3. **Cloudflare Workers Free + SQLite Durable Objects：技术最优、正式选型受大陆支持阻断。** WebSocket Hibernation 能让空闲连接不累计执行时长，免费额度远大于本项目；但 Cloudflare 官方的大陆境内能力属于 Enterprise China Network，需另购并具备 ICP，且 China Network 产品清单当前未列 Durable Objects。因此不能把全球免费网络偶尔可连等同于“大陆必须支持”。[China Network](https://developers.cloudflare.com/china-network/) [境内可用产品](https://developers.cloudflare.com/china-network/reference/available-products/)
4. **Supabase Free：容量足够，但自动暂停与大陆跨境网络是硬风险。** 可作为零成本实验候选，不宜直接定为长期控制面。
5. **Firebase Realtime Database Spark：额度足够，但没有大陆地域或大陆连通承诺。** 相比 Supabase 也没有明显的大陆优势，不优先。

下面的“官方事实”均来自厂商官方文档；“项目推断”是依据 Cyrene 已确认约束得出的结论，仍需原型验证。

## 方案一：CloudBase 数据库实时推送

### 官方事实

- 每个腾讯云开发账号可有一个长期免费体验环境，提供 3,000 资源点/月；免费环境单次续期 6 个月、不自动续费、不能加购资源包或开启按量付费。超额不会自动产生账单。[CloudBase 套餐说明](https://cloud.tencent.com/document/product/876/75213)
- 免费体验版含 10 条“实时推送连接”；一次客户端 `watch()` 占一条，直到关闭。免费云函数超时固定为 3 秒，适合短请求，不适合承载长连接。[资源点与套餐能力](https://cloud.tencent.com/document/product/876/127357)
- CloudBase Web SDK 支持对文档或查询结果调用 `watch()`；收到变更时触发回调，关闭监听时释放连接。[数据库实时推送 API](https://docs.cloudbase.net/api-reference/webv1/database)
- 官方将 `watch()` 定位于订单状态推送、消息提醒和在线状态同步；协议基于长连接，典型延迟为数百毫秒到秒级，网络切换后 SDK 会自动重连，但可能出现 1–2 秒延迟。[实时通知指南](https://docs.cloudbase.net/recipes/add-realtime-notifications-database-watch)
- `@cloudbase/js-sdk` 自 v3.1 起内置 Node.js 适配能力，因此桌面 Electron/Node 端存在官方 SDK 接入路径。[SDK 服务端/Node 初始化说明](https://docs.cloudbase.net/en/api-reference/webv3-next/server)
- CloudBase 支持自定义登录：服务端用私钥签发 Ticket，客户端换取 access token 与 refresh token；当前 HTTP API 文档列出的 access token 有效期为 2 小时、refresh token 为 30 天。[自定义登录 HTTP API](https://docs.cloudbase.net/http-api/auth/auth-sign-in-custom)
- 数据库安全规则可按 `auth.uid` 和数据内容限制文档读写，默认未定义操作会拒绝；规则是文档级而不是字段级，云函数以开发者身份访问时不受 C 端规则限制。[数据库安全规则](https://cloud.tencent.com/document/product/876/41802)
- 云函数按实际执行计费，空闲为零费用；函数环境变量总大小上限 4 KB。[云函数概述](https://cloud.tencent.com/document/product/876/46899) [系统限制](https://cloud.tencent.com/document/product/876/47177)

### 项目推断

- 让 3 台桌面各订阅只属于自己的“待处理呼叫/撤销”文档，只占 3/10 条连接；手机不在后台常驻，发起呼叫和等待 10 秒确认可使用短 HTTPS 请求或短时订阅。这避免了此前自建 WebSocket 云函数每月约 108,000 资源点的常驻计算问题。
- 权威写操作仍必须进入 3 秒内完成的 HTTPS 云函数，由函数校验 Device Credential、执行“每 Owner 最多一通”的事务/幂等状态机并更新数据库；客户端只获得最小只读 `watch()` 权限，不能直接改变呼叫状态。
- 现有原型中 33 次网关调用、13 次数据库读写和少量计算总计仅 0.53 资源点；在个人低频呼叫下预计远低于 3,000 点/月，但 `watch()` 推送带来的数据库与流量计量仍须在新原型中实测，不能仅凭静态估算宣布免费。
- 直接让 `watch()` 携带权威状态的最大安全阻断项是**即时撤销**：安全规则不会为已建立订阅立即重新鉴权。已接受的解法不是等待 CloudBase token 过期，而是让 `watch()` 只含订阅者已知的固定路由标识和无语义随机变化值、没有业务内容或操作权限；即时撤销由 Cyrene Device Credential/Device Access Token 的权威 HTTPS 边界和 LiveKit 会话终止保证。
- CloudBase 内建 token 的 2 小时/30 天周期也不等同于已确认的 15 分钟 access、180 天 idle、手机 1 年 absolute 和桌面无 absolute。建议将 CloudBase 身份仅作为订阅读取的运输层身份，Device Credential 生命周期仍由权威函数与数据库实现；原型必须证明运输层 token 不会成为绕过撤销的第二权限源。
- 自定义登录私钥和 LiveKit API Secret 不能进入客户端或数据库。CloudBase 官方文档证明函数可使用环境变量，但是否满足项目对“Secret manager”的严格定义仍需安全评审；如必须接入腾讯云凭据管理服务，应另算成本。

### 正式 HTTPS 权限边界（设计结论）

1. **运输层与应用授权分离。** CloudBase 自定义登录只允许桌面读取自己的 Opaque Wake Signal，不授予呼叫查询、确认、配对、撤销或媒体能力。所有权威 HTTPS 读写都使用 15 分钟 Device Access Token；只有 Credential Family 的当前 Device Credential 能换取或轮换它。
2. **唤醒后先重新读权威状态。** 桌面看到随机值变化时不做业务转移，只读取属于自己的当前 Call Availability 和零或一个已分配 Call Request。Device Access Token 过期时只尝试一次正常凭据轮换；如返回撤销、过期、重放或不属于该桌面，必须停止处理且不得凭唤醒内容推断状态。
3. **自动接听仍是幂等权威写入。** 只有权威响应明确给出分配给该桌面的 `AWAITING_DESKTOP` Call Request，且本地 ASR、角色语音和媒体能力仍就绪时，桌面才使用 Call Request 的幂等标识提交确认。重复唤醒、重连或重复确认只能得到同一结果，不能创建第二通电话。
4. **媒体凭据只在接受后分发。** 控制面完成呼叫互斥与桌面确认后，才为本次 LiveKit Media Session 分别向桌面和手机的已鉴权 HTTPS 响应返回各自的短期 LiveKit Token 和同一个临时 E2EE 密钥。这些值不进入 `watch()`、数据库、URL、审计或业务日志，仅允许在已确认的幂等结果窗口内重取。
5. **撤销是一个安全终止操作，不是唤醒操作。** 控制面先原子废止目标 Credential Family、使其未过期 Device Access Token 立即失效，并将待处理或活动 Voice Call 置为 `ENDED / DEVICE_REVOKED`；如有 LiveKit Media Session，同一撤销流程必须移除通话参与者并使未使用的加入凭据不再可用。随后可向仍授权的对端发出 Opaque Wake Signal 促使其刷新；已撤销端即使看到同一随机变化也无法重新读取或加入。

### 首选原型通过条件

1. 在不少于 72 个日历小时的真实日常使用窗口中，1 台虚拟桌面累计至少 12 个清醒且订阅已就绪的小时，并经历至少 3 次普通合盖/系统睡眠后的 Wake Reconciliation；合盖期间不要求保持连接，也不计入有效观察。每次唤醒必须显式关闭旧 `watch()`、重新认证并建立新订阅，取得初始快照和一次 30 秒内的无内容脉冲确认后才能重新标为可用；不得把 SDK 自动重建当成恢复成功。控制台确认实时连接、数据库读写、流量和总资源点，并只用已就绪清醒时长计算连接成本。
2. 至少 3 个独立虚拟 Mobile Device 使用各自凭据先后发起呼叫，并验证一个设备占用 Owner 通话能力后，其他设备被立即以明确的忙碌原因拒绝，不排队、不抢占也不自动重试。
3. 真实手机经大陆 5G 与至少一个外部 Wi-Fi 写入呼叫，目标桌面三轮均在 2 秒内收到；网络切换后自动重连并重新鉴权。
4. 删除/撤销设备后，既有订阅允许在运输层 token 剩余生命期内继续收到 Opaque Wake Signal，但文档必须仅含按桌面隔离所需的标识和无语义随机值；已撤销 Device Credential 必须立即无法读取权威状态或执行操作。任一条件失败则淘汰该方案。
5. 函数重启后，呼叫互斥、幂等结束、配对挑战与凭据轮换状态仍保持。
6. 测试 Secret 不出现在响应、业务日志或数据库中；确认正式 Secret 的托管边界。
7. 以实测 30 天投影保持在免费 3,000 点内；免费环境到期前需要人工续期，应增加 30 天与 7 天提醒。

本项只证明候选运输层可被桌面显式重建；“重新标为可用”在产品中还必须经过 Cyrene 权威 HTTPS 读取与本机 ASR/模型/TTS 就绪检查，不能由原型脉冲或 CloudBase 登录态本身代替。

## 方案二：CloudBase + Ably Free

### 官方事实

- Ably Free 无需信用卡且没有试用期限，含 200 个并发连接、200 个并发频道、500 消息/秒和 600 万消息/月；Free 支持为 best-effort SLO。[Free package](https://ably.com/docs/platform/pricing/free) [平台限额](https://ably.com/docs/platform/pricing/limits)
- Ably 是托管 Pub/Sub，连接由 Ably 服务维持，不需要 Cyrene 的函数实例常驻。官方称其服务可在中国使用，并有客户服务中国用户；同一页面也明确提示中国防火墙可能无预告阻断访问。[边缘网络与中国连接](https://ably.com/docs/platform/architecture/edge-network)
- 客户端不应持有 Ably API Key；正式客户端应从自己的鉴权服务取得短期 token。token 可限制频道能力并支持撤销；可撤销 token 最长 1 小时，撤销默认近乎立即生效。[鉴权概述](https://ably.com/docs/auth) [Token auth](https://ably.com/docs/auth/token) [Token revocation](https://ably.com/docs/auth/revocation)
- Free 的消息历史最多保留 1 天，不适合保存长期设备授权或 90 天审计。[Ably limits](https://ably.com/docs/platform/pricing/limits)

### 项目推断

- CloudBase 继续保存权威设备、呼叫与审计数据，并用短时云函数签发频道最小权限 token；Ably 只通知桌面“权威状态已变化”，桌面仍向 CloudBase HTTPS 获取并确认状态。这样 Ably 不成为第二套权威数据库。
- 3 台桌面常驻连接远低于 200；控制事件远低于 600 万条/月，预计 ¥0。但 Free 明确面向试验/PoC且仅 best-effort，不能把“无试用期限”解释为生产 SLA。
- 该方案比 CloudBase `watch()` 多一个厂商、一个 API Key、token 签发与故障域；只有当 CloudBase `watch()` 的即时撤销或 SDK 兼容性失败时才值得采用。
- 大陆必须做真实 WSS 72 小时测试。即使通过，仍只能证明当前运营商路径可用，不能消除 Ably 官方所述的“可能无预告阻断”风险。

## 方案三：Cloudflare Workers + Durable Objects

### 官方事实

- Workers Free 提供 100,000 请求/天，每次请求 10 ms CPU；一次 WebSocket Upgrade 计一次 Worker 请求，之后经 Worker 转发的 WebSocket 消息不再计普通 Worker 请求。[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- Durable Objects 已向 Free 开放，Free 只能使用 SQLite 后端；包含 100,000 DO 请求/天、13,000 GB-s/天、5 GB 总存储、500 万行读/天和 100,000 行写/天，超额后对应操作失败而不是自动计费。[Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- 使用 WebSocket Hibernation API 时，客户端连接仍保持，但 Durable Object 可退出内存；休眠期间不累计计费时长，消息到达时再唤醒。使用普通 `accept()` 则连接期间持续累计时长。[WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- SQLite Durable Object 提供事务性、强一致、对象私有存储和单线程协调，适合串行化单 Owner 呼叫状态。[Durable Objects 概念](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/)
- Workers Secrets 的值写入后不会在控制台或 Wrangler 中显示；WebCrypto 支持 HMAC、签名、验签与 constant-time 比较。[Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/) [Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
- Cloudflare 官方说明，大陆边界外服务到中国用户会遇到显著延迟与可靠性问题；正式大陆能力由京东云运营的 China Network 提供，仅面向 Enterprise 单独订阅，每个根域名需要有效 ICP。[China Network](https://developers.cloudflare.com/china-network/) [China Network FAQ](https://developers.cloudflare.com/china-network/faq/)
- China Network 当前产品清单列出 Workers、Workers KV、Secrets 和 WebSockets，但没有 Durable Objects、D1 或 Queues；Cloudflare 也明确并非所有产品都在境内网络可用。[China Network 可用产品](https://developers.cloudflare.com/china-network/reference/available-products/)
- KV 是最终一致存储，跨 PoP 更新可能需要 60 秒或更久，不适合撤销、凭据轮换或呼叫互斥。[KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/)
- Queues Free 为 10,000 operations/天且固定保留 24 小时；Cyrene 已决定离线呼叫不排队，因此 V1 不需要 Queues。[Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/) [Queues limits](https://developers.cloudflare.com/queues/platform/limits/)

### 项目推断

- 若忽略大陆承诺，单个 SQLite Durable Object + Hibernating WebSockets + Secrets 足以实现全部 V1 控制面，并且本项目规模预计 ¥0；D1、KV、Queues 都不是 V1 必需组件。
- 但“Cloudflare Global 在某次大陆测试可连”不能替代官方大陆支持。China Network 又需要 Enterprise/ICP，且没有 DO，因此该方案当前不满足已确认的生产门槛。它只适合作为机会型免费实验，不应排在国内 CloudBase `watch()` 前面。

## 方案四：Supabase Free

### 官方事实

- Supabase Realtime 提供托管 WebSocket；Free 为 200 并发连接、100 消息/秒、每连接 100 channels，月配额 200 万 Realtime 消息。[Realtime protocol](https://supabase.com/docs/guides/realtime/protocol) [Realtime limits](https://supabase.com/docs/guides/realtime/limits) [Realtime pricing](https://supabase.com/docs/guides/realtime/pricing)
- Supabase 自动提供 PostgREST HTTPS API；Free 含 500 MB 数据库、5 GB egress、500,000 次 Edge Function 调用和 50,000 MAU。[Data API](https://supabase.com/docs/guides/api) [Pricing](https://supabase.com/pricing)
- 私有 Realtime channel 可通过 `realtime.messages` 表上的 RLS 控制读写；鉴权在 join 时计算并缓存，收到新 JWT 时更新。[Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization)
- Edge Function 可使用 Dashboard/CLI 管理的 Secret，Free 的函数限制为 150 秒 wall-clock、2 秒 CPU、最多 100 个函数和每项目 100 个 Secret。[Function secrets](https://supabase.com/docs/guides/functions/secrets) [Function limits](https://supabase.com/docs/guides/functions/limits)
- Anonymous Sign-In 会创建真实 authenticated user，清除本地数据或重装后无法恢复原身份，契合“重装为新实例”。refresh token 单次使用，默认允许 10 秒 reuse；异常重复使用会终止该 session。[Anonymous Sign-In](https://supabase.com/docs/guides/auth/auth-anonymous) [Sessions](https://supabase.com/docs/guides/auth/sessions)
- inactivity timeout、time-box 和 single-session enforcement 仅付费 Pro 及以上提供；Free 默认 session 可长期存在。[Sessions](https://supabase.com/docs/guides/auth/sessions)
- Free 项目在 7 天低数据库活动后可能自动暂停；阈值不是承诺值，暂停后 90 天内可恢复。Free 没有 uptime SLA，也不应依赖托管日备份。[Free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing) [Pricing/SLA](https://supabase.com/pricing) [Backups](https://supabase.com/docs/guides/platform/backups)
- 官方托管区域包括东京、首尔、新加坡等，但没有中国大陆；官方公开资料没有大陆 HTTPS/WSS 可用性或时延承诺。[Regions](https://supabase.com/docs/guides/platform/regions)

### 项目推断

- 8 个设备容量远低于 Free 限制。即使非常保守地把每 25 秒心跳应答都算作消息，3 台桌面全天约 62.2 万帧/月，仍低于 200 万；但官方计费文档未明确 heartbeat 是否计数，必须看 Usage 实测。
- Free 不会自动产生超额账单，容量上适合 Cyrene；但个人低频通话恰好容易触发 7 天低活动暂停，与“长期配对后随时来电”冲突。通过人为 keepalive 避免暂停没有官方阈值保证。
- 内建 auth 不能直接实现 30 秒 replay、180 天 idle、手机 1 年 absolute 和桌面无 absolute，仍需 Edge Function + Postgres 自研 Device Credential 状态。
- 最大阻断仍是大陆跨境 HTTPS/WSS 和免费项目暂停。除非连续多日真实网络测试和恢复行为都通过，否则不应作为正式首选。

## 方案五：Firebase Realtime Database Spark

### 官方事实

- Spark 免费计划的 Realtime Database 支持 100 个并发连接、1 GB 存储和 10 GB/月下载；无需付款信息，超出免费配额后该产品在当月剩余时间关闭，而不是自动计费。[Realtime Database limits](https://firebase.google.com/docs/database/usage/limits) [Billing](https://firebase.google.com/docs/database/usage/billing) [Firebase plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)
- Realtime Database 同时提供实时 SDK 与 HTTPS REST API，REST 强制 HTTPS。[REST API](https://firebase.google.com/docs/reference/rest/database/)
- Firebase Authentication 与 Security Rules 可保护用户数据；App Check 可用 Android Play Integrity 验证请求来自真实应用/设备。[App Check](https://firebase.google.com/docs/app-check)
- Realtime Database 只有 Iowa、Belgium、Singapore 三个地域，没有中国大陆。[Database locations](https://firebase.google.com/docs/database/locations)
- Firebase SLA 排除 Firebase 服务边界之外的互联网访问问题；Spark 没有可产生服务赔偿的实际账单基础。[Firebase SLA](https://firebase.google.com/terms/service-level-agreement)

### 项目推断

- 100 条连接与存储/流量足够本项目，且实时连接不占自有函数实例；技术上属于成熟免费实时托管方案。
- 但新加坡地域和 Google/Firebase 域名没有大陆连通承诺，跨境 WSS 风险不低于 Supabase；在已有 CloudBase 国内候选时，不值得优先投入原型。
- 自定义设备凭据、LiveKit token 签发及权威状态机仍需要可信后端；Spark 不包含可用的 Google Cloud Functions 付费能力，因此通常还要组合另一家后端，复杂度高于 CloudBase `watch()`。

## 为什么不直接整套接入这些平台

- **可复用：** CloudBase/Supabase/Firebase 的实时订阅、托管数据库和安全规则；Cloudflare DO 的强一致协调与休眠 WebSocket；Ably 的托管 Pub/Sub 和短期频道 token。
- **必须自研：** Deployment Bootstrap Code、Owner Recovery Key、设备配对审批、Device Credential family 轮换与异常重放撤销、3+5 数量限制、Preferred Desktop、每 Owner 一通、10 秒确认/30 秒媒体连接/30 秒重连/4 小时上限、成本保护、LiveKit E2EE key 的瞬时分发以及最小 90 天审计。这些都是 Cyrene 的领域规则，任何候选平台都不会原生提供完整且一致的实现。
- **不整套接入原因：** 境外平台缺少大陆可靠性承诺；通用 Auth 的 session 语义与既定设备凭据不同；免费层可能暂停或只提供 best-effort；把平台内建 Auth 当成唯一权威会形成无法即时撤销的第二权限源。

## 下一步建议

CloudBase 直接 `watch()` 传递权威状态的方案已否决；不透明唤醒安全原型已通过。实测中，普通桌面身份直读权威集合被拒绝，已撤销 Device Credential 立即只能得到 `DEVICE_REVOKED`，旧 `watch()` 虽继续收到两次后续唤醒，但所有快照都只含 `_id`、`desktopUid`、`wakeNonce`。因此 CloudBase 继续作为当前首选，Ably 保留为安全分层回归失败时的备选。最终锁定前还需两类证据：一是在真实合盖/唤醒下的 72 日历小时、12 清醒小时、3 次显式订阅重建的计量与稳定性观测；二是在正式 HTTPS 路由中验证 Credential Family 轮换、撤销和 LiveKit 活动参与者移除。本阶段仍不开始正式实现。

最初的“连续 72 小时不合盖”观测于 2026-07-22 16:22:10 CST 启动，启动前环境当日累计用量为 0.47 资源点；在 Owner 正常合盖返家后，SDK 自动 `REBUILD_WATCH` 失败，继而出现一次函数调用失败和一次脉冲超时。该原始状态与日志已保留，既不冒充连续通过，也不把 Owner 已明确允许的合盖暂停判为产品失败。它证明正式桌面不能依赖 SDK 自动恢复，因此该进程已停止，改用上段的真实使用/显式重建口径重新观察。

此前两轮原型的函数、集合和外部测试用户已删除并复核。本轮没有修改正式实现代码，但为修订后的观察而**有意保留**三项带原型前缀的资源：函数 `cyrene_watch_stability_prototype_control`、集合 `cyrene_watch_stability_prototype_wakeups` 与测试用户 `cyrene_watch_stability_desktop`；观测结束后只删除这三项并逐项复核。CloudBase 环境本身始终保留，绝不作为原型清理目标。
