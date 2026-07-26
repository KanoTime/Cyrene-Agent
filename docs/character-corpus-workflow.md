# Character Corpus 采集与闸门工作流

Character Corpus Gate 在重写生产角色人格前，验证短句证据是否可追溯、已人工复核且达到数量与场景覆盖门槛。它不存储或分发游戏画面、录屏、完整剧情文本或其他受限素材。

## 存储边界

原始截图、录屏、音频及 OCR/ASR 中间产物必须放在 Git 仓库外。本机推荐根目录：

```text
/Users/kano/Documents/二次元/.local/evidence/character-corpus/
└── <character-id>/
    ├── raw/
    ├── derived/
    └── notes/
```

可选设置 `CYRENE_CHARACTER_EVIDENCE_ROOT` 指向该根目录。`corpus.json` 里的 `evidencePath` 只记录相对于该根目录的路径，不提交机器专属绝对路径。仓库内的 `character-corpus-private/` 也被 `.gitignore` 防御性忽略，但不建议将原始素材放进仓库目录。

Git 中只保留：

- 必要的短句证据，不保留完整剧情或大段台词。
- 服务器、语言、章节/场景/时间点、说话者和 Character Form。
- 人工复核状态、六类 Character Evidence Record、A–D 置信等级和来源 SHA-256。
- 不包含受限角色素材的许可安全测试夹具。

## 语料目录格式

每个可验证目录包含：

```text
<corpus-directory>/
├── corpus.json
└── entries.jsonl
```

`corpus.json` 定义角色 ID、门槛、来源目录和已批准的自然稀缺例外。来源类别限于 `in-game-story`、`in-game-relationship`、`in-game-voice`、`official-site`、`official-video` 和 `official-publication`。来源必须有 URL 或 Git 外 `evidencePath`，并记录 `sha256:<64 hex>` 内容哈希。三类 `in-game-*` 来源必须使用不含 `..` 的相对 `evidencePath`，不能仅以网页 URL 代替原始证据。

`entries.jsonl` 每行是一条 JSON 证据。支持的证据类别为：

- `official-fact`
- `official-dialogue`
- `personality-inference`
- `language-feature`
- `assistant-adaptation`
- `user-review`

置信等级为 `A`–`D`。OCR/ASR 提取内容在 `review.status` 变为 `verified` 前不计入门槛。每条 `locator.unitId` 是语言无关的稳定来源单元 ID，应指向同一句或同一可对应单元；`scene` 只供人阅读，可使用各服本地化名称。国服官方中文配对必须共享 `unitId`，恰好包含一条 `server: jp, language: ja` 和一条 `server: cn, language: zh-CN`，且说话者与形态一致。`in-game-*` 记录还必须使用 `kind: in-game-capture`，同时填写 `chapter`、`scene` 和 `timestamp`。

## 哈希与验证

对原始证据文件计算 SHA-256：

```bash
shasum -a 256 "/absolute/path/to/evidence-file"
```

将结果以 `sha256:<digest>` 写入来源目录，并在对应记录里复用同一哈希。Gate 会校验记录与来源目录是否一致；因原始文件不在 Git 中，发布环境不会读取或重新散列用户的受限素材。

验证仓库内许可安全示例：

```bash
npm run corpus:validate -- test-fixtures/corpora/lumen
```

命令在通过时输出 JSON Gate 报告并返回 0；被阻塞时返回 1；未提供目录时返回 2。报告包含日文/官方中文配对数量、来源类别、场景覆盖、已批准例外与所有未完成项。
