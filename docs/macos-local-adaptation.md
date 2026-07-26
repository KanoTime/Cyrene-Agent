# macOS 本地模型适配说明

本次交付以 Apple Silicon macOS 上完整运行 Cyrene-Agent 为目标，保留上游云端能力，同时补齐本地模型和微信语音链路。模型权重不进入 Git；应用默认只访问本机路径、stdio Worker 和 `127.0.0.1` 服务。

## 本次适配内容

- 新增 `mlx-community/Qwen3-ASR-1.7B-8bit` 本地 ASR：独立 Python 3.12 虚拟环境、固定依赖、常驻 MLX Worker、离线模型加载、健康检查、超时、取消、崩溃重启与退出清理。
- 通话链路支持 `off / aliyun / local`，VAD 结束后等待最终转写再进入思考，避免 `stop()` 后立即读取文本的竞态和重复结束回合。
- 微信语音复用统一 `transcribePcm()`：Silk 解码后可重采样至 16 kHz，再由本地或阿里云 ASR 处理。
- 设置页的“本地 ASR”从占位项变为可用配置，显示安装/加载状态、模型路径、语言、专有名词提示和测试按钮；首版明确只提供句末最终文本。
- 修复 Apple Silicon 上 BGE-M3 的路径分隔符与安装状态判断；Reranker 使用真实本地 cross-encoder 输出，并补齐 tokenizer 元数据。
- 修复中文 PDF 字体选择和嵌入、微信启用状态生命周期，以及本地模型记忆任务的可配置超时。
- 修正 macOS 将 `/tmp` 解析为 `/private/tmp` 时的测试夹具路径预期。

## 环境结构

推荐目录：

```text
$HOME/Documents/local-llms/
├── qwen3.5-9b/
│   └── model/
└── qwen3-asr-1.7b/
    ├── .venv/
    ├── model/
    ├── worker/
    ├── fixtures/
    └── logs/
```

ASR 环境必须与 Qwen3.5-9B 的环境隔离，避免 `transformers`、`mlx-vlm` 和 `mlx-audio` 互相覆盖。

## 安装本地 ASR

需要 Apple Silicon macOS、Python 3.12 和 Hugging Face 网络访问。安装脚本会创建独立虚拟环境、下载一次模型、复制 Worker 并执行 `pip check`：

```bash
cd "/path/to/Cyrene-Agent"
./scripts/setup-qwen3-asr-macos.sh
```

自定义路径或 Python 可使用：

```bash
CYRENE_QWEN3_ASR_ROOT="$HOME/Models/qwen3-asr-1.7b" \
PYTHON_BIN="/opt/homebrew/bin/python3.12" \
./scripts/setup-qwen3-asr-macos.sh
```

运行时默认开启 Hugging Face 与 Transformers 离线模式，不会重复下载模型。应用与 Worker 通过换行分隔 JSON 的 stdio 通信，不监听网络端口。

## 启动

先在独立终端启动现有 Qwen3.5-9B OpenAI 兼容服务，并确保只绑定本机：

```bash
cd "$HOME/Documents/local-llms/qwen3.5-9b"
.venv/bin/mlx_lm.server \
  --model "$PWD/model" \
  --host 127.0.0.1 \
  --port 8080
```

再启动 Cyrene：

```bash
cd "/path/to/Cyrene-Agent"
CYRENE_MODELS_DIR="$PWD/models" \
CYRENE_MEMORY_LLM_TIMEOUT_MS=180000 \
npm start
```

在设置中将模型地址设为 `http://127.0.0.1:8080/v1`，ASR 引擎选择“本地 Qwen3-ASR”，确认模型根目录后点击测试。

## 可复用与自研边界

- 复用 `mlx-audio` 和 Hugging Face 上的 MLX 量化模型，避免自行维护声学模型和推理内核。
- 复用 Cyrene 原有麦克风、PCM、VAD、通话状态机、微信 Silk 解码和 TTS。
- 自研部分只覆盖 Cyrene 所需的 Worker 生命周期、stdio IPC、统一 ASR 接口、重采样、设置页和错误恢复。
- 没有整套接入其他语音助手，因为那会重复引入会话状态机、音频采集和角色系统，并扩大依赖冲突面。

## 当前限制

- 本地 ASR 第一版采用 VAD 后整句识别，不提供实时 partial 字幕。
- TTS 是否可听取决于另行配置的 GPT-SoVITS、MiniMax、MiMo 或自定义云服务。
- 微信首次登录、macOS 麦克风权限和真实扬声器听感仍需用户在图形界面完成。
- 角色切换尚未完成；当前工作只为后续角色包抽象建立稳定的 macOS 本地运行基线。

## 本次交付验证

- `npm run build`：主进程、preload 与 renderer 生产构建通过。
- `npm test -- --reporter=dot`：118 个测试文件、800 个测试全部通过。
- ASR 独立环境 `pip check`：无依赖冲突。
- 真实 MLX 集成测试覆盖模型预加载、连续识别、取消、超时、异常退出恢复和资源清理。
- 通话、微信 24 kHz Silk 解码与重采样、PDF 中文、Reranker 和 macOS 模型路径均有定向测试。
- Qwen3.5-9B 的 `127.0.0.1:8080` 在构建和完整测试后仍返回 HTTP 200。
