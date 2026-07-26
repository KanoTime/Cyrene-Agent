# 远程语音控制面恢复记录（2026-07-24）

## 本轮目标

在不暴露凭据、不修改手机端和不构建新 APK 的前提下，轮换 LiveKit 服务端凭据与媒体信封主密钥，重新部署 CloudBase 控制面，并验证公网请求能够进入业务 handler。

## 已完成

- 用户已明确授权轮换 LiveKit 服务端凭据、媒体信封主密钥并重新部署控制面。
- 使用 LiveKit 官方 CLI 的浏览器授权流程，为现有 LiveKit Cloud 项目创建了新的 CLI 项目凭据。
- 新 LiveKit 项目地址、API key 和 API secret 已写入 macOS 钥匙串；旧 LiveKit key/secret 已单独备份。
- 已生成新的 32 字节媒体信封主密钥并写入 macOS 钥匙串；旧主密钥已单独备份。
- `scripts/prepare-cloudbase-device-authorization-deploy.mjs` 已改为优先从 macOS 钥匙串读取 LiveKit 配置，旧桌面设置只作为迁移期回退来源。
- 一次性 CloudBase 部署配置权限为 `0600`，并已自动确认使用新 LiveKit 凭据而非旧值。
- CloudBase 函数包已重新构建；相关 3 个测试文件共 11 项通过。
- 正式函数 `cyrene_device_authorization_control` 已于 2026-07-24 10:26（Asia/Shanghai）覆盖部署成功，运行时仍为 `Nodejs20.19`。
- HTTP Access 路由仍启用：`/v1` → `cyrene_device_authorization_control`，类型为 `SCF`，无网关鉴权，目标为 `$LATEST`。

## 当前阻塞与证据

公网 `/v1` 连续三次仍返回：

```text
HTTP 400
FUNCTIONS_INVOCATION_FAILED
```

直接调用 `$LATEST` 得到平台返回：

```text
Function is Unavailable, AvailableStatus = InsufficientBalance.
statusCode = 410
```

同时：

- CloudBase 环境状态为 `Normal`；
- 体验版显示未到期；
- 函数状态为“部署完成”；
- 请求没有进入用户 handler，因此没有 handler 日志；
- 本地 handler 对同一 GET 请求应返回 `405 / METHOD_NOT_ALLOWED`。

因此当前第一失败边界是腾讯云底层 SCF 的计费可用状态，不是 Cyrene 代码、LiveKit 凭据、Node.js 入口或 Android 网络。

## 安全状态

- 首次轮换得到的新 LiveKit 凭据和媒体信封主密钥随后被 CloudBase 控制台的函数详情页直接渲染。该组中间凭据必须视为已暴露，不得作为最终轮换结果保留。
- 已立即退出敏感详情页，并开始第二次紧急轮换；第二次轮换完成并重新部署前，旧 LiveKit 凭据和首次轮换凭据都不得废弃，以免在控制面仍不可用时失去回退与识别能力。
- 新旧凭据值、媒体信封主密钥、Deployment Bootstrap Code 和函数环境变量值均未写入本文或会话交付信息。
- 不得在 SCF 恢复前继续修改手机端、构建 Beta 8 或进行多轮语音复测。

## 结清欠费后的复核

Owner 已确认腾讯云欠费结清且可用余额大于 0。随后多次直接 Invoke 仍返回：

```text
Function is Unavailable, AvailableStatus = InsufficientBalance.
statusCode = 410
```

CloudBase 控制台同时显示：

- 环境为体验版，套餐有效期至 2027-01-22；
- 当前周期使用 834.26 / 3000 资源点；
- 云函数列表中的两个函数均显示“正常”；
- 没有发现手动冻结或“恢复服务”入口。

因此账号账务已经处理，但底层 SCF 的计费可用状态尚未同步恢复。若第二次安全轮换完成后仍长期不恢复，应携带最新 Invoke Request ID 向腾讯云提交工单，而不是继续修改函数代码。

## 第二次紧急轮换结果

- 使用 LiveKit 官方 CLI 再次创建了与原始凭据、首次轮换中间凭据均不同的新项目凭据。
- 首次轮换中间凭据已在 macOS 钥匙串中单独标记并保留，目的仅是后续在 LiveKit Cloud 中准确废弃。
- 已再次生成全新的 32 字节媒体信封主密钥。
- 最终 LiveKit 凭据与最终媒体主密钥已写入 macOS 钥匙串，并于 2026-07-24 10:43（Asia/Shanghai）覆盖部署到正式函数。
- 所有包含最终凭据的 LiveKit CLI 配置、CloudBase 一次性部署配置、部署日志和临时 CLI 文件均已删除。
- 第二次部署后直接 Invoke 仍在 handler 前失败：

```text
Function is Unavailable, AvailableStatus = InsufficientBalance.
statusCode = 410
RequestId = a10e2778-b2ce-4139-88ae-2fba8ad0fcc2
```

因此最终轮换已经完成，但控制面恢复仍被腾讯云 SCF 账户状态阻塞。下一步应提交腾讯云工单，要求刷新或解释已结清账户仍保持 `AvailableStatus = InsufficientBalance` 的原因。

## 腾讯云工单

- Owner 已授权创建腾讯云安灯服务关联角色，并在腾讯云控制台完成工单提交。
- 工单号：`202607249278`。
- 产品分类：云函数；问题分类：`SDK/API/日志/其他问题`。
- 工单包含函数名、CloudBase 环境对应的 SCF 命名空间、最新 Request ID 和结清欠费后的 410 证据；未上传附件、函数环境变量、LiveKit 凭据或媒体信封主密钥。
- 2026-07-24 提交后，腾讯云控制台显示工单状态为“处理中”。
- 腾讯云工程师回复：余额变动到 SCF 后端计费状态可能存在缓存与内部同步延迟，并建议在 SCF 控制台手动恢复服务。
- 已按官方文档进入 SCF 概览并切换至上海地域；服务状态显示“正常”，`更多操作 > 恢复` 为灰色不可用，因此当前没有可执行的手动恢复动作。
- 等待 20 秒后再次直接 Invoke，仍在 handler 前返回 410：

```text
Function is Unavailable, AvailableStatus = InsufficientBalance.
statusCode = 410
RequestId = 5583f876-d4da-4a09-bb44-fb3f071ef98f
```

- 上述控制台状态与新 Request ID 已于 2026-07-24 15:38（Asia/Shanghai）补充到工单，要求腾讯云从后端刷新或核查上海地域、对应命名空间的实际计费可用状态；工单仍为“处理中”。

## 下一步闸门

1. 等待腾讯云工单 `202607249278` 刷新或解释 SCF 的 `InsufficientBalance` / 欠费停服状态；在腾讯云确认恢复前不继续修改函数代码。
2. 恢复后立即重复：
   - 直接函数 GET 事件调用，应返回 `405 / METHOD_NOT_ALLOWED`；
   - 公网 `/v1` 连续三次探测，也应返回 `405 / METHOD_NOT_ALLOWED`，不得再出现 `FUNCTIONS_INVOCATION_FAILED`。
3. 再执行一个不含真实凭据的 POST 未认证探测，应返回明确的认证或业务错误码。
4. 新控制面通过上述验收后，才在 LiveKit Cloud 中废弃旧服务端凭据。
5. 然后补齐桌面端脱敏跨层追踪，再进行一次受控 Beta 6 三轮实机复测。
