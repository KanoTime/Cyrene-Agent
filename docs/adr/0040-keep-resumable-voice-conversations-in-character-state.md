# ADR-0040：把可续聊语音对话保存在角色状态根目录

- 状态：Accepted
- 日期：2026-07-27
- 决策者：Owner

语音通话的命名文本历史由桌面端作为权威数据，持久化在当前 Character ID 的 Character State Root 中；手机只在加密通话建立后读取分页目录元数据、选择、创建或重命名语音对话，不接收完整历史正文。这样同一 Voice Conversation 可以跨多次短时 Voice Call 续聊，同时不会把角色私有历史复制到 Public Control Plane、移动安全凭据存储或其他角色目录。选择完成前桌面端拒绝音频进入 ASR；切换 Active Character 后只能看到该角色自己的语音对话。拒绝把手机本地历史作为权威来源，因为卸载、设备更换和多手机会产生分叉；也拒绝复用桌面聊天窗口会话，因为语音轮次只有纯文本 user/assistant 对，生命周期和展示需求不同。
