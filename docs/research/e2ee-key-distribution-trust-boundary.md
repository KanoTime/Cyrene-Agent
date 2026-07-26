# E2EE 密钥分发信任边界（方案 A 已确认）

> 状态：Owner 已于 2026-07-23 接受方案 A；这是已确认的 V1 安全边界，仍不是正式接口、SDK 代码或密钥管理实现授权。每通 LiveKit E2EE 与禁止降级已经确认；本文厘清公网控制面短暂可读每通共享媒体密钥的范围。它不改变“控制面不保存音频、转写、角色记忆或模型内容”的既有边界。

## 已知事实

LiveKit 的 E2EE 让 LiveKit 服务器无法解密媒体和数据，但 LiveKit 不生成、保存或传输应用密钥；密钥分发由应用自行负责。官方把“服务端生成共享密钥，再随房间 Token 安全发给参与端”列为常见路线；若需要逐参与者密钥或通话内轮换，则需要自定义 key provider。[LiveKit：Encryption overview](https://docs.livekit.io/transport/encryption/)、[LiveKit：Get started with encryption](https://docs.livekit.io/transport/encryption/start/)

Cyrene 已确认每通独立、两端都启用 E2EE、密钥不持久化、禁止明文回退。Owner 现已确认：公网控制面在生成/分发过程中可以短暂看到原始共享密钥。这个选择不影响 LiveKit Cloud 是否能解密，却意味着 Cyrene 控制面是媒体密钥边界内的受信组件，不能声称控制面对密钥零知识。

## 已确认方案 A：控制面短暂可读

控制面在 `CONNECTING_MEDIA` 生成每通随机共享密钥，并经两份已认证 HTTPS Media Join Grant 直接发送给手机与桌面；明文只在当前执行内存和端点内存出现。为适配 CloudBase 无状态函数，两份 grant 可按 [ADR-0038](../adr/0038-store-only-short-lived-encrypted-media-grant-envelopes.md) 分别加密成最长 30 秒、端点专属、单次领取的 AES-256-GCM 信封；数据库不保存明文 Token 或密钥。

- **优点：** 直接复用 LiveKit React Native 的内置共享密钥路径；不需要 V1 新增设备 E2EE 公钥生命周期、密封信封、密钥替换或额外恢复路径；与“V1 暂缓 Device Credential 私钥绑定”最一致。
- **代价：** 只能准确宣称“媒体对 LiveKit Cloud 端到端加密”；控制面本身是短暂可读的受信组件，不能宣称“控制面也无法读取媒体密钥”。
- **仍然必须：** 双端连接前启用 E2EE、无降级、每通新密钥、立即撤销/清除、真实 APK 验收和最小审计。

## 方案 B：控制面不可读（更强的媒体密钥保密）

每台设备在配对时建立单独的 E2EE wrapping public key；私钥留在设备受保护存储。每通共享密钥必须由一个端点生成，并只以对方公钥可解封的密封资料经控制面中继，令控制面从未持有原始密钥。Android Keystore 可生成不可导出的私钥；macOS 端还需要明确选择相同级别的私钥存储与使用机制。[Android Keystore](https://developer.android.com/privacy-and-security/keystore)、[Electron `safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage)

- **优点：** 可准确宣称控制面与 LiveKit Cloud 都无法读取媒体密钥；控制面只转发密封资料。
- **代价：** 需要配对时认证公钥、防止替换/中间人、设备密钥轮换/撤销/重装处理、Owner Recovery 与 Authorization Rebootstrap 的全量失效语义，以及双端加密封装的实机验证。这是独立的设备私钥生命周期；它不必等同于 DPoP，却不能再把 V1 描述为“没有设备私钥管理”。
- **LiveKit 影响：** 双端解封后仍可继续使用 LiveKit 内置共享密钥 provider；只有需要逐参与者媒体密钥或通话内轮换时才需要自定义 key provider。

## 决定与延后边界

Owner 已接受方案 A：控制面在 `CONNECTING_MEDIA` 生成每通随机共享密钥，并经两份已认证 HTTPS Media Join Grant 直接发送给手机与桌面。Owner 随后接受 ADR-0038：无状态调用之间允许数据库暂存最长 30 秒的端点专属加密信封，但明文密钥与 Token 仍不写入数据库、审计、日志、URL 或二维码；资料领取窗口结束或电话终态时清除。

方案 B 的“控制面永远不可读”保证不属于 V1；它需要受配对保护的设备 E2EE 公钥生命周期、密封信封、密钥替换与灾难恢复验证，未来若引入必须重新经过独立设计与实机验收。方案 A 不改变 LiveKit E2EE、禁止降级、每通新密钥、即时撤销和“公网控制面不保存媒体内容”的既有承诺。
