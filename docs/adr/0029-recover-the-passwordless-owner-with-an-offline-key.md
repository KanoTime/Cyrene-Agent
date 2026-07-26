# 使用离线恢复密钥恢复无密码 Owner

Cyrene V1 的 Owner 不建立邮箱、用户名或账号密码，而由首台桌面实例初始化，并在初始化时生成一份只展示一次的高熵 Owner Recovery Key；用户必须通过重新输入随机指定片段确认已经在 Cyrene 之外保存该密钥，Cyrene 和公网控制面都不保留可再次显示的明文，只保存验证信息。未确认不会阻止当前桌面本地使用，但不允许新增第二台桌面。Owner Recovery 仅在没有任何可用的已授权桌面时使用，不能替代日常新增桌面的 Pairing Challenge；唯一桌面丢失、损坏或重装后，新桌面可以用该密钥恢复同一 Owner，但恢复时必须撤销所有旧桌面实例并终止它们参与的通话，移动设备默认保留并由新桌面重新审查。恢复成功后旧密钥立即失效，新桌面只展示一次替代密钥；已授权桌面也可在怀疑泄露时主动轮换恢复密钥。恢复密钥不能发起通话或换取 LiveKit Token。若公网控制面的验证数据本身不可恢复丢失，则 Owner Recovery Key 也不能被验证，必须走 ADR-0034 的 Authorization Rebootstrap；未来可由 passkey 或成熟 OAuth 恢复机制取代。

## 实现约束（2026-07-23）

- 桌面可用性使用 45 秒短租约；只有持有当前桌面 Device Credential 的实例可以续租或主动清除。任一有效租约存在时，恢复请求必须以 `OWNER_RECOVERY_DESKTOP_AVAILABLE` 拒绝。
- 恢复事务一次性撤销所有旧桌面、使所有未终态 Pairing Challenge 失效，并保留已授权手机但标记为 `requiresReviewAfterRecovery`。旧桌面 Device Credential 立即失效；通话协调器和媒体撤销路径接入后，还必须同步终止旧桌面参与的通话。
- 恢复调用携带不持久化明文的 Recovery Receipt。同一个旧恢复密钥和同一个回执重试必须得到同一个新桌面凭据与替代恢复密钥，避免成功响应丢失后把 Owner 锁死；使用不同回执重放旧密钥必须失败。
- 新 Device Credential 由主进程直接写入 macOS 钥匙串。替代 Owner Recovery Key 只进入一次性确认界面；确认前禁止新增桌面，确认后清除用于幂等重试的最小恢复记录。
- 当前领域 Module、持久事务 Adapter、HTTPS 入口、桌面客户端、恢复界面和桌面可用性协调器已经通过本地测试。协调器清醒时每 30 秒续租、挂起时清除、唤醒后显式恢复，且不把该租约误当成 ASR 或媒体就绪；恢复/撤销时的通话即时终止仍属于 Remote Call Coordinator 的后续职责，因此这里不是公网生产可用性声明。
