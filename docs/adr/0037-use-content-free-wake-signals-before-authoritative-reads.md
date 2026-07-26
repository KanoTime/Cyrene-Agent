# 实时通道只传递无业务内容唤醒信号

CloudBase 已建立的数据库 `watch()` 在运输层用户被撤销后仍可在 token 过期前收到文档变化，因此 Cyrene 决定让该实时通道只传递 Opaque Wake Signal：每次变化仅替换无语义的随机值；除数据库文档 ID 和订阅者原本已知的固定目标路由标识外，不放入计数器、时间戳、呼叫者或其他参与者身份、呼叫与角色状态、任何凭据或秘密。桌面实例收到信号后，必须再用 Cyrene Device Credential 调用短时 HTTPS 端点并取回权威状态；唤醒信号本身不能触发接听、媒体连接或其他状态转移。

## Consequences

撤销后的旧 `watch()` 最多可能在 CloudBase 运输层 token 剩余生命期内观察到“有一次唤醒发生”的时序元数据，但无法知道变化内容或据此行动；Owner 已接受这项有限残留。Device Credential 的撤销仍必须立即使所有权威 HTTPS 读写失败，并立即结束该设备的活动通话；CloudBase 登录态不得成为第二个授权源。如果无法保证唤醒文档除固定路由标识和无语义随机值外不含任何业务内容，或已撤销 Device Credential 仍能获得权威状态，则该方案淘汰并转向独立通知服务原型。

## Prototype Evidence

2026-07-22 的抛弃式原型验证了这个边界：普通桌面身份直接读权威集合被 `DATABASE_PERMISSION_DENIED`；有效测试设备凭据能读权威呼叫内容，凭据撤销后立即只返回 `DEVICE_REVOKED` 并将活动呼叫结束。CloudBase 用户被禁用后，旧 `watch()` 在两次后续变化中仍收到唤醒，但所有快照均仅含 `_id`、`desktopUid`、`wakeNonce`，字段白名单无违反。该结果通过安全分层闸门，但不替代待完成的 72 小时计量/稳定性观测和正式 HTTPS/Credential Family/LiveKit 集成验证。
