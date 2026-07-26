# 公网控制面最小数据边界契约

> 状态：厂商无关的数据最小化契约，不是数据库模式、隐私政策或部署授权。领域含义以 [CONTEXT.md](../../CONTEXT.md)、[ADR-0027](../adr/0027-use-a-managed-serverless-public-control-plane.md)、[ADR-0030](../adr/0030-let-only-the-public-control-plane-sign-livekit-tokens.md) 与 [ADR-0037](../adr/0037-use-content-free-wake-signals-before-authoritative-reads.md) 为准。

## 目的

公网控制面只协调异地设备授权与一通即时电话；它不是 Cyrene 的对话、角色或媒体数据库。数据能否进入该边界，由“没有它还能否做当前授权、即时协调、撤销或最小审计”决定，而不是由云厂商是否方便保存决定。

本契约约束 Cyrene 应用主动写入、返回和审计的产品数据。云厂商不可避免的基础设施访问日志、计费记录、网络地址或故障遥测不因此变成 Cyrene 的产品字段；正式部署前必须单独审查供应商的可配置保留、访问控制和地域政策，且产品不得额外把这些值复制进业务库或 Security Audit Event。

## 允许的最小操作数据

| 目的 | 可以暂存的最小数据 | 生命周期与公开面 |
| --- | --- | --- |
| Owner 与部署 | 单 Owner 的不透明 ID、Deployment Bootstrap Code / Owner Recovery Key 的验证资料、初始化与恢复状态。 | 仅控制面授权路径；明文秘密不保存、不返回第二次。 |
| 设备授权 | 不透明 Device ID、类别、用户确认的显示标签、Credential Family 的可验证资料/状态、最后授权使用时间、撤销版本和 3+5 上限计数。 | 仅为当前授权、轮换、撤销和闲置/离线期限而保留；不保存明文 Device Credential 或硬件指纹。 |
| 配对 | 目标类型、创建桌面、到期时间、候选的最少标签、短时邀请/校验资料的验证值和终态。 | 挑战最多 2 分钟；终态不保留邀请、短码或校验码明文。 |
| 呼叫协调 | Call Coordination Record：两端 Device ID、阶段、幂等键的最小结果、10/30/30 秒与 4 小时/空闲期限、最小拒绝/终止原因、锁定角色 ID 与动态显示名。 | 仅在未终态即时协调期间；终态时只能移交最小 Media Revocation Work Item，不形成队列、通话历史或角色历史。 |
| 媒体撤销 | 仅限当前终态安全收束的随机房间名、两个 call-scoped participant identity、签发/撤销状态、必要截止点和媒体服务确认/重试状态。 | 终态立即停止 grant 并保持 Owner 媒体安全占用；映射仅保留到已选媒体服务撤销确认或显式 fail-closed 处置为止，随后删除。当前 LiveKit Cloud 仅为待实测候选；不保存 LiveKit API Secret、原始 Token、E2EE 密钥或密钥哈希。 |
| 可用性与唤醒 | 短期 Call Availability lease、最小角色显示名、订阅者已知的固定路由标识与随机 wakeNonce。 | lease 到期自然失效；`watch()` 不承载业务状态、时间戳、操作指令或秘密。 |
| 最小安全审计 | 相关不透明主体、类别、结果、稳定理由与服务端时间。 | 最多 90 天；不是通话记录，不含请求正文或秘密。 |

## 明确禁止的数据

以下任何内容都不得写入应用数据库、`watch()` 文档、Media Join Grant 的持久副本、业务日志、错误正文、崩溃报告或 Security Audit Event：

- 音频、视频、PCM、媒体片段、转写、ASR 中间结果、TTS 文本、角色回复、对话历史、提示词、记忆、模型输入输出和本地模型凭据；
- Device Credential、Owner Recovery Key、Deployment Bootstrap Code、LiveKit API Secret、原始 LiveKit Token、E2EE 密钥/密钥哈希、Media Join Grant 或配对邀请/短码/校验码；
- 原始 IP、精确位置、设备指纹、IMEI、Android ID、浏览/应用行为画像、桌面本机路径、进程诊断和原始异常堆栈；
- 被撤销/结束后可重建同一电话的房间、参与者身份、密钥或客户端状态快照；唯一例外是等待媒体服务撤销确认的短时 Media Revocation Work Item，且它不能恢复呼叫或签发资料。

## 访问、删除与最小审计

1. 客户端不能直接写权威授权或呼叫状态；所有权威变更经 Device Credential 认证的 HTTPS 控制面完成。实时订阅只接收 Opaque Wake Signal，随后重新权威读取。
2. Call Coordination Record 进入 `ENDED`、Device Revocation 或 Authorization Rebootstrap 时，先停止媒体资料领取并把 Voice Call 置为不可恢复终态；随后用短时 Media Revocation Work Item 对两个 call-scoped identity 请求媒体服务撤销。收到成功确认后立即删除房间/identity 映射，只留下最小 Security Audit Event；若媒体服务失败，只能保留该最小工作项以 fail-closed 地重试和显式处置，绝不能重新签发资料或恢复通话。终态不能因为缓存、`watch()`、旧 Token 或唤醒信号恢复。
3. Security Audit Event 的 90 天删除是上限，不是保证保存满 90 天；应使用服务端时间和可验证清理作业，删除后不能借审计恢复设备授权或通话。
4. Device 授权记录的生命周期由有效授权、180 天闲置/离线、手机 1 年绝对期限、撤销与授权重建约束；到达终态后只保留重放防护或法定/平台必要的最小验证资料，具体删除时点必须在正式规格中与 Credential Family 安全需要一起明确，不能把“以后可能有用”作为永久保留理由。

## 后续验收

- 对控制面数据库、函数日志、`watch()` 载荷、错误输出、审计、移动持久存储和构建产物做字段白名单扫描；上述禁止数据必须为零。
- 建立、结束、撤销和授权重建一通电话后，验证新的 grant 立即不可领取、两个 identity 的媒体撤销均得到确认，随后房间/identity 映射与媒体资料均不可再查询，只剩不含内容的最小审计事实；故意注入媒体撤销失败时，只允许短时 fail-closed 工作项存在，不能假装已经清理成功。
- 到期的 Availability、Pairing Challenge 和 90 天审计均按服务端时间清理；清理失败必须告警而不是静默延长保留。
- 使用大陆网络、真实 LiveKit Cloud 与正式控制面时，单独记录供应商不可避免的基础设施日志/计费元数据，确认 Cyrene 没有把它们复制为业务字段或对用户作出“零元数据”的虚假承诺。
