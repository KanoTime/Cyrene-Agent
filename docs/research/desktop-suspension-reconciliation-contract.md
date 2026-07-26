# 桌面挂起与唤醒复核契约

> 状态：厂商无关的运行时契约，不是 `powerMonitor`、LiveKit 或 CloudBase 的实现授权。领域含义以 [CONTEXT.md](../../CONTEXT.md)、[ADR-0031](../adr/0031-supervise-the-desktop-and-locally-managed-runtimes-after-login.md) 与 [ADR-0035](../adr/0035-use-one-immediate-idempotent-call-state-machine-across-clients.md) 为准。

## 目的

普通合盖、系统睡眠与用户主动睡眠是预期的 Desktop Suspension，而不是故障或全天候在线承诺。这个契约把三种彼此独立的东西分开：桌面能否接受**新**电话的 Call Availability、控制面实时订阅的运输生命周期、以及一通已经存在的 LiveKit Media Session。三者不能因一次 `resume` 被混为“自动恢复一切”。

Electron 的 `powerMonitor` 在主进程提供 `suspend` 与 `resume` 事件，因此可以做幂等的本地边界处理；它不能也不应阻止普通系统挂起。[Electron `powerMonitor`](https://www.electronjs.org/docs/latest/api/power-monitor) LiveKit 也会尝试在网络变化后自动重连，但这只是一通已存在媒体会话的 SDK 行为，不是新 Call Request 或新的授权来源。[LiveKit：网络变化与重连](https://docs.livekit.io/intro/basics/connect/)

## 挂起与唤醒的并行边界

| 关注对象 | `suspend` 时 | `resume` 后 | 不允许发生的事 |
| --- | --- | --- | --- |
| Call Availability | 尽力撤回；无论上报是否送达，其短期有效期都必须自然失效。 | 在新订阅、权威读取和本机 ASR/模型/TTS 就绪均成功前保持 `DESKTOP_UNAVAILABLE`。 | 用睡眠前“可用”快照接听、排队错过的来电或自动改呼。 |
| 控制面运输订阅 | 标记为过期；不把暂停后的连接当作可继续信任。 | 显式关闭并丢弃旧订阅与运输层登录，再重新获取应用授权、建立新订阅、等待初始快照并做权威 HTTPS 读取。 | 依赖 SDK 自动 `watch()` 重建、把运输层身份当作 Cyrene 授权或依据旧事件改变业务状态。 |
| 已存在 Voice Call | 不创建新媒体资料、不主动签发新 Token/密钥；如果媒体中断，既有状态机可进入 `RECONNECTING`。 | 只可观察同一 Media Session 在原 30 秒权威重连窗口内、使用原端点内存中的 Token/key provider 自行恢复；否则按既有终态清理。 | 新建房间/identity/Media Join Grant、重置 30 秒时限、补拨或复活已 `ENDED` 的电话。 |

## 关键时序规则

1. `suspend` 处理必须可重复：撤回可用性是 best effort，随后立即把本机的可用性结论标为过期。它不能等待网络、强制唤醒机器或延迟合盖。
2. Voice Call 的 10 秒确认、30 秒媒体建立与 30 秒重连都由权威控制面时钟计量。桌面 CPU 暂停时，本机定时器不运行并不暂停这些期限；唤醒后的权威读取必须接受已经发生的终态。
3. 唤醒先进入 Wake Reconciliation，绝不先报告可接听。新订阅、其初始快照、权威 HTTPS 读取和本机运行时就绪检查都通过后，才可重新发布短期 Call Availability。
4. 如果睡眠前的 Voice Call 在权威状态中仍是非终态 `RECONNECTING`，且同一端点内存中的 Room/key provider 在原 30 秒窗口内报告已恢复，正常状态机可以把它转回 `ACTIVE`。这不是唤醒“复活”电话：没有新房间、身份、grant、Token、密钥或计时窗口。
5. 如果权威状态已是 `ENDED`、已撤销、超过重连期限，或端点已经丢失 Room/key provider 内存，唤醒必须清除本地媒体资料并保持终态。下一通电话只能是新的 Call Request。
6. 睡眠期间发起的新电话没有队列。因为可用性已撤回或其 lease 过期，移动端收到 `DESKTOP_UNAVAILABLE`；唤醒后的桌面不读取或执行一个“错过的待办”。

## 正式实现后的验收

- 合盖且无活动电话：控制面的可用性 lease 过期后，移动端立即拒绝新呼叫；唤醒后只有完成新订阅、权威读取和本机就绪检查才可再次呼叫。
- 活动电话短暂网络中断/快速睡眠恢复：只要同一 Room、同一端点内存 E2EE 状态和原 30 秒窗口都成立，通话可按 `RECONNECTING → ACTIVE` 恢复；验证没有新 Media Join Grant、Token、密钥或房间。
- 超过 30 秒、设备撤销、授权重建或端点内存丢失：电话进入稳定 `ENDED`，唤醒不发起补拨、重建或自动接听。
- 在挂起期间制造 `watch()` 错误、假旧事件或传输层重建：只有随后权威 HTTPS 读取可影响 Call Availability；任何运输事件都不能单独创建、确认、取消或结束 Voice Call。
- 在真实合盖/唤醒循环中审计：不记录媒体、Token、E2EE 密钥、桌面路径、模型内容或原始运输错误。
