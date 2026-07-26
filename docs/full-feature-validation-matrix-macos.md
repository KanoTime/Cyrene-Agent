# Cyrene-Agent macOS 初始全功能验证矩阵（修复前基线）

> 本文保留最初复现时的证据和当时发现的问题。BGE 路径、Reranker、PDF 中文、微信状态、本地 ASR 等问题已在本次 macOS 适配中处理；当前交付状态与复现方法见 `docs/macos-local-adaptation.md`。

验证日期：2026-07-15（Asia/Shanghai）
上游版本：`1621a4297d127e4596e9cd641bf35547f0cff929e`
平台：macOS / Apple Silicon
主模型：本地 `mlx-community/Qwen3-4B-Instruct-2507-bf16`，OpenAI 兼容地址 `http://127.0.0.1:8080/v1`

## 判定标准

- **通过**：在真实 Electron 进程中完成端到端调用，并检查了 UI 事件、返回值、磁盘结果或协议结果。
- **部分通过**：代码主链路或本地兼容协议已通过，但特定供应商/设备/账号路径没有外部条件。
- **阻塞**：缺少用户凭据、账号登录、模型、游戏或硬件权限；不能伪装成通过。
- **失败**：已实际执行，结果与功能承诺不符。
- **未实现**：界面或源码明确标为占位/即将推出。

## 自动化与启动基线

| 项目 | 结论 | 证据 |
|---|---|---|
| 完整测试集 | 通过 | `112` 个测试文件、`784` 个测试全部通过 |
| macOS 启动 | 通过 | Electron 正常启动；最终以无 DevTools 端口的普通模式运行 |
| 本地 Qwen 连接 | 通过 | 重启后连接测试 `ok`，约 `798 ms` |
| 重启恢复 | 通过 | 模型、会话、权限、主题、桌宠缩放、天气配置均恢复 |
| 网络暴露 | 通过 | Qwen `8080`、渠道入站 `59684` 均仅监听 `127.0.0.1`；调试端口 `9222` 已关闭 |
| 本地模型长耗时记忆 | 通过（已修复） | 记忆判断/压缩超时改为默认 120 秒，可用 `CYRENE_MEMORY_LLM_TIMEOUT_MS` 调整并限制在 30–600 秒 |

## 窗口与界面

| 功能 | 结论 | 证据/说明 |
|---|---|---|
| 桌宠、聊天、侧栏、今日日程 | 通过 | 启动和重启后均创建成功 |
| 设置、通话、表情包管理 | 通过 | 从侧栏/设置真实打开；共验证 7 个窗口 |
| 17 个设置分区 | 通过（渲染） | memory/chat/user/tasks/identity/skills/plugins/preferences/appearance/general/api/cyrene/channels/tts/asr/tokens/disclaimer 均点击并渲染 |
| 主题切换 | 通过 | classic ↔ pearl-white 广播到桌宠并恢复 |
| 自定义字体 | 通过 | 导入系统 Geneva TTF、收到跨窗口事件、重置并删除导入副本 |
| 桌宠显示/缩放 | 通过 | true/false 与 1.0/1.1 事件均到达桌宠，最终恢复 |
| Live2D 运行与动作 | 通过 | 模型窗口有效，动作 IPC 监听为 1，`play_live2d_action` 成功 |
| Token 用量 | 通过 | 1/7/30 天统计返回真实请求、输入、输出数据 |
| 用户资料 | 通过 | 读取、无损保存、再次读取一致 |
| 会话 CRUD/分页/活跃会话 | 通过 | 创建、追加、读取、分页、替换尾部、改名、切换、删除全部成功 |
| 单窗口模式 | 未实现 | UI 标注 `SOON` |
| 聊天背景 | 未实现 | UI 标注 `SOON` |
| “职位”多代理身份 | 未实现 | UI 标注随多代理推出；当前 `identityId` 仅为预留字段 |
| 音乐/提示音高级能力 | 未实现/占位 | 设置文案明确为保留占位；基础音频资源存在 |

## 对话、角色、记忆与知识

| 功能 | 结论 | 证据/说明 |
|---|---|---|
| 流式对话 | 通过 | 本地 Qwen 真实多轮回复，AG-UI 事件完整结束 |
| 工具调用循环 | 通过 | 单轮并行/多轮工具均有 `TOOL_CALL_RESULT` 与最终回复 |
| 昔涟角色提示/Worldbook | 通过 | 46 条世界书加载，DMAE 激活条目真实注入系统上下文 |
| 角色切换 | 未实现 | 当前角色名、资源、世界书、语气、表情、Live2D 等仍是昔涟硬编码/分散绑定；这是后续改造目标，不属于已验证现成功能 |
| L0/L1 结构化记忆写入 | 通过 | 本地模型完成真实写入 |
| 新会话长期记忆召回 | 通过 | 重启/新会话后 `user_memory` 与 `recall_history` 均召回唯一事实 |
| RAG 文档导入 | 通过 | Markdown 摄入、切块、索引，`imported_docs` 命中唯一事实 |
| BGE-M3 向量 | 通过（运行时） | 本地模型 572 MB，1024 维；记忆、7 个场景和 52 个表情索引成功 |
| BGE-M3 设置页安装状态 | 失败 | UI 误报未安装；根因是 `embedding-manager.ts`/`index.ts` 使用 Windows 反斜杠路径 `Xenova\\bge-m3` |
| Reflection | 通过 | 第 20 轮真实触发 |
| Reranker | 阻塞 | light/standard 模型均未安装；项目没有设置页下载器，未安装时自动关闭增强 |
| 视觉图片理解 | 阻塞 | `read_image` 正确返回“未配置视觉模型”；本机仅提供文本 Qwen3-4B |

## 内置工具逐项结果

| 工具 | 结论 | 真实证据 |
|---|---|---|
| `imported_docs` | 通过 | 文档 RAG 命中 |
| `user_memory` | 通过 | 结构化记忆查询 |
| `fetch_url` | 通过 | 抓取 `https://example.com`，正文转 Markdown，最终标题 `Example Domain` |
| `run_shell` | 通过 | `/bin/pwd`，cwd 与 exitCode=0 正确 |
| `install_mcp_server` | 通过 | 工具调用安装 stdio MCP、发现 1 个工具、随后清理 |
| `weather` | 通过 | Open-Meteo 上海实时卡片与文本结果 |
| `web_search` | 阻塞 | 博查/Tavily 需要 Key；缺 Key 路径已返回准确错误；volcano/minimax 选项在源码中仍未接入 |
| `todo_write` | 通过 | 清单写入、持久化、启动恢复 |
| `delegate_task` | 通过 | 子代理计算 `2+3`，工具与最终回复均为 `5` |
| `ask_user_choice` | 通过 | 卡片数据→选择 B→IPC→工具结果→最终 `b` |
| `play_live2d_action` | 通过 | 工具调用与 Live2D IPC 链路成功 |
| `read_file` / `list_dir` | 通过 | 真实文件内容和目录结果 |
| `write_file` | 通过 | 写入 ALPHA，并检查磁盘 |
| `apply_patch` | 通过 | ALPHA 精确替换为 BETA并回读 |
| `read_image` | 阻塞 | 缺视觉模型；配置错误路径已验证 |
| `recall_history` | 通过 | 跨会话召回 |
| `write_markdown` | 通过 | 真实 `.md` 内容正确 |
| `write_excel` | 通过 | 有效 XLSX，shared strings 与表格内容正确 |
| `write_word` | 通过 | 有效 DOCX，XML 中中文标题与正文正确 |
| `write_pdf` | **失败** | PDF 结构有效且可渲染，但 Helvetica 未嵌入中文字形，视觉结果为乱码 |
| `record_expense` / `query_expense` | 通过 | 0.01 元测试记录后查询命中；测试数据已清理 |
| `exchange_rate` | 通过 | Frankfurter 实时 USD→CNY 返回 6.7801（验证时值） |
| `translate` | 通过 | 本地 Qwen 将 `hello world` 翻为“你好，世界” |
| `plan_trip` | 阻塞 | 需要高德 Web 服务 Key；缺 Key 路径已验证 |
| `send_email` | 通过（SMTP 协议） | 本地 SMTP 沙箱真实收到 EML；确认卡片、From/To/Subject/正文均正确。公网邮箱仍需用户 SMTP 凭据 |
| `invoke_skill` | 通过 | 成功加载 `write-expense-report` |
| `read_skill_reference` | 通过 | 成功读取 `column-spec.md`；传 `references/column-spec.md` 会失败，参数文案存在轻微歧义 |
| `game_bot_start` | 阻塞 | 功能默认关闭，未配置游戏路径/VLM，参考图为 0；唯一脚本含 exe/Alt+F4，实质面向 Windows，不具备 macOS 完整运行条件 |
| 动态 MCP 工具 | 通过 | 本地 stdio MCP 动态注册并返回 `MCP_ECHO:CYRENE_MCP_OK`，之后移除 |

## 任务、权限与主动能力

| 功能 | 结论 | 证据/说明 |
|---|---|---|
| 定时任务 | 通过 | 新增、立即运行、历史 `success/SCHEDULER_OK`、编辑、停用、启用、删除完整闭环 |
| 权限档位 | 通过 | per-action 批准与拒绝均验证；拒绝写文件后目标不存在；最终恢复 read-only |
| 主动开口素材包 | 通过（本地协议） | 临时 manifest+WAV 后 `testFire` 显示“主动开口功能验证通过”气泡并播放；测试素材已清理 |
| 主动开口自动策略 | 部分通过 | 策略/评分/服务单测通过；真实长时间 idle/天气/冷却触发未做数小时等待 |

## 语音、多渠道与外部平台

| 功能 | 结论 | 证据/说明 |
|---|---|---|
| GPT-SoVITS TTS | 通过（兼容协议） | 本地 HTTP 沙箱返回 25,828 字节 RIFF/WAV；首次缓存写入、二次缓存命中；Electron Audio 播放到 `ended` |
| MiniMax TTS/克隆 | 阻塞 | 需要 MiniMax API Key、Voice ID/上传文件；单元测试通过但未做供应商真实计费调用 |
| MiMo TTS | 阻塞 | 需要 MiMo API Key 与参考音频；单元测试通过但未做供应商调用 |
| 自定义云 TTS | 部分通过 | 调度/合约单测通过；本地已用 GPT-SoVITS 兼容链路证明渲染播放，未另建第二套自定义云合约实测 |
| 语音通话 | 阻塞 | 窗口正常；启动后真实进入 `ERROR`，明确提示缺阿里云 ASR AppKey/AccessKey |
| 本地 ASR | 未实现 | 设置页明确标为占位 |
| 飞书 | 阻塞 | 未启用、无 App ID/Secret；长连接模式状态接口正常 |
| 微信 | 阻塞 | `ilink/1.0.0` 运行时已安装，但未扫码登录，无真实收发对象 |
| 渠道状态一致性 | 失败 | 配置返回微信 `enabled=false`，状态却返回 `enabled=true/config_missing` |

## 已确认的问题与性能风险

1. PDF 中文导出乱码。
2. macOS 嵌入模型安装状态误报，原因是 Windows 路径分隔符硬编码。
3. 微信渠道配置与运行状态的 `enabled` 值不一致。
4. Qwen3-4B 在包含大量工具描述和多工具后的总结阶段较慢；一次 6 工具批处理达到数分钟，工具执行本身正常。
5. `read_skill_reference` 的描述容易让模型传入 `references/...`，实际只接受清单中的相对文件名。
6. 游戏代肝只有 Windows 风格脚本且缺参考图，不可宣称 macOS 可用。

## 当前结论

核心桌宠、对话、会话、角色提示、记忆、RAG、BGE、工具循环、任务、权限、MCP、文档（除 PDF 中文）、本地兼容 TTS、SMTP、天气和生活工具已在 macOS + 本地 Qwen 上得到端到端证据。

不能宣称“所有功能全部通过”。尚需外部凭据或人工环境的项目是：视觉模型、reranker 模型、博查/Tavily、高德、MiniMax/MiMo、阿里云 ASR、飞书、微信扫码、真实游戏/VLM/参考图。另有 PDF 中文、BGE 状态显示、微信状态一致性三个已复现缺陷，以及若干上游明确未实现的占位功能。
