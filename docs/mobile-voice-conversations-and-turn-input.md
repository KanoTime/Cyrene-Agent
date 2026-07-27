# 移动语音对话与轮次输入规格

## 目标

1. 安静环境继续使用自动聆听。
2. 嘈杂环境可切换到手动轮次，只有用户明确开始后音频才能进入 ASR。
3. 用户可以在加密媒体连接建立后选择已有 Voice Conversation，或用自定义名称创建新对话。
4. 同一 Voice Conversation 跨应用退出和多次 Voice Call 恢复，模型继续收到最近 24 轮上下文。
5. Voice Conversation 属于 Active Character，不进入 Public Control Plane，也不在手机保存权威副本或原始音频。

## 用户流程

1. 手机建立 E2EE LiveKit 通话。
2. 桌面通过应用层加密数据包发送当前角色的 Voice Conversation Catalog；在用户选择前，桌面丢弃所有上行 PCM。
3. 用户选择已有对话，或输入 1 至 80 个字符的名称创建新对话。
4. 桌面确认选择，在桌面模型上下文中恢复最近 24 轮，手机进入 `automatic` 输入模式。
5. 用户可在通话中切换：
   - `automatic`：语音开始门控确认后送入 ASR，静默结束本轮。
   - `manual`：点击“开始说话”打开门控，点击“提交本轮”立即结束；门控关闭时 PCM 被丢弃。
6. 每次模型生成有效回复后，桌面原子地追加 user/assistant Turn，刷新 Catalog 元数据。

## 数据模型

- `VoiceConversation`: `id`, `title`, `createdAt`, `updatedAt`, `turns`, `schemaVersion`
- `VoiceConversationTurn`: `id`, `userText`, `assistantText`, `at`
- `VoiceConversationMeta`: 上述轻量元数据加 `turnCount` 与不超过 120 字的 `preview`

标题去除首尾空白并限制为 80 字。Catalog 按 `updatedAt` 倒序排列。单次模型请求只加载最近 24 轮，但磁盘历史不因此截断。

## 加密数据协议

媒体帧 E2EE 不覆盖当前锁定 SDK 的 user data packet。两个方向的数据包必须先使用每通 E2EE key 经 HKDF-SHA-256 派生独立方向密钥，再以 XChaCha20-Poly1305 和每包新的 24 字节 nonce 加密。解密、认证、版本或方向校验失败时静默拒绝，不回退明文。

手机到桌面使用可靠数据包 topic `cyrene.call.control`：

- `conversation.list`（可携带上一页游标）
- `conversation.create`
- `conversation.select`
- `conversation.rename`
- `turn.mode`
- `turn.begin`
- `turn.commit`

桌面到手机继续使用 `cyrene.call.event`：

- `conversation.catalog`
- `conversation.selected`
- `conversation.updated`
- `turn.mode`
- 既有 `state`, `transcript`, `error`, `bridge`

Catalog 每页最多 12 条，只发送 `VoiceConversationMeta`，完整 Turn 正文留在桌面。单个加密可靠包不得超过 LiveKit 建议的 15 KiB。桌面只接受当前配对 Mobile Identity 的控制包。未知类型、无效 ID、空标题、越界标题和不符合当前状态的轮次命令必须 fail closed。

## 自动音频门控

自动模式以 20ms、16kHz 单声道 PCM 工作：

- 维护 200ms 环形预录缓存；
- 连续至少 200ms 高于启动阈值才确认语音；
- 确认后先补入预录缓存，再发送后续 PCM；
- 未确认的短促噪声不进入 ASR；
- 已确认语音结束后沿用设置中的静默时长提交本轮。

该门控只过滤非人声或短促噪声，不承诺区分用户与旁人；嘈杂且有人声干扰时使用手动轮次。

## 验收

- 重启手机应用并重新呼叫后，Catalog 仍列出桌面保存的命名对话。
- 选择旧对话后，下一轮模型请求包含其最近历史。
- 不同 Character ID 的 Catalog 相互不可见。
- 未选择对话时以及手动门控关闭时，PCM 不进入 ASR。
- 手动开始后的首字不丢失，提交后不等待自动静默。
- 自动模式过滤小于 200ms 的瞬时高音量帧，正常语句仍可完成。
- 不持久化音频、LiveKit Token、E2EE Key 或手机端权威历史。
- 数据包篡改、反射、明文降级和超出 15 KiB 时均被拒绝。
