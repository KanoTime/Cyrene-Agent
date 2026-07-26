# 应用级完整角色包切换：最终规格审计

## 审计信息

- 审计日期：2026-07-16
- 主规格：[GitHub Issue #1：应用级完整角色包切换](https://github.com/Liyang0701/Cyrene-Agent/issues/1)
- 代码基线：`117cf34`
- 验收平台：Apple Silicon macOS
- 实施任务：#2～#15 均已关闭
- 剩余问题：[GitHub Issue #31：优化星野音色并完善角色 TTS preset 恢复](https://github.com/Liyang0701/Cyrene-Agent/issues/31)

## 结论

角色包、统一 Active Character、角色状态隔离、切换事务、受控重启、启动恢复、生命周期管理、桌面/通话/微信链路和安全边界均已实现，并通过自动化测试与真实 macOS 双角色验收。

主规格暂不关闭。唯一仍影响最终产品验收的问题是 #31：

1. 当前角色的 `Voice Profile` 已能正确路由到桌面通话、TTS 和微信语音回复，不会偷偷继承另一个角色的 `Voice Profile`。
2. 星野现有参考音频和标注文本的角色相似度未获用户认可，现标记为待修改。
3. GPT-SoVITS 的模型权重与运行时属于全局 TTS Service；当不同角色需要不同权重组合时，当前切换事务还没有完整保存、加载并回滚对应的全局 TTS preset。该缺口可能造成“配置属于星野，但全局服务仍加载其他角色权重”的混合音色。

因此，除 #31 外，主规格的代码实现与非音色验收可以视为完成。只有在 #31 完成，或产品明确接受其作为 v1 后续项时，才建议关闭 #1。

## 规格映射与证据

### 1. 角色包、注册表与设置页（用户故事 1～10）

已支持：

- 在设置页显示当前角色与全部已安装角色。
- 显示角色名、版本、来源、分发状态、可用能力和缺失能力。
- 从本地目录导入数据型角色包。
- 在安装前校验 manifest、核心资源、声明能力、路径、文件类型、数量和大小。
- 拒绝绝对路径、路径穿越、符号链接、可执行文件、未知文件和无效 Live2D 引用。
- 将 `local-only` 分发状态和来源信息显示给用户。
- 保护内置昔涟的 Character ID 与只读资源，禁止导入包覆盖。

主要证据：

- `src/main/character/character-runtime.ts`
- `src/main/character/character-runtime.test.ts`
- `src/main/character/character-resource.test.ts`
- `src/main/character/character-ipc.test.ts`
- `src/renderer/settings/character-settings-view.test.ts`
- `src/renderer/settings/character-settings-markup.test.ts`

### 2. 切换事务、受控重启与故障恢复（用户故事 11～21）

已支持：

- 回复、通话、ASR、TTS、主动消息或状态写入期间阻止切换，并返回具体阻塞活动。
- 切换前返回目标角色、健康状态和缺失能力。
- 切换前等待角色状态落盘。
- 通过 Electron 受控重启完成切换。
- 桌宠、聊天、通话、主动消息和微信共用一个 Active Character。
- 正常重启恢复上次选中的角色。
- 切换失败回滚上一角色。
- 目标包丢失或损坏时回退内置昔涟，同时保留损坏包诊断与私有状态。
- 内置包也不可用时进入诊断安全模式，不加载残缺或透明角色。

主要证据：

- `src/main/character/character-bound-activity.test.ts`
- `src/main/character/character-switch-transaction.test.ts`
- `src/main/character/character-electron-switch.test.ts`
- `src/main/character/character-startup-recovery.test.ts`
- `src/main/character/character-safe-mode.test.ts`
- `src/main/electron-window-lifecycle.test.ts`

### 3. 文本人格、品牌、视觉、动作与语音路由（用户故事 22～35）

已支持：

- 回复使用当前角色的身份、人格、风格、示例、场景内容和世界书。
- 全局 Application Policy、工具权限和产品品牌不受角色包覆盖。
- 角色界面名称、头像、通话身份和消息身份使用 Character Display Name；技术日志、存储和基础设施继续使用 Cyrene Agent 品牌。
- 加载当前角色的 Live2D；无 Live2D 时使用静态头像。
- 提示词和工具只调用稳定 Semantic Actions，由角色包映射到模型动作；未支持动作变成 neutral/no-op。
- 桌面通话和微信语音使用同一 Active Character 的有限 ASR hints。
- ASR 引擎、模型和 Worker 继续作为全局能力，不随角色切换重装。
- 当前角色的 `Voice Profile` 会传入 TTS 链路；缺少能力时明确不可用，不继承上一角色的配置。

主要证据：

- `src/main/character/character-text-context.test.ts`
- `src/main/character/character-visual.test.ts`
- `src/main/character/character-speech.test.ts`
- `src/renderer/ui/active-character.test.ts`
- `src/main/channels/adapters/wechat/wechat-voice-asr.test.ts`
- `src/main/character/character-architecture-guard.test.ts`

限制：

- 星野实际音色相似度与全局 GPT-SoVITS preset 切换仍由 #31 跟踪。技术路由已完成，但真实声音质量尚未通过最终验收。

### 4. 私有状态、全局用户数据与主动消息（用户故事 36～50）

已支持：

- 按 Character ID 物理隔离聊天、记忆与向量索引、关系、世界书状态、主动状态和 TTS 缓存。
- 自动化测试已验证：告诉昔涟的秘密“蓝色月桂”在流明角色下不可用，切回昔涟后仍可恢复。
- 显式用户资料、全局文档、待办、日程和提醒跨角色共享。
- 会话推断出的资料默认保留在角色私有状态。
- 全局文档作为任务证据使用，不自动写入角色世界观或关系记忆。
- 全局定时任务在执行时使用当前 Active Character 的系统提示词；调度执行器只记录全局任务历史，不写入角色关系记忆。
- 非当前角色的开场白和随意主动消息暂停；切换期间产生的旧角色结果会被丢弃，不会稍后补发。
- 旧版无作用域数据只迁移到昔涟一次，迁移带版本标记并可安全重复启动。
- embedding 和 reranker 运行时保持全局共享，角色仅隔离索引与状态数据。

主要证据：

- `src/main/character/character-state-integration.test.ts`
- `src/main/character/character-state.test.ts`
- `src/main/character/global-user-data.test.ts`
- `src/main/proactive/proactive-service.test.ts`
- `src/main/proactive-delivery-shared.test.ts`
- `src/main/scheduler/scheduler-runner.ts`
- `src/main/index.ts`

### 5. 升级、卸载、安全、架构与诊断（用户故事 51～64）

已支持：

- 同 Character ID 的高版本包按升级处理并保留私有状态。
- 同版本不同 digest 要求明确确认；低版本默认拒绝。
- 升级通过暂存、备份和原子替换执行，失败保留旧包。
- 角色包不能携带或执行状态迁移脚本。
- 卸载角色资源默认归档私有状态；重装同 Character ID 恢复归档状态。
- 永久删除与卸载分离，并要求明确确认。
- 内置角色和当前 Active Character 禁止卸载。
- 仓库不跟踪星野权重、参考音频、受限 Live2D 资源或其他本地专有素材。
- 角色调用方通过 CharacterRuntime 和不可变 Active Character Context 解析资源与状态，架构护栏阻止重新引入散落路径。
- import、migration、switch、relaunch、rollback、capability 和 startup 错误均提供结构化诊断。

主要证据：

- `src/main/character/character-package-lifecycle.test.ts`
- `src/main/character/character-runtime.test.ts`
- `src/main/character/character-architecture-guard.test.ts`
- `src/main/character/character-startup-recovery.test.ts`
- `src/main/character/character-safe-mode.test.ts`
- `docs/adr/`

## 自动化回归证据

在合入角色切换及表情包能力修复后执行：

- 完整测试：146 个测试文件、968 个测试通过。
- 构建：通过。
- Active Character、主动消息、切换和 Electron 生命周期定向回归：5 个测试文件、46 个测试通过。
- 星野未声明 stickers 时，桌面聊天和微信消息均不会调用昔涟表情包匹配器，也不会返回表情资源。
- 仓库扫描未发现受限制的星野权重、参考音频、Live2D 模型或本地 TTS 文件进入 Git。

## 真实 macOS 验收证据

本地角色包：

- 内置昔涟。
- Git 外 `local-only` 星野角色包。
- 测试夹具“流明”用于导入、切换和无可选能力行为验证。

已由用户真实操作确认：

- 从设置页导入角色包。
- 切换角色并自动重启。
- 重启后保持当前角色。
- 桌宠与 Live2D 正常。
- 桌面文字聊天正常。
- 桌面语音通话完成 `LISTENING → ASR → THINKING → SPEAKING → LISTENING`。
- 微信文字消息正常。
- 微信入站语音经本地 ASR 正常识别。
- 微信语音回复以语音卡片正常返回。
- 星野未声明 stickers 时，桌面和微信均不再出现昔涟表情包。

真实状态根检查：

- 昔涟和星野分别拥有聊天、记忆/RAG、关系、世界书、主动状态和 TTS 缓存目录。
- 所有真实路径均包含在各自 Character State Root 内。
- 两个角色之间没有共享 inode，也没有重复逻辑状态 ID。
- 使用真实 `userData` 执行星野 → 昔涟 → 星野往返后，两边完整目录树哈希保持一致。
- 应用退出后没有遗留本地 ASR Worker 孤儿进程。

待验收：

- 星野音色相似度未通过，见 #31。

## 与原测试决策的两处形式差异

### 1. 仓库内固定测试夹具数量

规格测试决策写的是两个可再分发夹具。当前仓库固定提交一个完整的“流明”夹具，其他能力组合由测试在临时真实目录中动态生成；第二个真实角色由 Git 外 `local-only` 星野包承担。

这不影响包校验、能力缺失、升级、隔离和切换行为的自动化覆盖，也避免提交来源不明素材，但形式上没有提交两个固定夹具。若未来需要提高人工复现便利性，可再增加一个极简、完全自制且无可选能力的固定夹具；该事项不阻塞当前功能。

### 2. 全局定时任务缺少专门的端到端回归文件

实现检查确认，scheduler 在任务执行时调用当前 Active Character 的系统提示词，`scheduler-runner.ts` 只写全局执行历史，不调用角色记忆或关系写入。现有测试分别覆盖全局任务跨角色共享、当前角色提示词和角色记忆隔离，但没有单独用一个 scheduler 端到端测试同时断言这三项。

这是一项测试证据加固机会，不是已观察到的功能缺陷；当前不另建阻塞 Ticket。

## 关闭主规格的判定

当前建议：

- #2～#15：保持已关闭。
- #31：保持打开，完成星野音色资产校准以及全局 TTS preset 的加载、回滚和恢复验证。
- #1：保持打开，并标记“仅被 #31 阻塞”。

完成 #31 后应至少重新验证：

1. 昔涟 → 星野 → 昔涟往返时，GPT-SoVITS 权重、参考音频、标注文本和语言设置与目标角色一致。
2. 切换失败或启动恢复时，全局 TTS preset 与 Active Character 一致。
3. 桌面通话、普通 TTS、微信文字转语音和微信语音卡片使用同一角色音色。
4. 不可用 preset 明确报错，不回退到上一角色音色。
5. 用户试听确认星野音色相似度可接受。

