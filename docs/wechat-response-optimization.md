# 微信响应速度优化记录

## 范围与约束

- 优化微信文字与本地 ASR 转写语音的端到端响应速度。
- 保留现有 Soul 固定提示，不压缩、不删减人格、设定或表达规则。
- 保留工具权限、完整工具回退和现有媒体处理能力。
- 不处理博查/Tavily、高德、飞书或游戏代肝。

## 诊断基线

同一本地 Qwen3.5-9B 服务的只读基准：

| 请求 | 输入 token | 总耗时 |
|---|---:|---:|
| 裸短句 | 23 | 2.62 秒 |
| Tool 阶段，0 工具 | 529 | 5.91 秒 |
| Tool 阶段，7 工具 | 2,773 | 8.20 秒 |
| Tool 阶段，28 工具 | 9,492 | 22.16 秒 |
| Soul 核心提示 | 5,290 | 12.92 秒 |

旧流程对普通闲聊固定执行 Tool 与 Soul 两次请求，预估模型耗时超过 30 秒。

## 已实施路线

1. OpenAI 兼容适配器同时解析 `prompt_tokens/completion_tokens` 与 MLX-VLM 的 `input_tokens/output_tokens`。
2. Tool 与 Soul 阶段分别记录耗时、输入/输出 token、消息数和工具数。
3. 高置信度短纯聊天走 `soul-only`，跳过 Tool 阶段。
4. 明确工具意图只携带匹配的候选工具；工具目录与 schema 同步过滤。
5. 附件、长文本、空文本、候选工具不可用时走 `full-tool-loop`，保留全部现有能力。
6. 渠道历史去掉 dispatcher 已落盘的本轮重复 user 消息，并只携带最近两个完整往返；更早内容仍保留在 `history-log`，由 `recall_history` 按需召回。
7. 天气这类单次终结查询在首批工具结果后以 `tool_complete` 进入 Soul，不再增加一轮“是否继续调用工具”的模型请求；开放式联网和复杂任务仍保留多轮编排。
8. 微信连接到回环地址上的 Qwen3 时，在模型请求副本中使用原生 `/no_think` 软开关；不写入聊天历史、不修改 Soul 文件，也不影响飞书、远端供应商或其他模型。

## 第一轮真实微信验证与后续定位

用户实测：文字约 32 秒、语音约 33 秒、天气约 55 秒，三者均成功。

阶段日志表明路由已经生效，但短期历史持续增长：

- 文字和语音均为 `soul-only`，Soul 输入约 7,500 tokens，耗时 25–27 秒。
- 本地 ASR 首次模型就绪约 1.2 秒，不是主要瓶颈。
- 天气首轮工具决策约 6.9 秒，第二轮工具结果判断约 12.4 秒，Soul 约 26.8 秒。

因此第二轮优化只收紧动态会话历史并移除天气冗余工具判断，不改动固定 Soul 提示。

第二轮真实微信验证出现文字约 63 秒、语音约 60 秒、天气约 81 秒。日志确认路由和历史预算均生效，但相同约 7,470-token Soul 从此前 25–27 秒恶化到 53–59 秒。直连 0.4.2 的 5,299-token Soul 核心同样复现 23–45 秒波动，证明回归位于长上下文本地推理，不是微信或 ASR。

0.4.2 加 `/no_think` 的相同基准连续四次为 14.6、15.2、16.0、15.2 秒，均正常返回 content；天气也正确返回原生 `weather` tool call。

## 最终真实微信验收

第三轮用户实测全部成功：

| 场景 | 端到端耗时 | 模型阶段证据 |
|---|---:|---|
| 短文字聊天 | 约 25 秒 | Soul 19.1 秒，7,476/45 tokens |
| 本地 ASR 语音 | 约 20 秒 | ASR 0.97 秒；Soul 12.6 秒，7,478/45 tokens |
| 上海天气 | 约 24 秒 | Tool 3.0 秒；Soul 13.7 秒；无第二轮 Tool |

三次均记录 `history=4/16 softNoThink=true`；天气记录 `finishAfterFirstToolBatch=true` 与 `reason=tool_complete`。history-log 中未发现 `/no_think`，控制标记没有污染用户历史。

## 云端 Qwen A/B

切换到 DashScope 后，脱敏设置与运行日志确认实际生效模型为 `qwen-plus`（不是 `qwen3.5-plus`）。用户实测：

| 场景 | 云端端到端耗时 | 云端模型阶段 |
|---|---:|---|
| 短文字聊天 | 约 6 秒 | Soul 1.58 秒，7,729/44 tokens |
| 本地 ASR 语音 | 约 8 秒 | Soul 1.55 秒，7,729/44 tokens |
| 上海天气 | 约 9.5 秒 | Tool 0.89 秒；Soul 1.42 秒 |

云端请求没有启用仅限本地 Qwen3 的 `softNoThink`；天气正确返回原生 `tool_calls`，并继续使用 `tool_complete` 单批终结路径。结论：当前端到端瓶颈已从模型推理转移到 ASR、微信网络与渠道收发固定开销，`qwen-plus` 可作为推荐主模型，本地 0.4.2 保留为手动回退。

## 云端缓存前缀与自动本地回退

- 固定 Soul 原文不删减，作为第一个稳定 system message；时间、环境、渠道、技能、世界知识、关系与附件作为第二个动态 system message。
- DashScope 隐式缓存命中量从 `usage.prompt_tokens_details.cached_tokens` 解析，并在阶段日志记录为 `cached=N`。
- 微信使用云端主模型时，自动从已保存的供应商配置中寻找回环地址上的本地 Qwen3；当前可识别原 `ChatGPT（OpenAI）` 配置中的 `http://127.0.0.1:8080/v1`。
- 云端网络错误、15 秒超时、HTTP 402/403/408/409/425/429 或 5xx 会激活本地回退；HTTP 400/401 不自动回退，避免掩盖请求协议或密钥错误。
- 回退发生在单次模型请求边界。一旦激活，本轮剩余 Tool/Soul 请求保持使用本地模型；已执行工具不会重跑，本地请求副本继续使用 `/no_think`。
- 日志通过 `backend=primary|fallback` 标记实际后端。自动回退不修改用户保存的主模型配置，下一条新消息仍先尝试云端。

真实缓存与人设验收通过。验收时实际主配置为阿里云工作空间 OpenAI 兼容端点、模型 `qwen3-max`：

| 请求 | 端到端 | Soul 阶段 | 缓存 | 后端 | 人设 |
|---|---:|---:|---:|---|---|
| 第一条抱抱 | 约 9 秒 | 3.89 秒 | 0 tokens | primary | 正常 |
| 第二条抱抱 | 约 7 秒 | 2.30 秒 | 7,296 tokens | primary | 正常 |

第二条输入 7,690 tokens，其中约 94.9% 命中 DashScope 上下文缓存。稳定 Soul 前缀验证有效，动态后缀顺序没有破坏人设。运行计划同时正确识别本地 Qwen3 回退配置，未在正常云端请求中误触发。

## MLX-VLM 0.6.4 隔离 POC

独立环境：

`/Users/kano/Documents/local-llms/qwen3.5-9b/.venv-mlx-vlm-0.6.4-poc`

未覆盖现有 0.4.2 环境，未修改 8080 服务。POC 使用 8081，完成后已停止。

启用 APC 的启动命令：

```bash
APC_ENABLED=1 /Users/kano/Documents/local-llms/qwen3.5-9b/.venv-mlx-vlm-0.6.4-poc/bin/python -m mlx_vlm.server \
  --model /Users/kano/Documents/local-llms/qwen3.5-9b/model \
  --host 127.0.0.1 \
  --port 8081 \
  --max-kv-size 32768
```

基准命令：

```bash
node scripts/benchmark-mlx-prefix-cache.mjs \
  --base-url http://127.0.0.1:8081/v1 \
  --model /Users/kano/Documents/local-llms/qwen3.5-9b/model \
  --runs 3
```

结果：冷请求约 25.0 秒；两次热请求约 13.2 秒；每次命中 5,280 cached tokens。缓存统计为 2 次 exact hit、10,560 matched tokens、0 eviction。

后续加压验证显示 APC 命中时可降至约 1.5–3.1 秒，但 0.6.4 会间歇只返回 `reasoning_content` 而没有最终 content；更严重的是原生天气工具测试产生乱码且没有 `tool_calls`。因此明确否决生产迁移，继续使用 0.4.2。

## 验收重点

- “昔涟，你可以抱抱我吗”应记录 `mode=soul-only`，只出现 Soul 阶段模型调用。
- 日志中的 `history` 应不超过 `4/16`，且“原始消息数”不再包含重复的本轮 user。
- 本地 Qwen3 微信请求应记录 `softNoThink=true`；history-log 中不得出现 `/no_think`。
- 天气、联网、文件、记账、翻译、邮件、历史召回和明确 Live2D 动作应记录 `mode=tool-loop`，工具数明显少于完整集合。
- 天气应记录 `finishAfterFirstToolBatch=true`，工具执行后直接出现 `reason=tool_complete`，不应再出现第 2 轮 TOOL_PHASE。
- 附件或无法判断的输入应记录 `mode=full-tool-loop`。
- 文字和 ASR 转写语音使用同一执行计划选择器。
- 任何优化不得改变 Soul 固定提示内容。
