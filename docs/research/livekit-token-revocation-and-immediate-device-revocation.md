# LiveKit Token 撤销与设备即时撤销边界

> 调研日期：2026-07-22
>
> 范围：只核验 LiveKit 官方文档、官方 API Reference 与官方协议源码；不改变产品实现或 CloudBase 配置。
> 问题：Device Revocation 后，如何让活动媒体参与者退出，并阻止本次已签发但尚未使用的媒体加入凭据继续加入。

## 结论

**对活动参与者和“已离开后缓存 token”的情况，可以满足，但前提是正式媒体服务使用 LiveKit Cloud，并把 `RoomService.RemoveParticipant` 作为撤销流程中必须得到确认的服务器端步骤。** 官方说明该 API 会强制断开当前参与者；在 LiveKit Cloud 上还会立即撤销其当前 access token。即使参与者已经离开，仍可用同一 `(room, identity)` 调用它来撤销旧 token，阻止其用缓存 token 重入。[参与者管理：Remove participant](https://docs.livekit.io/intro/basics/rooms-participants-tracks/participants/#remove-participant) [RoomService API](https://docs.livekit.io/reference/other/roomservice-api/#removeparticipant)

对于“JWT 已签发、identity 从未成功加入过”的精确情形，官方文档以“已经离开”的参与者举例，并未单列“从未加入”。由于同一 API 在 participant 不存在时仍声明会执行 token 撤销，它是合理的实现候选；但 Cyrene 在真实 LiveKit Cloud 项目完成“签发但不连接 → `RemoveParticipant` → 原 JWT 加入失败”的验收前，**不得把这一项写成已由供应商无条件保证的事实**。

这不是一个“按某一个 JWT 字符串或 `jti` 精确撤销”的功能。LiveKit Cloud 的公开撤销模型是按 **房间、参与者 identity 和 `nbf` 时间截止点** 拒绝旧 token；同一 identity/房间下、`nbf` 早于截止点的 token 都会受影响。官方协议中 `RemoveParticipant` 的请求正是 `room`、`identity`、`revoke_token_ts` 三个相关字段，而 `DeleteRoom` 请求只有 `room` 字段。[Tokens & grants：Token revocation](https://docs.livekit.io/frontends/reference/tokens-grants/#token-revocation) [官方协议 `livekit_room.proto`](https://github.com/livekit/protocol/blob/main/protobufs/livekit_room.proto#L138-L162)

**自托管 LiveKit 不满足“缓存的、尚未使用 JWT 立即失效”这个要求。** 官方明确说明：自托管部署中，移除参与者或更新权限不会让现有 token 失效；只能用短 TTL 降低窗口，不能把它写成即时撤销。[Tokens & grants：self-hosted deployments](https://docs.livekit.io/frontends/reference/tokens-grants/#token-revocation)

## 官方事实

### 1. `exp` 只限制初次加入，不能终止已建立的通话

- LiveKit access token 是带身份、房间、权限及 `exp`、`nbf` 的 JWT；服务器会拒绝使用已过期 token 的连接请求。`roomJoin` 和 `room` 是加入指定房间所需的 grant。[Tokens & grants：Overview、Access token structure 与 Video grant](https://docs.livekit.io/frontends/reference/tokens-grants/)
- 但官方明确规定，`exp` **只影响初始连接，不影响后续重连**。服务器还会主动向已连接客户端发放刷新 token；刷新 token 的有效期为 10 分钟或原 token 剩余有效期中较长者。[Tokens & grants：Token lifecycle](https://docs.livekit.io/frontends/reference/tokens-grants/#token-lifecycle)

**项目推断：** ADR-0030 的“初始加入有效期 5 分钟”是正确的最小暴露面，但它不是撤销开关：它既不能强制踢出已连接者，也不能单独保证断线后的参与者无法在当前会话语义下恢复。因此 Device Revocation 不能只等待 JWT 自然过期。

### 2. `RemoveParticipant` 的作用与 Cloud 专属撤销

- `RemoveParticipant(room, identity, revoke_token_ts)` 需要 `roomAdmin` 权限。它强制断开该 identity；LiveKit Cloud 上还会撤销当前 token，使其不能立即带同一 token 重连，重新加入需要新 token。[参与者管理：Remove participant](https://docs.livekit.io/intro/basics/rooms-participants-tracks/participants/#remove-participant)
- 在 Cloud 上，调用对象即使已经离开也仍可撤销其 token；文档说明此时 API 可能返回“participant does not exist”，但撤销仍发生。传入 `revoke_token_ts` 可设置明确的撤销截止点并避免把“已经离开”误判为未撤销。[参与者管理：Revoking a participant's token after they leave](https://docs.livekit.io/intro/basics/rooms-participants-tracks/participants/#remove-participant)
- Cloud 撤销按 token 的 `nbf` 工作：服务端记录截止点，之后任一 `nbf` 早于它的 token 在重新连接时会被拒绝。`revoke_token_ts` 必须在服务端当前时间的 60 秒内；未给出或为 `0` 时，服务端使用带 1 分钟缓冲的当前时间。官方协议源码也注明该字段“只由 RemoveParticipant 使用”。[Tokens & grants：Token revocation](https://docs.livekit.io/frontends/reference/tokens-grants/#token-revocation) [RoomService API：RemoveParticipant](https://docs.livekit.io/reference/other/roomservice-api/#removeparticipant) [官方协议 `livekit_room.proto`](https://github.com/livekit/protocol/blob/main/protobufs/livekit_room.proto#L155-L162)
- 上述 token 撤销仅是 **LiveKit Cloud** 功能；自托管删除参与者不会使旧 token 失效。[Tokens & grants：self-hosted deployments](https://docs.livekit.io/frontends/reference/tokens-grants/#token-revocation)

**项目推断：** 对“已经签发但尚未加入”的媒体 token，不应等待客户端出现再处理。控制面必须知道本次 Media Session 的 `(room, identity)`，并在撤销时对该 identity 调用 `RemoveParticipant`；其“participant 不存在仍撤销”的官方行为使它成为可测试的 pre-join 撤销路径，但不能在 Cloud 实测前把“从未加入”与“已离开”混为已证明事实。

### 3. `DeleteRoom` 只能断开现有人，不是 token 撤销替代品

- `DeleteRoom(room)` 会强制断开该房间内的全部参与者；官方 RoomService 文档没有把 token 撤销列为这个 API 的效果。[RoomService API：DeleteRoom](https://docs.livekit.io/reference/other/roomservice-api/#deleteroom) [Room management：Delete a room](https://docs.livekit.io/intro/basics/rooms-participants-tracks/rooms/#delete-a-room)
- LiveKit 房间可以由第一个参与者自动创建。因而删除房间本身不能被用来证明“仍有效的、指定了同名房间的 join token 必定不能再建立新房间”。[Room management：Overview](https://docs.livekit.io/intro/basics/rooms-participants-tracks/rooms/#overview)
- 官方协议的请求形状也反映了职责差异：`DeleteRoomRequest` 只有 `room`；能携带 `revoke_token_ts` 的是 `RoomParticipantIdentity`，且注释限定它用于 `RemoveParticipant`。[官方协议 `livekit_room.proto`](https://github.com/livekit/protocol/blob/main/protobufs/livekit_room.proto#L138-L162)

**项目推断：** 如果撤销设备必须结束整通电话，`DeleteRoom` 可作为“立即踢出对端、收束房间”的辅助操作；但必须先或并行对本次呼叫的每个已签发 participant identity 做 `RemoveParticipant`。只调用 `DeleteRoom` 不能作为“未使用 token 已失效”的验收证据。

### 4. 没有公开的单 JWT 精确撤销接口

官方文档所公开的即时撤销入口是 `RemoveParticipant(room, identity, revoke_token_ts)`，效果是依 `nbf` 截止点拒绝旧 token；官方协议也没有 token 字符串、JWT ID 或 `jti` 参数。[RoomService API：RemoveParticipant](https://docs.livekit.io/reference/other/roomservice-api/#removeparticipant) [官方协议 `livekit_room.proto`](https://github.com/livekit/protocol/blob/main/protobufs/livekit_room.proto#L155-L162)

**项目结论：** 在核验的官方公开资料中，没有“只撤销某一枚已签发 JWT、但保留同一 `(room, identity)` 下另一枚更早 `nbf` JWT 继续可用”的接口。设计必须把撤销单位视为该次呼叫的 identity/时间窗口，而不是声称可以精确吊销一串 JWT 文本。

### 5. 未使用 token 的证据等级

| 情形 | 当前证据 | 能否现在写成供应商保证 |
| --- | --- | --- |
| 已连接 participant 被移除 | 官方明确：强制断开；Cloud 同时立即撤销当前 token。 | 可以。 |
| participant 已离开后带旧 token 重连 | 官方明确：可用 `RemoveParticipant` 撤销，即使 API 报 participant 不存在，撤销仍发生。 | 可以。 |
| token 已签发、identity 从未加入 | 官方接口在 participant 不存在时仍执行撤销，且其模型是 identity + `nbf` cutoff；但官方文字只举“已离开”示例。 | 尚不可以；必须跑下文的预加入验收。 |
| 自托管实例中的任意旧 token | 官方明确说不会因移除 participant 而失效。 | 不可以。 |

## Cyrene 的可验证控制面边界（项目推断）

以下是从官方能力推导的设计要求，不是 LiveKit 自动替 Cyrene 完成的业务规则。

1. **一通一房间、每端一 identity。** 每个 `LiveKit Media Session` 使用随机且永不复用的房间名；手机和桌面各有一个本次呼叫专属 identity。控制面只保留 `Call ID → room + 两个 identity + token 签发时刻/截止点` 的最小映射，不保存原始 JWT 或 E2EE 密钥。这样 `RemoveParticipant` 的 Cloud 截止点只影响本次调用，而不是未来通话。
2. **先封住签发，再要求媒体服务执行。** Device Revocation 的权威事务先废止 Credential Family、将相关 Voice Call 标记为安全终止且禁止再签发/重取本次媒体 token；随后由可信控制面调用 LiveKit。控制面数据库更新只能阻止“以后再发 token”，不能让 LiveKit 已收到的 bearer JWT 自行失效。
3. **对两个 identity 都发出撤销。** 为满足“撤销后本次通话立即结束、未使用的本次媒体凭据不能加入”，控制面应对手机和桌面两个 call-scoped identity 都调用 `RemoveParticipant`，即使其中一端尚未加入。终止的呼叫不再为任一端生成新 token；必要时再 `DeleteRoom` 收束残留房间。仅撤销被取消授权的那一端，会留下对端已签发 token 的加入窗口。
4. **以 LiveKit Cloud 的成功确认作为媒体撤销证据。** Cloud API 成功返回后，官方才承诺强制断开与旧 token 截止；网络超时、认证错误或 API 失败不能被当作“媒体已立即结束”。这种情形应保持 fail-closed：不再签发 token、记录最小审计、以短时 Media Revocation Work Item 重试受限的服务器端撤销，并在确认前不释放 Owner 的媒体安全槽；Voice Call 仍是不可恢复终态，但不能把它称为已完成的正常媒体结束。
5. **把截止点设计为终止用途而非重新授权用途。** 官方默认的 1 分钟缓冲会影响 `nbf` 早于截止点的 token。由于 Cyrene 的房间和 identity 每通都不复用，终止时使用该机制不会阻碍未来新通话；如果改用精确 `revoke_token_ts`，必须在实现和测试中处理秒级 `nbf` 边界，不能假定“同一秒签发”自然被覆盖。

## 不能声称的安全性质

| 说法 | 为什么不能这样写 |
| --- | --- |
| “5 分钟 LiveKit JWT 到期就会立刻挂断。” | `exp` 只影响初始连接；已连接客户端会收到刷新 token，官方不把 `exp` 描述为会话强制终止机制。 |
| “只把 Cyrene 设备标为 revoked，就已经让媒体断开。” | Cyrene 控制面不了解或不能改变 LiveKit 已接收的 JWT；仍须成功调用 LiveKit 的服务器 API。 |
| “`DeleteRoom` 会同时使所有未使用 JWT 失效。” | 官方只承诺它断开当前房间参与者；未提供 token cutoff，也说明房间可在首个参与者加入时自动创建。 |
| “自托管 LiveKit 的 `RemoveParticipant` 也会阻止旧 token 重连。” | 官方明确否定：自托管移除参与者不使现有 token 失效，只能用短 TTL 降低风险窗口。 |
| “LiveKit 可以按单个 JWT/`jti` 做即时精确撤销。” | 公开接口的粒度是 `(room, identity, nbf cutoff)`，不是 JWT 字符串或 `jti`。 |
| “请求已发出或本地状态已改为 `ENDED`，就证明远端媒体已停止。” | 只有 LiveKit Cloud API 的成功结果及随后真实连接/重连验证，才能证明这次媒体撤销已执行。 |

## 正式集成前的验收场景

这些是未来正式实现的验收条件；本研究未执行任何 CloudBase 或 LiveKit 操作。

1. **活动撤销：** 手机和桌面已加入同一 E2EE 房间；撤销其中一个 Device Credential 后，控制面成功完成两个 call-scoped identity 的 `RemoveParticipant`，两端均离开，Voice Call 的终止原因是 `DEVICE_REVOKED`。随后用撤销前缓存的两个 token 分别尝试加入，均不得形成参与者。
2. **预加入撤销：** 已签发两端 token 但两端均未连接；撤销后仍按两个 identity 调用 `RemoveParticipant`，再用原 token 尝试连接，均被 LiveKit Cloud 拒绝。此场景专门证明“未使用凭据”而不是只证明踢出已连接者。
3. **删除房间对照：** 仅调用 `DeleteRoom` 的测试不得通过“未使用 token 已失效”验收；只有再完成身份级 `RemoveParticipant` 的 Cloud token 截止测试才通过。
4. **失败闭环：** 注入 RoomService 网络或鉴权失败，确认控制面不再重发媒体 token、不把调用失败记录成已强制断开，并保留可重试且不暴露 JWT/E2EE key 的最小审计。
5. **部署边界：** 同一套测试必须在实际选择的 LiveKit Cloud 项目上运行；若改为 self-hosted，第二项必须被视为不满足，而不是用 TTL 测试替代。

## 官方来源

- [LiveKit Tokens & grants](https://docs.livekit.io/frontends/reference/tokens-grants/)
- [LiveKit Participant management](https://docs.livekit.io/intro/basics/rooms-participants-tracks/participants/)
- [LiveKit RoomService API reference](https://docs.livekit.io/reference/other/roomservice-api/)
- [LiveKit Room management](https://docs.livekit.io/intro/basics/rooms-participants-tracks/rooms/)
- [LiveKit 官方 protocol 源码：`livekit_room.proto`](https://github.com/livekit/protocol/blob/main/protobufs/livekit_room.proto)
