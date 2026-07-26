# 主仓更新与私仓保护性同步研究

> 研究日期：2026-07-26  
> 主仓：`Playa-0v0/Cyrene-Agent`  
> 私仓：`Liyang0701/Cyrene-Agent`  
> 固定比较点：私仓 `origin/master@27b1807e567b1fab4ecfa14007c1ebee33e34832`，主仓 `upstream/master@87f74b106d7fdaab9ab20889735ac47f5b6b2eee`

## 1. 结论先行

这次同步不能用“把主仓文件覆盖到私仓”的方式完成，也不适合无条件接受所有冲突的 `theirs` 版本。

原因不是私仓只有少量定制，而是两边从共同基线 `fc58408a314c42e40ed8827751847944edcde159` 之后形成了两套并行演进：

- 主仓领先分支包含 93 个提交，重点新增 CITA、可信 Action Gate、厂商分级 Structured Output、Chat/Work 分流、社交上下文、富文本聊天、Mossland TTS、截图框架和后续音乐架构。
- 私仓领先分支包含 44 个提交，重点新增完整角色包运行时、角色状态隔离与切换事务、微信多账号和语音卡片、macOS 本地 MLX ASR、本地 Qwen 回退、GPT-SoVITS 多语言以及角色语料闸门。
- 私仓 `27b1807` 已把主仓当时的音乐系统基线 `fc58408` 作为第二父提交合入，因此“音乐功能”不是从零同步；真正待同步的是 `fc58408` 之后的音乐修复、CITA 引用体系和 MCP 播放重构。

建议采用“标准三方合并保留历史 + 对共享编排点手工整合 + 分领域回归”的保护性流程。标准三方合并会自然保留仅私仓新增的角色和微信模块；整仓复制则会把它们从工作树中删除。

## 2. 证据范围与方法

本报告只使用一手来源：

1. 两个固定 Git 对象及其提交历史。
2. 两个固定点的源码、测试、README 和仓库内设计文档。
3. 主仓官方 GitHub 提交页，用于提供可复核链接。

核心 Git 事实：

| 项目 | 结果 |
|---|---|
| 共同基线 | `fc58408a314c42e40ed8827751847944edcde159` |
| `git rev-list --left-right --count origin/master...upstream/master` | 私仓独有 44，主仓独有 93 |
| 私仓当前提交 | [`27b1807`](https://github.com/Liyang0701/Cyrene-Agent/commit/27b1807e567b1fab4ecfa14007c1ebee33e34832) |
| 主仓当前提交 | [`87f74b1`](https://github.com/Playa-0v0/Cyrene-Agent/commit/87f74b106d7fdaab9ab20889735ac47f5b6b2eee) |

注意：`git diff origin/master..upstream/master` 会把“只存在于私仓”的文件显示为删除，但这不等于三方合并一定会删除这些文件。真正的风险分为两类：

- **整仓覆盖风险**：私仓独有文件会被直接删除。
- **三方合并风险**：两边都修改过的共享文件，或主仓删除而私仓继续修改的文件，需要人工判定语义。

## 3. 主仓新增与变更

### 3.1 音乐：从可用基线演进为 Provider、可信引用和 MCP 播放

主仓在私仓已合入的音乐基线之后继续完成了四层改造。

1. 恢复推荐、保存会话和登录状态：
   - [`e36b533`](https://github.com/Playa-0v0/Cyrene-Agent/commit/e36b533ffcd2ef147b16152ad6f46c61a788a0a6)
   - 主要路径：`src/main/music/music-service.ts`、`music-mcp-client.ts`、`result-normalizer.ts`、`vendor/cloud-music-mcp/`
2. 增加 Provider 抽象、路由和候选集合状态：
   - [`77bee7e`](https://github.com/Playa-0v0/Cyrene-Agent/commit/77bee7e12b547366cd5ea3e3327ea88b1d978e36)
   - 主要路径：`src/main/music/music-provider.ts`、`music-router.ts`、`netease-music-provider.ts`、`selection-set-cache.ts`
3. 加固播放校验、回复约束和共享网易云运行时会话：
   - [`d72d95b`](https://github.com/Playa-0v0/Cyrene-Agent/commit/d72d95b5bb988d370a0fe8d8ac43196740ff7651)
   - [`f6e9755`](https://github.com/Playa-0v0/Cyrene-Agent/commit/f6e975511641801885cad9037c632c504e371e5c)
4. 通过 CITA 和 Tool Runtime 暴露不透明 `candidateRef`，最终播放统一走 MCP：
   - [`cca7fca`](https://github.com/Playa-0v0/Cyrene-Agent/commit/cca7fca19d89c234f050259061beb764e8520ebd)
   - [`084ae1e`](https://github.com/Playa-0v0/Cyrene-Agent/commit/084ae1ebfe000ab9d3a33376b3fa6ef1eb207d5b)
   - 主要路径：`src/main/orchestrator/context-ref-registry.ts`、`tools/music-tools.ts`、`src/main/music/netease-music-provider.ts`

当前净效果是：模型看到的是短期有效、按会话隔离的 `candidateRef`，真实 Provider、歌单和歌曲 ID 留在运行时内部；模型不能凭聊天文本猜一个网易云 ID 后直接播放。

实际例子：

> 昔涟展示三首日推后，用户说“播放第一首”。CITA 把“第一首”解析到本轮候选的 `candidateRef`，Tool Runtime 再验证会话和有效期，最后由 MCP 播放真实歌曲。用户切换会话后再说“第一首”，旧引用不会被当作当前会话的合法歌曲。

可直接复用：

- `music-provider.ts`、`music-router.ts` 和对应测试。
- `context-ref-registry.ts` 的不透明引用机制。
- `playback-result-normalizer.ts` 和 MCP 播放结果规范化。
- `vendor/cloud-music-mcp` 的会话修复。

必须手工整合：

- `src/main/index.ts` 的音乐启动和关闭生命周期。
- `build-options.ts`、`cyrene-agent.ts` 和 `two-phase-fc-loop.ts` 的工具编排。
- 设置页和聊天音乐卡片，因为这些文件同时承载私仓角色切换和微信定制。

### 3.2 CITA：只做上下文认知，不直接决定或执行动作

CITA 的演进提交：

- 契约和严格 Schema：[`a4b8532`](https://github.com/Playa-0v0/Cyrene-Agent/commit/a4b85327e94d5d07167067a7a95e51efb939ca0a)
- 有界、按会话隔离的上下文状态：[`ff00caf`](https://github.com/Playa-0v0/Cyrene-Agent/commit/ff00cafd703c0406e62c9ea414359a6c379014ed)
- 远程语义理解与本地验证：[`08479be`](https://github.com/Playa-0v0/Cyrene-Agent/commit/08479beaf586240eb1a2f753fd7ca724c761f5d7)
- 可选服务和设置：[`e301792`](https://github.com/Playa-0v0/Cyrene-Agent/commit/e3017924b9e912ebd05748471f7cc65fb3cebc70)、[`5a7bfe1`](https://github.com/Playa-0v0/Cyrene-Agent/commit/5a7bfe172e3d8036a303acc436918935acedd6d0e)
- 明确改为“仅建议”：[`07de05e`](https://github.com/Playa-0v0/Cyrene-Agent/commit/07de05ec272185187b405799853ad438b42447e1)

主要路径：

- `src/main/cita/contracts.ts`
- `src/main/cita/context-store.ts`
- `src/main/cita/remote-semantic-engine.ts`
- `src/main/cita/understanding-validator.ts`
- `src/main/cita/cita-service.ts`
- `src/main/cita/context-package.ts`

关键边界：

- CITA 不输出工具名、工具参数或执行决定。
- 原始用户消息保持不变，CITA 结果作为独立内部上下文注入。
- 远程语义失败时回退到原始消息和可信结构上下文，不阻断回复。
- 当前只实现远程语义引擎；设置里的本地语义模型并未真正实现。

实际例子：

> 用户说“就上一个吧”。CITA 可以说明“上一个”指向前一轮展示的哪一个对象，但不能自己调用 `music_play_track`。是否行动仍由 Action Gate 和 Agent 决定，工具运行时还会再次校验引用。

可直接复用 CITA 核心目录和严格验证测试；必须在私仓的角色上下文构建器中手工决定注入顺序，确保 CITA 不能替换 Active Character 的身份、Application Policy 或角色私有记忆根。

### 3.3 Work 可信执行链：Action Gate、Native Function Calling 和 Structured Output

主仓把工具执行链升级为：

`CITA → Action Gate → Native Function Calling → Execution Policy → Tool Runtime → Soul`

代表提交：

- CITA-aware LangGraph 运行时：[`bbddcb6`](https://github.com/Playa-0v0/Cyrene-Agent/commit/bbddcb6d5df88bb167ac80e16b9184431b2e1690)
- 恢复原生 Function Calling：[`a98b8d1`](https://github.com/Playa-0v0/Cyrene-Agent/commit/a98b8d14ef16c6965f42534ae3d87e767827099d)
- 工具成功后的确定性终结路由：[`d5d3f7c`](https://github.com/Playa-0v0/Cyrene-Agent/commit/d5d3f7cdf73b47c9b4c7a73758861f426a954626)
- Action Gate 虚拟工具和动态能力枚举：[`7d23c88`](https://github.com/Playa-0v0/Cyrene-Agent/commit/7d23c88c5a0f7b0c77c9f2cdbd345057fb75c44f)、[`8ad57c7`](https://github.com/Playa-0v0/Cyrene-Agent/commit/8ad57c7a7b382f20374a29a92d81f16cbefba461)
- 多厂商能力 Profile：[`67a7cbc`](https://github.com/Playa-0v0/Cyrene-Agent/commit/67a7cbca1f883ef3c4b3dc9ef6bd7b439b085e31)
- 用户可见协议错误：[`96159f2`](https://github.com/Playa-0v0/Cyrene-Agent/commit/96159f2321c334be33eb5d47ef75a01f762f859c)
- 通用 Structured Output 核心：[`59db13a`](https://github.com/Playa-0v0/Cyrene-Agent/commit/59db13a684b5997c2a7d5de1e15da9ba5508da3e)
- CITA 和 Action Gate 迁移到统一可信输出管线：[`5c8a3c9`](https://github.com/Playa-0v0/Cyrene-Agent/commit/5c8a3c94d15ce08d03e647fb5f779675a80fca58)、[`6872b00`](https://github.com/Playa-0v0/Cyrene-Agent/commit/6872b0005507f6da5b37ee1c0a82c17c6093e541)
- 加固与厂商部署模型后缀：[`2ce1964`](https://github.com/Playa-0v0/Cyrene-Agent/commit/2ce1964736a7d8f032a02d18e91398fada3f6916)、[`91ba4f6`](https://github.com/Playa-0v0/Cyrene-Agent/commit/91ba4f6ace54021152c9307ed146e500d2f09112)

主要新增目录：

- `src/main/orchestrator/structured-output/`
- `src/main/orchestrator/vendors/action-gate-profiles.ts`
- `src/main/orchestrator/action-gate.ts`
- `src/main/orchestrator/langgraph-agent-loop.ts`
- `src/main/orchestrator/tool-argument-validator.ts`
- `src/main/orchestrator/tool-execution-context.ts`

实际例子：

> 用户说“把这个文件发邮件给客户”。Action Gate 先判断需要哪些能力，Native FC 生成工具调用，本地 Schema 和业务校验确认参数，权限策略决定是否允许，工具成功后 Soul 只能基于真实结果回复。若模型给出无法验证的 JSON，系统应停止执行并说明失败，而不是猜测已经发出。

这部分核心模块可复用，但不能整体覆盖私仓的编排文件。私仓对本地 Qwen、微信端点回退、角色上下文和角色状态根已有额外语义，详见第 5 节。

### 3.4 Chat/Work 分流和轻量社交上下文

提交：

- 路由设计：[`63fb1a9`](https://github.com/Playa-0v0/Cyrene-Agent/commit/63fb1a927262b8a28f83a080256f607e0fd2af1e)
- Chat 只走 Soul：[`b83b407`](https://github.com/Playa-0v0/Cyrene-Agent/commit/b83b407bd1c28a894604b9a6487b4fb9b04882ab)
- 删除旧聊天 IPC 路径：[`bda5dcf`](https://github.com/Playa-0v0/Cyrene-Agent/commit/bda5dcfab3ff2dce7b5eef06b13cc0cc2fc4b2b0)
- 可选社交上下文：[`fa2848a`](https://github.com/Playa-0v0/Cyrene-Agent/commit/fa2848a817f2222849452e76194fa46e2f3cb821)

当前语义：

- Chat：不运行 CITA、Action Gate 和工具，只让 Soul 基于会话、角色提示、记忆和可选社交上下文回复。
- Work：进入完整可信执行链。
- 社交上下文仅在 Chat 启用；本地 BM25 加时间衰减检索最多五条 social atom，回复后异步提取，提取失败不重试、不阻断当前回复。
- 自定义端点设置由 [`2564f01`](https://github.com/Playa-0v0/Cyrene-Agent/commit/2564f01bbb110a8ef920604f57a4ceab3294122e) 增加。

实际例子：

> 在 Chat 模式说“今天有点累”，系统不会因为文本里出现“今天”而调用天气或日程工具，只由角色自然回应。开启社交上下文后，下一次聊天可以检索“最近加班”这类有原句证据、尚未过期的事实；切到 Work 后则仍走工具链。

私仓也有 `soul-only` 优化，但主要面向微信短聊天和本地模型性能，两边概念相近、实现边界不同。同步时应统一成一个明确的执行模式枚举，不能保留两套互相抢路由的判断。

### 3.5 聊天渲染、竞态和安全

提交：

- 用户头像实时同步：[`16467b0`](https://github.com/Playa-0v0/Cyrene-Agent/commit/16467b012b73b51a1bd50db8bdf3a20932d90922)
- 主动回复与手动发送竞态修复：[`9153653`](https://github.com/Playa-0v0/Cyrene-Agent/commit/915365382d0a519b0c33a44bb06f6122c8352665)
- Markdown、代码高亮、复制和 XSS 处理：[`b0355c2`](https://github.com/Playa-0v0/Cyrene-Agent/commit/b0355c29ebb59122adfe08a3bbcb85294983a8fa)
- AG-UI `<think>` 过滤：[`40365fd`](https://github.com/Playa-0v0/Cyrene-Agent/commit/40365fddd574850ecbd809a17cdb04c001908e4e)
- KaTeX：[`1068c73`](https://github.com/Playa-0v0/Cyrene-Agent/commit/1068c73c21f1fdedb82bc0ee8b41cbc6d171b93d)
- 流式代码块和增量 Markdown：[`0e84486`](https://github.com/Playa-0v0/Cyrene-Agent/commit/0e84486c5da0fc22727185a52e91a7372792554f)、[`5298cc7`](https://github.com/Playa-0v0/Cyrene-Agent/commit/5298cc78f7fea69d7bb2f3b78377b7001806ef88)
- 性能、异常降级和清理：[`c8bf53d`](https://github.com/Playa-0v0/Cyrene-Agent/commit/c8bf53d443297af3a4d006915030e1898cc6bbf6)
- 天气卡片字段全部转义：[`ba4a654`](https://github.com/Playa-0v0/Cyrene-Agent/commit/ba4a654713904936bc4bb1760a068658e325ab8d)

主要路径：

- `src/renderer/chat/markdown/`
- `src/main/chat/think-filter.ts`
- `src/renderer/chat/session-reload-policy.ts`

这组实现相对独立，适合优先复用。但 `src/renderer/chat/main.ts` 是高冲突文件，必须保留私仓的 Active Character、角色贴纸能力边界和微信镜像逻辑。

### 3.6 时区、主动触发、多模态和界面

功能提交：

- 用户时区贯穿模型环境和天气：[`23f5e4f`](https://github.com/Playa-0v0/Cyrene-Agent/commit/23f5e4fa0487731771f38dd09be3ce2aa29ff7e0)
- 新增主动触发器并修正 proactive prompt 时区：[`1d9d9a0`](https://github.com/Playa-0v0/Cyrene-Agent/commit/1d9d9a065f77b1ea8390bf497d8beb06604f9b03)
- 多模态开关替代旧 `syncWithMain`：[`6dacd25`](https://github.com/Playa-0v0/Cyrene-Agent/commit/6dacd25343794bcfc84e5fa5849cc7eea329b55d)

此外还有一组设置中心和聊天 UI 调整，包括品牌卡片、性别选择器、图标替换、Work/Chat 开关位置、状态/心情 PNG。它们主要落在：

- `src/renderer/settings/index.html`
- `src/renderer/settings/settings.css`
- `src/renderer/settings/settings.ts`
- `src/renderer/chat/index.html`
- `src/renderer/chat/main.ts`
- `src/renderer/sidebar/`

可复用时区和纯样式资产；设置页面必须与私仓的角色管理、微信多账号和本地 ASR 控件合并，不能直接替换。

### 3.7 Mossland 云端 TTS

提交：[`03aac54`](https://github.com/Playa-0v0/Cyrene-Agent/commit/03aac549666f8957ee54e848aa46e88c84501c01)

新增能力：

- 文本合成。
- 上传参考音频克隆音色。
- 拉取账号音色列表。
- 错误码转中文提示。
- 聊天自动朗读缓存和设置页测试发音。

主要路径：

- `src/main/tts/mossland-engine.ts`
- `src/main/tts/tts-dispatcher.ts`
- `src/shared/tts-types.ts`
- `src/main/index.ts`
- 设置页 TTS 区域

`mossland-engine.ts` 本身可以直接复用。分发器、设置和缓存必须接入私仓的 `Voice Profile → TTS Service` 边界，不能让全局 Mossland 配置绕过当前角色音色能力判断。

实际例子：

> 用户当前切换到星野，星野角色包声明使用 GPT-SoVITS。即使全局设置中还保存着昔涟的 Mossland 音色，系统也不能因为 Mossland 可用就自动拿昔涟音色朗读星野回复。只有角色 Voice Profile 明确绑定相应 TTS Service 才能使用。

### 3.8 微信式截图：代码已加入，但当前主仓主动禁用

提交：

- 截图窗口、全局热键和区域选择：[`4d8c57a`](https://github.com/Playa-0v0/Cyrene-Agent/commit/4d8c57a56444954a957ccd3b7fe6214f3addc0f2)
- 可选调用防崩：[`3ba7a5e`](https://github.com/Playa-0v0/Cyrene-Agent/commit/3ba7a5e7951bbfd9cbe57bdcb7af122668d73edc)
- 预创建 Overlay、修复任务栏遮挡：[`287bd91`](https://github.com/Playa-0v0/Cyrene-Agent/commit/287bd918169523ce50b6008936c1f174db6456d2)
- 持久 MediaStream 和确认工具条：[`f32575b`](https://github.com/Playa-0v0/Cyrene-Agent/commit/f32575b5878d1ca97652c9abae56cc2a98c63fa5)
- 因重构暂时禁用 UI 和热键：[`b97b628`](https://github.com/Playa-0v0/Cyrene-Agent/commit/b97b6285bd6f2f93d7a983fd9c2ab40f1d162f3c)

当前净状态：

- `src/main/screenshot/`、`src/preload/screenshot.ts` 和 `src/renderer/screenshot/` 仍存在。
- 全局热键注册和热键替换被注释。
- 聊天和设置入口被隐藏。

因此不能把它写成“主仓当前可用截图功能”。它是已实现但暂时关闭的实验代码。私仓主要验收平台是 macOS，还涉及屏幕录制权限、全局快捷键和多屏坐标；在主仓重新启用并补齐跨平台测试前，建议同步代码但保持功能关闭。

## 4. 私仓独有能力与架构边界

### 4.1 macOS 本地运行与 MLX ASR

提交：

- 本地 MLX ASR、模型兼容、中文 PDF 和本地 Reranker：[`83d7d31`](https://github.com/Liyang0701/Cyrene-Agent/commit/83d7d310526235758b6169fbce3e52b93b0a9fbf)
- 通话 VAD 改用 RMS：[`ccc57dc`](https://github.com/Liyang0701/Cyrene-Agent/commit/ccc57dc27d8413d56858d87b885973aa694719e7)

核心路径：

- [`src/main/asr/local-asr-worker-manager.ts`](../../src/main/asr/local-asr-worker-manager.ts)
- [`src/main/asr/asr-service.ts`](../../src/main/asr/asr-service.ts)
- [`scripts/asr/asr_worker.py`](../../scripts/asr/asr_worker.py)
- [`src/renderer/call/vad-level.ts`](../../src/renderer/call/vad-level.ts)
- [`docs/macos-local-adaptation.md`](../macos-local-adaptation.md)

架构边界：

- ASR Service 统一选择本地或云端 Session。
- 本地 Worker 生命周期、预加载、超时、取消、异常恢复和资源回收由主进程管理。
- 通话与微信语音复用同一 ASR 抽象。
- 主仓当前通话代码只直接创建云端 ASR 流；覆盖它会使本地 ASR 消失。

### 4.2 本地 Qwen 和微信性能回退

提交：[`2b2de5f`](https://github.com/Liyang0701/Cyrene-Agent/commit/2b2de5fcae2f5f0e18ea6e38defa19f47326016a)

核心路径：

- [`src/main/channels/channel-execution-plan.ts`](../../src/main/channels/channel-execution-plan.ts)
- [`src/main/channels/channel-model-fallback.ts`](../../src/main/channels/channel-model-fallback.ts)
- [`src/main/channels/channel-history-context.ts`](../../src/main/channels/channel-history-context.ts)
- [`src/main/orchestrator/two-phase-fc-loop.ts`](../../src/main/orchestrator/two-phase-fc-loop.ts)
- [`docs/wechat-response-optimization.md`](../wechat-response-optimization.md)

架构边界：

- 高置信度短聊天可走私仓既有 `soul-only`，明确工具请求走筛选后的工具集。
- 回环地址上的本地 Qwen 使用仅请求副本可见的 `/no_think`，不污染历史。
- 云端网络失败、限流或服务端错误可以在单次请求边界回退本地模型，已执行工具不会重跑。
- 本地主模型能力是私仓真实验证过的产品能力，而主仓 README 对未知本地端点只承诺通用 D 档、不保证 Work 链路。

### 4.3 完整角色包、统一 Active Character 和状态隔离

主要提交：

- CharacterRuntime 基线与安全导入：[`a158563`](https://github.com/Liyang0701/Cyrene-Agent/commit/a158563f1b88cbdba52a5f9048eb2e1a9e9536d5)、[`b8de530`](https://github.com/Liyang0701/Cyrene-Agent/commit/b8de53020fd3521fbc00062e1a3e57d37738937c)
- 角色状态根：[`8b1ec0d`](https://github.com/Liyang0701/Cyrene-Agent/commit/8b1ec0df97a61846da2e55cae2ef7440e124bd25)
- 文本/UI、视觉/语义动作、语音/ASR hints：[`7e1c0a7`](https://github.com/Liyang0701/Cyrene-Agent/commit/7e1c0a76acfd044501d5e6e3b3111f76132de039)、[`28b0ba8`](https://github.com/Liyang0701/Cyrene-Agent/commit/28b0ba84555a723260df68e3a8375144171bf227)、[`51d062c`](https://github.com/Liyang0701/Cyrene-Agent/commit/51d062c78cb2903a21a663d21a3326ca734fcefe)
- 会话私有状态与全局用户数据分离：[`f7ea559`](https://github.com/Liyang0701/Cyrene-Agent/commit/f7ea559a16f4bcfb2448e7d44eba0814aa6334e3)、[`3009706`](https://github.com/Liyang0701/Cyrene-Agent/commit/300970635321450adcc6442a4c82f4962dca777e)
- 受控切换、重启、生命周期和启动恢复：[`7813caf`](https://github.com/Liyang0701/Cyrene-Agent/commit/7813caff026c4399aa11b64b8e10fc6d34aaa86b)、[`2aac056`](https://github.com/Liyang0701/Cyrene-Agent/commit/2aac056b15c6b42e5f2296d32251f74e76056240)、[`326b0cd`](https://github.com/Liyang0701/Cyrene-Agent/commit/326b0cd113627c6bfacce238957f3bf58d63ee7a)、[`bfcaeb3`](https://github.com/Liyang0701/Cyrene-Agent/commit/bfcaeb3d72a86a1e128191d7ac7b4126ae6b4bc8)
- 架构护栏和能力不继承：[`ac66513`](https://github.com/Liyang0701/Cyrene-Agent/commit/ac66513b30c0fb836092148f6a97ec07f1da23ce)、[`a8f23e8`](https://github.com/Liyang0701/Cyrene-Agent/commit/a8f23e8f72c6fbba80601d7c78abbd3b23fd7257)

核心路径：

- [`src/main/character/character-runtime.ts`](../../src/main/character/character-runtime.ts)
- [`src/main/character/character-state.ts`](../../src/main/character/character-state.ts)
- [`src/main/character/character-text-context.ts`](../../src/main/character/character-text-context.ts)
- [`src/main/character/character-visual.ts`](../../src/main/character/character-visual.ts)
- [`src/main/character/character-speech.ts`](../../src/main/character/character-speech.ts)
- [`src/main/character/character-electron-switch.ts`](../../src/main/character/character-electron-switch.ts)
- [`docs/validation/character-switching-spec-audit.md`](../validation/character-switching-spec-audit.md)

不可破坏的边界：

1. 产品品牌、工具、安全策略和全局服务在角色之上。
2. 身份、人格、世界书、视觉、语义动作、Voice Profile、贴纸和开场白属于角色包。
3. 记忆、聊天、关系、世界书状态、主动状态和 TTS 缓存按 Character ID 物理隔离。
4. 用户显式资料、文档、待办、日程和提醒跨角色共享。
5. 未声明的角色能力不可从上一角色或昔涟继承。
6. 切换只能在无回复、通话、ASR、TTS、主动消息和状态写入时进行，并通过受控重启完成。

### 4.4 GPT-SoVITS 多语言与角色 Voice Profile

提交：[`d3f1b21`](https://github.com/Liyang0701/Cyrene-Agent/commit/d3f1b219051682acd5af41d0cb0a45d92c7ec0db)

核心路径：

- [`src/main/tts/gptsovits-engine.ts`](../../src/main/tts/gptsovits-engine.ts)
- [`src/main/tts/tts-dispatcher.ts`](../../src/main/tts/tts-dispatcher.ts)
- [`src/main/character/character-speech.ts`](../../src/main/character/character-speech.ts)
- [`src/main/call/call-manager.ts`](../../src/main/call/call-manager.ts)

私仓显式保留 `promptLang` 和 `textLang`，并由角色 Voice Profile 解析后传入桌面、通话和微信 TTS。主仓当前 `call-manager.ts` 和 `tts-dispatcher.ts` 没有这些参数；直接采用主仓版本会把日文参考音频或日文角色回复按默认中文处理。

### 4.5 微信语音卡片和多账号隔离

提交：

- TTS 回复转紧凑音频文件：[`3bd6c51`](https://github.com/Liyang0701/Cyrene-Agent/commit/3bd6c517944925de0427fe01e87ab12935e26e3b)
- 多账号连接：[`9f79f77`](https://github.com/Liyang0701/Cyrene-Agent/commit/9f79f77169962202d1b21045bfd96c11c72ec7aa)

核心路径：

- [`src/main/channels/adapters/wechat/wechat-account-store.ts`](../../src/main/channels/adapters/wechat/wechat-account-store.ts)
- [`src/main/channels/adapters/wechat/wechat-account-connection-pool.ts`](../../src/main/channels/adapters/wechat/wechat-account-connection-pool.ts)
- [`src/main/channels/adapters/wechat/wechat-conversation-identity.ts`](../../src/main/channels/adapters/wechat/wechat-conversation-identity.ts)
- [`src/main/channels/adapters/wechat/wechat-channel-identity-state.ts`](../../src/main/channels/adapters/wechat/wechat-channel-identity-state.ts)
- [`src/main/channels/adapters/wechat/wechat-audio-file.ts`](../../src/main/channels/adapters/wechat/wechat-audio-file.ts)
- [`src/main/channels/dispatcher.ts`](../../src/main/channels/dispatcher.ts)

不可破坏的边界：

- 每个 `ilinkBotId` 独立保存凭据、连接、重连和启停状态。
- 会话 ID 同时包含连接账号和对话身份，两个微信账号的同名联系人不能串历史、权限或任务。
- 出站回复必须保留 `connectionAccountId` 和 `conversationIdentity`，才能回到正确账号和会话。
- 微信 TTS 使用角色私有缓存根并生成平台可发送的紧凑音频。

主仓当前 `dispatcher.ts` 使用 `channel + senderId` 生成会话，并在出站对象中不保留上述两个身份字段；直接覆盖会导致多账号串线风险。

### 4.6 角色语料闸门

提交：[`b4295a7`](https://github.com/Liyang0701/Cyrene-Agent/commit/b4295a7eff5897804f87005448e47e4c13783b9a)

核心路径：

- [`src/main/character-corpus/character-corpus.ts`](../../src/main/character-corpus/character-corpus.ts)
- [`src/main/character-corpus/character-corpus-cli.ts`](../../src/main/character-corpus/character-corpus-cli.ts)
- [`docs/character-corpus-workflow.md`](../character-corpus-workflow.md)

它保证角色还原材料有来源、语言、场景、说话人、审核状态和哈希，而不是把无出处的社区总结直接写入角色人格。这一能力与主仓 CITA 无直接冲突，应完整保留。

## 5. 同步风险矩阵

| 区域 | 风险 | 主仓变化 | 私仓必须保留 | 推荐处理 |
|---|---|---|---|---|
| `src/main/index.ts` | 极高 | CITA、Mossland、截图、时区、社交上下文、音乐生命周期 | CharacterRuntime 启动恢复、角色状态根、微信多账号、本地 ASR、本地模型回退、角色 TTS | 逐段手工合并，禁止整文件取主仓 |
| `build-options.ts` | 极高 | Chat/Work、CITA、社交上下文、风格采样 | Active Character 提示、角色私有关系/记忆、微信本地模型策略、贴纸能力不继承 | 先定义统一上下文顺序和执行模式，再手工合并 |
| `cyrene-agent.ts`、`two-phase-fc-loop.ts` | 极高 | LangGraph、Action Gate、Structured Output、终结路由 | `softNoThink`、云端到本地回退、工具不重跑、私仓性能路径 | 复用新核心，重写胶水层；补本地 Qwen 契约测试 |
| `vendors/openai-adapter.ts` | 高 | 厂商结构化输出和 reasoning 兼容 | MLX token 用量、Qwen `/no_think`、fallback 后端 | 合并两边解析字段和请求提示，跑本地 0.4.2 实测 |
| `channels/dispatcher.ts` | 极高 | Chat/Work 模式、主仓渠道 TTS 语义 | 微信多账号结构化身份、角色缓存根、语音卡片、账号路由 | 以私仓身份模型为骨架，引入执行模式，不反向简化 session ID |
| `agui-bridge.ts` | 高 | executionMode、Action Gate 错误、社交上下文 turn ID | 微信身份、角色相关完成回调 | 手工合并事件契约并补端到端测试 |
| 设置页三件套 | 极高 | CITA、自定义端点、Mossland、时区、截图开关、视觉改版 | 角色管理、微信多账号、本地 ASR、GPT-SoVITS 多语言 | 以功能区为单位移植 DOM/CSS/状态，不取整文件 |
| `renderer/chat/main.ts` | 极高 | Markdown、KaTeX、think 过滤、音乐、截图、Chat/Work | Active Character、角色贴纸边界、微信镜像、TTS 多语言 | 富文本模块可直接加入，入口文件手工接线 |
| TTS dispatcher/types | 极高 | Mossland | 多语言 GPT-SoVITS、角色 Voice Profile | 扩展联合类型，不删除 `promptLang/textLang`；Mossland 也必须走角色解析 |
| 通话/ASR | 极高（覆盖时） | 主仓仍偏云端 ASR | 本地 MLX Session、RMS VAD、角色 ASR hints、角色 Voice Profile | 保留私仓文件，单独接入 Mossland |
| Live2D/动作 | 高 | 主仓继续使用具体 Live2D actions | 私仓稳定 Semantic Action → 每角色映射 | 保留语义动作边界，禁止模型看到角色模型动作名 |
| opener/proactive | 高 | 主仓删除旧 opener 文件并新增触发器 | 私仓角色开场白、角色私有 proactive 状态、切换时丢弃旧角色结果 | 不接受删除；把新触发条件接入角色感知服务 |
| 音乐 | 高 | Provider/CITA/MCP 重构 | 私仓已合入的音乐 UI 与角色/微信编排适配 | 采用上游音乐核心，重做共享入口冲突 |
| 截图/剪贴板 | 中高 | 新框架后暂时禁用 | 私仓 macOS 权限和现有图片发送策略 | 保持关闭；先做 macOS 权限、多屏和剪贴板回归 |
| `package.json` / lock | 高 | LangGraph、Markdown、KaTeX、DOMPurify、Shiki | `corpus:validate` 和私仓已有依赖 | 合并依赖与脚本后重新 `npm install` 生成 lock，不手拼 lock |
| README/docs | 中 | 主仓按昔涟单角色、Windows 优先重写 | 私仓实际支持 macOS、角色切换、微信多账号、本地模型 | 更新说明必须基于私仓最终能力，不能照抄主仓限制 |

## 6. 最可能发生的具体行为回退

### 6.1 角色切换看似还在，实际回复又固定成昔涟

主仓的渠道提示仍有“语气仍是昔涟”这样的固定文本，主仓也没有 CharacterRuntime。若只保留设置页角色选择，却用主仓 `build-options.ts`，星野界面可能显示正确，但模型提示、贴纸、世界书或 TTS 又走昔涟。

验收例：

1. 切换星野并重启。
2. 桌面、通话、微信分别询问身份。
3. 三端都应使用星野的人格、ASR hints 和 Voice Profile。
4. 不得出现昔涟贴纸、昔涟音色或固定“昔涟”渠道提示。

### 6.2 两个微信账号的同一个联系人串线

主仓 `dispatcher.ts` 只按 `channel + senderId` 计算会话；私仓按连接账号和结构化对话身份计算。若覆盖，账号 A 和账号 B 都有 `senderId=123` 时，可能共享历史，甚至回复从错误账号发出。

验收例：

1. 两个 iLink Bot 同时在线。
2. 同一个微信用户分别给两个 Bot 发送不同秘密。
3. 两条会话历史、权限、待处理消息和回复账号必须完全隔离。

### 6.3 本地 Qwen 的微信延迟或工具能力倒退

主仓对未知本地端点采用通用 D 档；私仓已经针对 Qwen3.5/MLX 0.4.2 验证 `/no_think`、云端缓存、15 秒回退和原生天气工具。若用主仓 Profile 覆盖，可能出现：

- 短聊天重新走多阶段模型调用，延迟从约 20 秒回到 50 秒以上。
- `/no_think` 被写入历史。
- 本地回退后重复执行已成功的工具。
- 本地端点被判为不支持 FC，天气退化为纯文本猜测。

### 6.4 日语角色被按中文参考合成

主仓 TTS dispatcher 缺少私仓的 `promptLang/textLang`。星野日文参考音频若被当作中文，轻则发音异常，重则 GPT-SoVITS 请求失败。同步 Mossland 时必须扩展而不是替换现有 TTS Payload。

### 6.5 微信文字正常，但语音卡片消失

主仓当前明确对微信关闭通用渠道 TTS 追加；私仓有专门的微信紧凑音频链路。若误用主仓 `shouldAppendChannelTtsAudio` 和通用缓存目录，微信可能只返回文字，或生成微信不能发送的音频格式。

### 6.6 截图按钮出现但 macOS 无反应

主仓截图当前已禁用，且 README 仍以 Windows 为完整验证平台。若只恢复 UI，不补 macOS 屏幕录制权限和坐标测试，用户会看到按钮却截不到图。同步阶段应保留隐藏状态。

### 6.7 主动消息在切换后由旧角色补发

主仓新增 proactive trigger；私仓要求非当前角色结果丢弃，主动状态按角色隔离。若触发器直接接旧全局 service，切到星野后可能收到切换前由昔涟生成的消息。

### 6.8 音乐“第一首”播放错会话的歌曲

如果只合入 CITA 文本理解而未合入 `context-ref-registry` 的会话、类型和 TTL 校验，模型可能把另一个会话的 `candidateRef` 带入当前会话。必须把引用签发和解析都放在 Tool Runtime。

## 7. 推荐复用、手工整合和暂缓项

### 7.1 可直接复用的上游实现

优先以完整提交或完整新目录引入：

- `src/main/cita/` 核心，但接线晚于私仓角色上下文边界设计。
- `src/main/orchestrator/structured-output/`。
- `src/main/social-context/`，同时把存储根改到当前 Active Character 的私有状态布局。
- `src/renderer/chat/markdown/`。
- `src/main/chat/think-filter.ts`。
- `src/main/tts/mossland-engine.ts`。
- 音乐 Provider、Router、引用注册表和 MCP 结果规范化。
- 时区纯函数和选项数据。
- 新 SVG/PNG 资源中与角色无关的通用图标。

### 7.2 必须保留并手工整合的私仓实现

- 全部 `src/main/character/` 和 `src/main/character-corpus/`。
- `src/main/asr/` 的本地 ASR 抽象、Worker 和 macOS 脚本。
- 微信账号存储、连接池、结构化身份、待处理入站、任务隔离和语音文件链。
- `Character State Root` 在聊天、记忆、关系、世界书、主动状态和 TTS 缓存中的所有调用。
- `Semantic Action` 边界。
- GPT-SoVITS `promptLang/textLang`。
- `softNoThink`、云端到本地 fallback、缓存 token 解析和工具不重跑。
- 角色设置页、受控重启和启动恢复。
- `corpus:validate` 脚本。

### 7.3 建议同步代码但暂缓启用

- 微信式截图：保留禁用，等主仓重构完成并补 macOS 验收。
- CITA 本地语义模型：主仓当前没有实现，不应把设置占位描述成已支持。
- 未经私仓本地 Qwen 契约测试的 Structured Output D 档。
- 新主动触发器：先完成角色 generation token、切换取消和状态根接线。

## 8. 为什么不能整套主仓直接接入

1. **身份模型不同**：主仓是以昔涟为中心的单角色应用；私仓把角色做成可安装、可切换、可隔离状态的一级领域对象。
2. **渠道身份模型不同**：主仓微信是单连接语义；私仓是多账号、多连接、结构化对话身份。
3. **运行平台事实不同**：主仓 README 明确 Windows 完整验证、macOS 未完整验证；私仓已经把 macOS 本地 ASR、RMS VAD、PDF、Reranker 和本地模型做成实测能力。
4. **TTS 所有权不同**：主仓主要把音色配置视为全局设置；私仓区分全局 TTS Service 和角色 Voice Profile。
5. **模型兼容策略不同**：主仓保守把未知本地端点归 D 档；私仓已为本地 Qwen 建立专用、可验证的降延迟和回退路径。
6. **持久化边界不同**：私仓多种状态按 Character ID 和微信连接账号隔离；主仓新增社交上下文、音乐状态或 TTS 缓存若直接使用全局 `userData`，会破坏隔离。
7. **共享入口高度重叠**：`index.ts`、设置页、聊天主文件、编排器、preload 和 IPC 两边都大量修改，机械选择任一侧都会丢语义。

所以可复用的是“主仓的新深模块”，需要自研的是“把这些模块接入私仓更强的角色、渠道和本地运行边界的适配层”。不应重新自研 CITA Schema、Structured Output Runner、Markdown Renderer 或 Mossland API；也不应为了省事牺牲私仓已经验证的领域模型。

## 9. 建议的保护性同步顺序

1. 建立固定同步分支和回退标签，确认工作树干净。
2. 用共同基线执行标准三方合并，让 Git 自然保留私仓仅新增文件，不做目录覆盖。
3. 先解决依赖和“纯新增深模块”：
   - Structured Output
   - CITA
   - 社交上下文
   - Markdown
   - Mossland
   - 音乐 Provider/引用
4. 再处理共享架构入口：
   - `vendors`
   - `two-phase-fc-loop`
   - `cyrene-agent`
   - `build-options`
   - `agui-bridge`
   - `channels/dispatcher`
   - `index.ts`
5. 最后合并 UI、preload、IPC 和设置页。
6. 截图保持关闭；主动触发器必须接角色取消语义后才能启用。
7. 分层验证：
   - 纯模块定向测试。
   - 完整 Vitest 和生产构建。
   - 两角色往返切换及状态树哈希。
   - 两微信账号并行隔离。
   - 本地 Qwen 短聊、天气、云端失败回退。
   - 本地 MLX ASR 桌面通话和微信语音。
   - GPT-SoVITS 日语参考和微信语音卡片。
   - 音乐推荐、“第一首”、跨会话引用拒绝。
   - Chat 无工具、Work 可信工具链。
8. 更新 README 和更新说明，准确区分“已支持”“代码存在但关闭”“尚未验收”。

## 10. 最小验收清单

同步完成不能只以“测试通过”作为证据，至少需要以下结果：

- `npm test` 全量通过。
- `npm run build` 通过。
- 当前角色在桌面、通话、微信三端一致。
- 昔涟 → 星野 → 昔涟往返后，两边角色状态根互不污染且可恢复。
- 两个微信账号同时在线、同联系人不串历史和回复出口。
- 本地 ASR 完成 `LISTENING → ASR → THINKING → SPEAKING → LISTENING`。
- 本地 Qwen 短聊保留 `softNoThink=true`，历史中没有 `/no_think`。
- 云端失败回退本地时不重复执行工具。
- GPT-SoVITS 日文参考语言和输出语言正确传递。
- Chat 模式不暴露工具，Work 模式按可信链路执行。
- 音乐候选引用按会话和有效期验证。
- 截图入口保持不可见，除非另有 macOS 专项验收。

## 11. 主要源码索引

主仓固定点：

- [主仓 README@87f74b1](https://github.com/Playa-0v0/Cyrene-Agent/blob/87f74b106d7fdaab9ab20889735ac47f5b6b2eee/README.md)
- [CITA Service@87f74b1](https://github.com/Playa-0v0/Cyrene-Agent/blob/87f74b106d7fdaab9ab20889735ac47f5b6b2eee/src/main/cita/cita-service.ts)
- [Structured Output Runner@87f74b1](https://github.com/Playa-0v0/Cyrene-Agent/blob/87f74b106d7fdaab9ab20889735ac47f5b6b2eee/src/main/orchestrator/structured-output/runner.ts)
- [Action Gate@87f74b1](https://github.com/Playa-0v0/Cyrene-Agent/blob/87f74b106d7fdaab9ab20889735ac47f5b6b2eee/src/main/orchestrator/action-gate.ts)
- [音乐工具引用@87f74b1](https://github.com/Playa-0v0/Cyrene-Agent/blob/87f74b106d7fdaab9ab20889735ac47f5b6b2eee/src/main/orchestrator/tools/music-tools.ts)
- [Mossland 引擎@87f74b1](https://github.com/Playa-0v0/Cyrene-Agent/blob/87f74b106d7fdaab9ab20889735ac47f5b6b2eee/src/main/tts/mossland-engine.ts)
- [截图管理器@87f74b1](https://github.com/Playa-0v0/Cyrene-Agent/blob/87f74b106d7fdaab9ab20889735ac47f5b6b2eee/src/main/screenshot/screenshot-manager.ts)

私仓固定点：

- [CharacterRuntime@27b1807](https://github.com/Liyang0701/Cyrene-Agent/blob/27b1807e567b1fab4ecfa14007c1ebee33e34832/src/main/character/character-runtime.ts)
- [角色语音边界@27b1807](https://github.com/Liyang0701/Cyrene-Agent/blob/27b1807e567b1fab4ecfa14007c1ebee33e34832/src/main/character/character-speech.ts)
- [本地 ASR Worker@27b1807](https://github.com/Liyang0701/Cyrene-Agent/blob/27b1807e567b1fab4ecfa14007c1ebee33e34832/src/main/asr/local-asr-worker-manager.ts)
- [微信账号连接池@27b1807](https://github.com/Liyang0701/Cyrene-Agent/blob/27b1807e567b1fab4ecfa14007c1ebee33e34832/src/main/channels/adapters/wechat/wechat-account-connection-pool.ts)
- [微信结构化身份@27b1807](https://github.com/Liyang0701/Cyrene-Agent/blob/27b1807e567b1fab4ecfa14007c1ebee33e34832/src/main/channels/adapters/wechat/wechat-conversation-identity.ts)
- [本地模型回退@27b1807](https://github.com/Liyang0701/Cyrene-Agent/blob/27b1807e567b1fab4ecfa14007c1ebee33e34832/src/main/channels/channel-model-fallback.ts)

## 12. 实际同步结果

本次没有覆盖私仓或当前开发工作树，而是在独立工作树
`Cyrene-Agent-upstream-sync-20260726` 中，以私仓 `27b1807` 为起点合并主仓
`87f74b1`。共享入口均按语义合并，未使用“整文件选主仓”的方式。

已接入的主仓能力包括：

- CITA 上下文理解、结构化约简、远程语义引擎及其设置。
- Chat / Work 双执行模式、Action Gate、Native Function Calling、Structured Output。
- 工具执行事实、完成语义、重复副作用拦截和样式采样。
- 社交上下文抽取与调度。
- Markdown、代码高亮和流式渲染。
- 音乐 Provider、候选引用校验、结果归一化与 Mossland TTS。
- 新版设置页、状态资源、供应商预设和性能追踪。

私仓已有能力的保护结果：

- CharacterRuntime、角色级状态根和动态角色显示名继续保留。
- 微信多账号连接池、结构化会话身份、按账号/角色隔离继续保留。
- macOS 本地 ASR、RMS VAD、本地 Qwen `softNoThink` 与云端失败回退继续保留。
- GPT-SoVITS 多语种参数、角色 Voice Profile 和微信语音卡片继续保留。
- 主动状态改为写入当前角色的状态目录，避免重新退化成全局
  `userData/proactive-state.json`。
- 社交上下文 Store 会随 Active Character 切换到对应角色的
  `social-context/chat-social-atoms.json`，不会在角色间复用内存缓存或磁盘文件。
- Chat 与状态面板标题头像使用 Active Character 的头像；昔涟专属状态/心情图片
  只在昔涟激活时使用，其他角色显示中性的语义图标。
- 截图代码随主仓进入代码库，但现有 UI 入口和快捷键仍保持关闭，等待 macOS 专项验收。
- 私仓仍在使用的 opener bubble 渲染组件被保留；主仓已移除的旧 desire engine
  不再恢复，主动触发改接新 proactive trigger。

几个具体例子：

1. 用户在 Work 模式要求播放歌曲时，新链路会先形成结构化执行事实；同一
   `toolId + 参数` 已完成后，模型不能因为措辞不确定而再次触发相同副作用。
2. 用户说“播放第一首”时，音乐工具会验证候选引用属于当前会话且未过期，
   不再只依赖自然语言猜测目标。
3. 昔涟与另一角色切换后，主动消息冷却状态分别写入各自角色目录，不会共享一个
   全局 proactive state。
4. Chat 模式只进行角色对话；需要调用工具时切换 Work 模式，工具结果再交给
   Soul 生成最终自然回复。

## 13. 自动验证与待人工验收

已完成的自动验证：

- `npm test`：236 个测试文件、1655 个测试全部通过。
- `npm run build`：skills、main、preload、renderer 全部构建成功。
- 角色架构守卫、历史会话隔离、build options、两阶段工具循环专项测试：
  67 个测试全部通过。
- Code Review 发现并修复了三项合并缺陷：社交上下文全局存储、非活动角色仍显示
  昔涟视觉资源、设置导航重复渲染；新增角色切换存储和导航唯一性回归测试。
- 合并后不存在 Git 冲突标记或未解决冲突。

仍建议在真实凭据、真实模型和真实设备环境中做以下人工验收：

- 两角色往返切换并比较状态目录。
- 两个微信账号同时在线，确认同联系人不串历史和回复出口。
- macOS 本地 ASR 完整状态循环。
- 本地 Qwen 短聊及云端失败回退。
- GPT-SoVITS 日语参考和微信语音卡片。
- 音乐候选引用、跨会话拒绝和真实客户端播放。

依赖安装时 `npm audit` 报告 27 个现有依赖漏洞（13 moderate、11 high、
3 critical）。本次没有执行可能引入破坏性升级的 `npm audit fix --force`；
应另开依赖升级任务逐项验证。
