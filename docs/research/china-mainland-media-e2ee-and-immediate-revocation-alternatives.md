# 中国大陆媒体候选：E2EE 与即时撤销边界

> 调研日期：2026-07-22
>
> 范围：只比较已用官方资料核验的 LiveKit Cloud 与腾讯云 TRTC；未创建账号、未领取试用、未调用 API、未发送音频，也未读取任何凭据。本文不是地域合规、数据驻留或运营商 SLA 意见。

## 要回答的问题

Cyrene V1 同时要求：

1. 中国大陆手机 5G、家庭宽带和普通 Wi-Fi 能完成一对一语音；
2. 每通媒体端到端加密、禁止明文降级；
3. Device Revocation 立即结束整通电话，并让已签发但未加入的本次媒体资料不能继续加入；
4. 优先免费，不得因为候选切换自动产生未经 Owner 允许的付费。

“已踢出当前房间”与“已签发但尚未使用的加入资料立即失效”是两条不同能力，后者不能被短 TTL、自然过期或仅删除房间冒充。

## 结论

在已核验的两个候选中，**没有一个可以现在直接宣布同时满足全部 V1 硬要求**：

- **LiveKit Cloud** 是当前唯一有公开 participant-identity token 撤销语义的候选，免费 Build 可做小规模验证；但官方没有中国大陆可用性承诺，且“已签发但从未加入”仍需真实 Cloud 验收。
- **腾讯云 TRTC** 有中国大陆产品/API 路径，能服务端结束当前房间；但官方“媒体流私有加密”要求旗舰版/旗舰版 Plus 和业务审核，支持列表未列 Electron，且公开资料没有按单个已签发 UserSig/PrivateMapKey 立即失效的稳定契约。

因此目前不锁定媒体厂商、不变更 LiveKit E2EE 决策，也不消耗任何试用。优先路径仍是：先把 LiveKit Cloud 当作零成本、可删除的**真实大陆网络与撤销验证候选**；若它在真实网络失败，再以明确的新 ADR 重新评估需要放宽的约束或新的成熟服务，而不是把 TRTC 的短 TTL 当作等价的即时撤销。

## 对比

| 维度 | LiveKit Cloud | 腾讯云 TRTC |
| --- | --- | --- |
| 中国大陆证据 | 官方区域固定列表的亚太只有日本/新加坡，未见中国大陆可用性或 SLA 承诺；必须做真实大陆网络验收。 | 官方提供广州、上海、南京、北京、成都、重庆等 API 接入域名，也有大陆站产品路径；但这些 API 域名不等于媒体地域或三网 SLA，仍须实测。 |
| 媒体加密 | LiveKit E2EE 由应用分发每通密钥；Owner 已选择方案 A，控制面在短暂进程内存生成并可读该密钥，但不持久化，LiveKit Cloud 服务器不持有该密钥。 | “媒体流私有加密”要求同房端点使用相同 AES-GCM 密钥/盐；官方示例由业务服务器生成并下发，因而腾讯云不可解密不等于控制面不可读。 |
| 已加入参与者的立即结束 | Cloud `RemoveParticipant` 强制断开，并具有 participant identity 级旧 token 撤销边界；需要真实项目验证。 | `RemoveUser` 可移出指定用户，`DismissRoom` 可移出房间全部用户并结束当前通话。 |
| 已签发、未加入资料 | 官方文档明确“已离开”身份的撤销，未单列“从未加入”；必须专门验证“签发 → 撤销 → 原 token 加入失败”。 | 未找到公开的单个 UserSig/PrivateMapKey 即时作废契约；短时有效期只缩短窗口，不能等价。 |
| 桌面/Android | 当前 Cyrene 已有 LiveKit 桌面/Android 代码基础；正式 E2EE 仍须在签名 APK 与桌面验收。 | 基础 TRTC 支持 Electron，但官方私有加密支持列表列 Android、Windows、macOS 等，未列 Electron；不能直接宣称当前桌面支持。 |
| 免费/费用边界 | Build `$0/月`，含 5,000 WebRTC participant-minutes 与 50 GB 下行，额度耗尽会拒绝新请求而非自动收费；一对一双端持续在线约为 2,500 分钟的理论上界。 | 入门版为 ¥0/月但默认音视频按量；纯语音约 ¥7/千在房分钟。私有加密需旗舰版/旗舰版 Plus，旗舰版当前 ¥6,250/月，属于必须另行 Owner 批准的成本，不能用一次性免费时长包掩盖。 |

## 事实与边界

### LiveKit Cloud：撤销能力优先，但大陆可用性尚未证明

Cloud `RemoveParticipant` 可强制断开当前 participant，并在 Cloud 上撤销该 identity 的旧 token；自托管部署中，官方明确移除 participant 或更新权限不会让既有 token 失效。撤销粒度是 `(room, identity, nbf 截止时间)`，不是任意一枚 JWT 或 `jti`。这让 Cloud 成为当前已研究候选中最接近“旧资料不可重连”的路径，但不代表“从未加入的 identity”已经被供应商无条件保证。[LiveKit Token revocation](https://docs.livekit.io/frontends/reference/tokens-grants/#token-revocation) [LiveKit RoomService API](https://docs.livekit.io/reference/other/roomservice-api/#removeparticipant)

官方区域固定列表没有中国大陆区域，状态页也没有中国大陆实时通信/TURN 组件；它们不能证明不可达，但不足以承诺大陆可用。因此只有在同一真实项目的大陆 5G、家庭宽带和外部 Wi-Fi 完成 E2EE 接通、双向音频、网络切换、30 秒重连、活动撤销和预加入撤销后，Cloud 才能成为 V1 的媒体候选。[LiveKit 区域固定](https://docs.livekit.io/deploy/admin/regions/region-pinning/) [LiveKit 状态页](https://status.livekit.io/) [LiveKit 连接可靠性](https://docs.livekit.io/intro/basics/connect/)

Build 免费档为 `$0/月`、无需信用卡，含 5,000 WebRTC participant-minutes 和 50 GB 下行；免费额度耗尽后新请求失败、不产生超额计费，并按日历月重置。两个端点同在房的一分钟约用掉两个 participant-minutes，故约 2,500 通话分钟只是上界，不能替代真实 E2EE 音频流量观测。[LiveKit 定价](https://livekit.com/pricing) [LiveKit 配额](https://docs.livekit.io/deploy/admin/quotas-and-limits/) [LiveKit 计费计量](https://docs.livekit.io/deploy/admin/billing/)

### 腾讯云 TRTC：大陆路径与当前房间结束可验证，但不能替代所有安全要求

TRTC 的 REST API 文档列有中国大陆接入域名，但也明确它们不代表实际产品/接口服务地域；产品资料覆盖 Android、Electron、Windows、macOS 等平台。因此它是大陆网络实测候选，而不是“官方保证任一媒体路径只在大陆或满足某个 SLA”的证据。[TRTC 请求结构](https://cloud.tencent.com/document/product/647/37080) [TRTC 产品概述](https://cloud.tencent.com/document/product/647/16788)

TRTC 的媒体流私有加密要求所有同房端点在入房前配置同一算法、密钥和盐；官方推荐由业务服务器生成并分发。它可使 TRTC 云端不拥有媒体解密密钥，但不能自动满足“控制面不可读密钥”的方案 B。该能力的官方支持列表不包括 Electron，并且需要旗舰版/旗舰版 Plus及业务审核；因此不能作为当前 Electron 桌面 V1 的无缝、低成本替换。[TRTC 媒体流私有加密](https://cloud.tencent.com/document/product/647/106173)

对已在房用户，TRTC 可用 `RemoveUser` 踢出指定用户，或 `DismissRoom` 移出所有用户并结束当前通话。对于已签发但尚未进房的 UserSig/PrivateMapKey，公开房间管理 API 和鉴权资料没有给出按单个票据立即撤销的承诺；有效期和不再签发只能缩小窗口。不得将其描述为与 LiveKit Cloud identity 级 token cutoff 等价。[TRTC 移出用户](https://cloud.tencent.com/document/product/647/40496) [TRTC 解散房间](https://cloud.tencent.com/document/product/647/110048) [TRTC 用户鉴权](https://cloud.tencent.com/document/product/647/17275) [TRTC 高级权限控制](https://cloud.tencent.com/document/product/647/32240)

普通 TRTC 纯语音按在房用户时长计费，官方价格为 ¥7/千分钟；其一次性免费时长包和任何体验资格均不应被本项目领取或消耗，除非 Owner 单独批准。旗舰版当前 ¥6,250/月，远高于当前“优先免费”的方向，且不包含在已确认的公网控制面 ¥50/月保护额度中，因此更不能自动采用。[TRTC 音视频时长计费](https://cloud.tencent.com/document/product/647/44248) [TRTC 包月套餐](https://cloud.tencent.com/document/product/647/85386/) [TRTC 免费试用](https://cloud.tencent.com/document/product/647/44360)

## 进入正式规格前的媒体闸门

无论最终候选是谁，都必须在不保存音频、转写、Token 或 E2EE 密钥的前提下证明：

1. 大陆 5G、家庭宽带和外部 Wi-Fi 下的双端 E2EE 接通、双向音频、网络切换和 30 秒重连；
2. Device Revocation 后当前两端均被强制结束，且控制面不会重新签发本次资料；
3. 已签发但未加入的本次资料在撤销后不能加入；若厂商没有公开即时撤销能力，不能用短 TTL 替代；
4. 真实签名 Android APK 与当前桌面技术栈都能启用 E2EE，错误密钥或初始化失败绝不降级；
5. 接近免费额度或批准的媒体预算时，新通话和新媒体资料都收到可理解的立即拒绝，而撤销和最小审计仍可执行。

这些闸门与 CloudBase 控制面的 72 日历小时观察独立；目前两者都未授权进入正式实现。
