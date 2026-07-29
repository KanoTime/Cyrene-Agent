# LiveKit Cloud 中国大陆网络与成本闸门

> 调研日期：2026-07-22
>
> 范围：仅核验 LiveKit 官方文档、官方定价页、官方状态页和官方 API Reference；未创建账号、未调用 API、未读取凭据，也未执行真实媒体连通性测试。
> 目的：判断“大陆网络必须支持、每通 LiveKit E2EE、撤销设备立即结束整通电话”能否以 LiveKit Cloud 作为 V1 媒体候选的事实边界。本文不是法律、备案、数据驻留或运营商合规意见。

## 结论摘要

1. **在本轮已核验候选中，LiveKit Cloud 是唯一有公开 token 撤销承诺的路径。** `RemoveParticipant` 会强制断开当前参与者；在 Cloud 上还会立即撤销其 access token，使旧 token 不能立即重连。自托管同一操作不会使既有 token 失效，只能以短 TTL 缩小风险窗口。[参与者管理](https://docs.livekit.io/intro/basics/rooms-participants-tracks/participants/) [Token revocation](https://docs.livekit.io/frontends/reference/tokens-grants/#token-revocation)
2. **中国大陆网络硬要求尚未通过。** LiveKit 官方已公布的可固定区域中，亚太只有日本和新加坡，列表没有中国大陆；官方状态页也没有中国大陆实时通信或 TURN 组件。所核验的官方资料没有给出中国大陆可用性、时延、SLA、数据驻留或网络连通性承诺。这不证明一定无法连接，但不足以把 Cloud 写成“已支持大陆网络”。[区域固定](https://docs.livekit.io/deploy/admin/regions/region-pinning/) [官方状态页](https://status.livekit.io/)
3. **免费档可作为受控验证与小规模候选，但它是可用性硬上限，不是无限免费。** Build 为 `$0/月`、无需信用卡，含每月 5,000 WebRTC participant-minutes 和 50 GB 下行数据；额度耗尽后新请求失败、不产生超额费用，且免费额度在同一用户的免费项目之间共享。[官方定价](https://livekit.com/pricing) [配额与限制](https://docs.livekit.io/deploy/admin/quotas-and-limits/)
4. **因此当前推荐结论不是“锁定 LiveKit Cloud”，而是：在已核验候选中保留它作为满足公开即时 token 撤销边界的媒体候选，同时把中国大陆真实网络验证设为阻塞闸门。** 若该闸门失败，不能用“全球边缘网络”或短 TTL 替代大陆支持和即时旧 token 撤销的要求。

## 1. Cloud 区域与中国大陆官方承诺

LiveKit Cloud 说明默认让用户连接到最近的边缘区域；这是全局网络的高层描述，不等于对任何特定国家、运营商、协议或时延作出承诺。[LiveKit Cloud 概览](https://docs.livekit.io/intro/cloud/)

官方“区域固定”文档（页面标注最后更新于 2026-05-14）列出的可固定区域如下：

| 可固定区域 | 官方列出的地点 | 与中国大陆硬要求的关系 |
| --- | --- | --- |
| `asia` | 日本、新加坡 | 不是中国大陆区域。 |
| `us`、`eu`、`india`、`me`、`africa`、`aus`、`il`、`sa`、`uk` | 美国；法国/德国；印度；沙特/阿联酋；南非；澳大利亚；以色列；巴西；英国 | 均不是中国大陆区域。 |

区域固定仅适用于 LiveKit Cloud 网络流量，并且只对 Scale 及更高套餐开放；官方定价页显示 Scale 起价 `$500/月`。即使付费启用，它的已列选项也不提供中国大陆目标区域。[区域固定](https://docs.livekit.io/deploy/admin/regions/region-pinning/) [官方定价](https://livekit.com/pricing)

作为交叉证据，官方状态页在本次核验时列出日本、新加坡、印度、澳大利亚等“Regional Real Time Communication”和 TURN 组件，但没有中国大陆组件。状态页反映的是服务组件健康度，不是地域覆盖清单或中国大陆 SLA；它不能单独证明不可达，也不能补足官方的中国大陆承诺。[LiveKit 官方状态页](https://status.livekit.io/)

### 官方资料的空白与正确表述

- 在本次核验的官方资料中，**没有找到**中国大陆 Cloud 区域，或“在中国大陆可用/可支持”的明确承诺。
- 也没有找到针对中国大陆 5G、家庭宽带、普通 Wi-Fi、企业网络、跨网切换、TURN/TLS 成功率或端到端音频质量的承诺。
- LiveKit Cloud 确实支持 ICE/UDP、TURN/UDP、ICE/TCP 和 TURN/TLS，且 Cloud 管理 TURN/TLS；这说明它具备一般网络降级路径，**不构成**中国大陆网络可用性的证明。[连接可靠性](https://docs.livekit.io/intro/basics/connect/)

所以只能写成：**“LiveKit Cloud 值得在中国大陆真实网络中验证。”** 不能写成“官方保证中国大陆可用”，也不能由文档空白反向断言“一定不可用”。

## 2. Cloud 与自托管的即时参与者撤销边界

| 情形 | LiveKit Cloud 的官方行为 | 自托管的官方行为 | 对 Cyrene 要求的结论 |
| --- | --- | --- | --- |
| 当前已连接 participant | `RemoveParticipant` 强制断开；Cloud 还立即撤销该 participant 当前 access token。 | `RemoveParticipant` 的断开语义仍适用，但移除不会使既有 token 失效。 | 要“立即结束整通电话且旧凭据不能重连”，不能只依赖自托管移除。 |
| 已离开但缓存旧 token 的 identity | 可用同一 `(room, identity)` 调用 `RemoveParticipant`；官方说明即使返回 participant 不存在，Cloud token 撤销仍会发生。 | 旧 token 不会因移除而失效；官方建议短 TTL，且应用后端不要再为该 participant 发新 token。 | Cloud 能提供旧 token 的参与者级截止；自托管不等价。 |
| 已签发、identity 从未成功加入 | 官方文字只明确举“已经离开”的 participant；虽同样可能表现为不存在，但未单列“从未加入”的供应商保证。 | 无即时 token 撤销。 | 必须以真实 Cloud 验收验证“先签发、未连接、撤销、旧 token 加入失败”；此项不能提前当成已证明事实。 |

上述 Cloud 撤销按 `(room, identity, nbf 截止时间)` 工作，而非按某个 JWT 文本或 `jti` 精确撤销；`revoke_token_ts` 是 Cloud 专属参数。移除、更新权限和 token 生命周期的边界均以官方 Token/Grant 文档为准。[Token revocation](https://docs.livekit.io/frontends/reference/tokens-grants/#token-revocation) [RoomService `RemoveParticipant`](https://docs.livekit.io/reference/other/roomservice-api/#removeparticipant)

`DeleteRoom` 可以断开房间内所有当前参与者，但官方没有把它描述为 token 撤销 API；因此它不能取代对每个 call-scoped identity 的 Cloud `RemoveParticipant`。客户端被服务端移除或房间删除时会收到不同的断开原因，这也说明两者职责不同。[连接与自动断开](https://docs.livekit.io/intro/basics/connect/)

### 对“撤销设备立即结束整通电话”的可验证编排

这是从上述官方能力与 Cyrene 已确认要求得出的**项目推断**，不是 LiveKit 自动替产品完成的业务事务：

1. 控制面先原子拒绝被撤销设备的后续 Media Join Grant，并将当前 Voice Call 标为安全终止。
2. 对该通随机且不复用房间中的**手机与桌面两个 call-scoped identity**，都要求 Cloud `RemoveParticipant` 成功；只移除被撤销的一端，不足以兑现“整通电话结束”。
3. 可以额外 `DeleteRoom` 收束仍在线的一方，但它不是旧 token 失效的证据。
4. 只有 Cloud API 的成功结果加上真实“旧 token 无法重连”的测试，才能把媒体撤销记为已完成；控制面本地状态更新、短 TTL、token 自然过期或 `UpdateParticipant` 都不是等价替代。

LiveKit 的 E2EE 不改变上述房间管理/撤销边界。官方说明 E2EE 同时适用于 Cloud 与自托管、无额外费用；它保证中间方不能读取或修改内容，但密钥生成、存储和分发仍由应用负责。[E2EE 概览](https://docs.livekit.io/transport/encryption/)

## 3. 当前成本、免费额度与一对一音频计量

### 3.1 Build 免费档

| 项目 | 当前官方信息 | 对个人一对一音频的含义 |
| --- | --- | --- |
| 套餐 | Build `$0/月`，无需信用卡。 | 可先做不付费的真实网络/撤销验证。 |
| WebRTC | 每月 5,000 WebRTC participant-minutes；定义为“一位用户通过 LiveKit SDK 连接到 Cloud 的时间”。 | 仅手机与桌面两端在线时，1 分钟通话约消耗 2 participant-minutes，因此名义上最多约 2,500 分钟（约 41 小时 40 分钟）双端通话；短连接按端点分别向上取整，实际可用时长可能更少。 |
| 下行数据 | 每月 50 GB；包括 Cloud 向 participant 输出的媒体和 data packets。 | 官方未公布“纯一对一音频”的固定码率或每分钟固定流量，不能从官方资料严谨算出 50 GB 可支撑的通话小时数；必须用真实 E2EE 音频观测数据。 |
| 并发 | Build 默认 100 位 participant。 | 当前单 Owner、每次一通、一桌面加一手机不受该数值限制。 |
| 耗尽行为 | 免费额度是硬上限；超出后新请求失败，不产生超额费用；同一用户所有免费项目共享额度，按日历月重置且不结转。 | “免费”以届时拒绝新请求为代价，不能把它当作对长期可用性的承诺。 |

来源：[LiveKit 官方定价](https://livekit.com/pricing) [官方配额与限制](https://docs.livekit.io/deploy/admin/quotas-and-limits/) [官方计费计量](https://docs.livekit.io/deploy/admin/billing/)

时间按 1 分钟最小粒度、数据按 0.01 GB 最小粒度分别向上取整；官方示例中 10 秒连接已计 1 connection-minute。故上表的 2,500 分钟只是“两个 endpoint 持续在线、没有额外 participant、未受数据上限约束”的上界算术，不能作为月度容量承诺。[官方计费计量](https://docs.livekit.io/deploy/admin/billing/)

### 3.2 付费档与成本红线

- Ship 起价 `$50/月`；其 WebRTC 额度为 150,000 participant-minutes，额度外 `$0.0005/participant-minute`，下行流量额度外 `$0.12/GB`。Scale 起价 `$500/月`，才具备官方的区域固定功能。[LiveKit 官方定价](https://livekit.com/pricing)
- E2EE 本身没有官方另行列出的附加费用；它在 Cloud 和自托管都标为无额外成本。它不消除 WebRTC participant-minute 和下行数据两类计量。[E2EE 概览](https://docs.livekit.io/transport/encryption/)
- 官方 Token revocation 文档只写“Cloud-only”，没有在该功能处给出 Build/Ship/Scale 的额外套餐限制；本研究不能把“未列限制”扩大表述成未来永久的免费额度承诺。[Token revocation](https://docs.livekit.io/frontends/reference/tokens-grants/#token-revocation)

对当前“优先免费、控制成本”的取舍而言，Build 有价值；但 Ship 的起价已远高于 ¥50/月这一数量级，Scale 更不应被当作大陆网络问题的低成本解法。若日后需要付费套餐，必须另行获得 Owner 对 LiveKit 媒体费用的明确批准，而不是从控制面免费实验自动推导。

## 4. V1 可以与不能得到的结论

### 可以有条件地继续验证

- LiveKit Cloud 能承载每通 E2EE，且官方说明这不额外收费；端点之外的中间方（包括 LiveKit 服务器）不能由此读取端到端加密的媒体内容。[E2EE 概览](https://docs.livekit.io/transport/encryption/)
- 对已连 participant，Cloud `RemoveParticipant` 提供“强制断开 + 当前 token 立即撤销”的官方边界；这比自托管的短 TTL 模式更接近 Device Revocation 的要求。[参与者管理](https://docs.livekit.io/intro/basics/rooms-participants-tracks/participants/) [Token revocation](https://docs.livekit.io/frontends/reference/tokens-grants/#token-revocation)
- 免费 Build 的 5,000 participant-minutes / 50 GB 足以作为小规模、可上限控制的真实验证候选，前提是接受额度耗尽时新请求失败。[配额与限制](https://docs.livekit.io/deploy/admin/quotas-and-limits/)

### 现在不能写成已满足

- 不能把 LiveKit Cloud 写成“官方承诺中国大陆网络可用”或“有中国大陆区域”。已核验官方区域与状态资料没有这个证据。
- 不能以 Cloud 的全球边缘、TURN/TLS 或正常状态页替代真实中国大陆 5G、家庭宽带和普通 Wi-Fi 的 E2EE 端到端验证。
- 不能以自托管 `RemoveParticipant`、短 TTL、token `exp` 或 `DeleteRoom` 替代 Cloud 的旧 token 即时撤销。
- 不能把“identity 从未加入但旧 token 已被撤销”写成供应商已明示保证；需专门验收。
- 不能把 50 GB 换算为固定音频小时数，或把免费额度视为不限量、各项目独立、永不变更的长期成本承诺。

## 5. 正式选型前必须通过的真实闸门

本研究未执行以下测试；它们是未来真实项目在不记录音频/转写/E2EE 密钥的前提下应完成的验收，而不是本轮实施授权。具体的最小测试顺序、证据白名单与免费额度保护见[媒体候选验收协议](media-candidate-acceptance-protocol.md)：

1. **大陆可达性：** 同一 LiveKit Cloud 项目在中国大陆手机 5G、家庭宽带、外部普通 Wi-Fi 下各进行 E2EE 双端接通、双向音频、网络切换和 30 秒重连测试；记录只含时间、网络类别、连接/断开原因、端到端时延与计量，不记录内容。
2. **即时撤销：** 两端已在同一 E2EE 房间时撤销一台设备；控制面停止新凭据、Cloud 对两个 identity 的 `RemoveParticipant` 获得成功确认，双方均被断开，旧 token 不能重连。
3. **预加入撤销：** 两端 token 已签发但尚未连接；撤销后按两个 identity 调用 Cloud API，再尝试原 token 加入，必须失败。此项验证官方尚未单列的“从未加入”边界。
4. **免费额度保护：** 在一个日历月内核对 participant-minutes 与下行数据；接近额度时拒绝新通话/凭据并保留撤销与安全操作，不能让超额失败表现成“静默挂断”。
5. **替代判定：** 任一大陆网络核心路径稳定失败，或预加入撤销不通过，则 LiveKit Cloud 不能作为满足当前 V1 硬要求的唯一媒体方案；不能仅用自托管短 TTL 将该失败标为通过。

## 官方来源

- [LiveKit Cloud 概览与 Cloud/self-hosted 对比](https://docs.livekit.io/intro/cloud/)
- [LiveKit 区域固定](https://docs.livekit.io/deploy/admin/regions/region-pinning/)
- [LiveKit 官方状态页](https://status.livekit.io/)
- [连接可靠性与自动重连](https://docs.livekit.io/intro/basics/connect/)
- [Token 与 grants / token revocation](https://docs.livekit.io/frontends/reference/tokens-grants/)
- [参与者管理 / RemoveParticipant](https://docs.livekit.io/intro/basics/rooms-participants-tracks/participants/)
- [RoomService API](https://docs.livekit.io/reference/other/roomservice-api/)
- [LiveKit E2EE 概览](https://docs.livekit.io/transport/encryption/)
- [LiveKit Cloud 官方定价](https://livekit.com/pricing)
- [Cloud 配额与限制](https://docs.livekit.io/deploy/admin/quotas-and-limits/)
- [Cloud 计费计量](https://docs.livekit.io/deploy/admin/billing/)
