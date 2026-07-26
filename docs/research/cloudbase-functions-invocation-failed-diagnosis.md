# CloudBase 云函数 `FUNCTIONS_INVOCATION_FAILED` / 平台级 410 诊断结论

> 调研日期：2026-07-24
> 范围：只读核对腾讯 CloudBase、腾讯云 SCF 官方文档及腾讯 CloudBase 官方源码文档。
> 已知现场证据：HTTP 网关稳定返回 HTTP 400 / `FUNCTIONS_INVOCATION_FAILED`；直接调用返回 `Function is Unavailable, AvailableStatus = InsufficientBalance`、`statusCode = 410`；CloudBase 环境显示 `NORMAL`、体验版未到期、函数部署完成；对应函数执行日志为空。

## 结论

这次故障已经由直接调用结果收敛到 **底层腾讯云 SCF 因账号欠费而不可用**，不是 Node.js 20.19 不受支持，也不应先归因于 handler、HTTP 事件格式或手机网络。

官方对两个关键字段的定义没有歧义：

- SCF `AvailableStatus = InsufficientBalance` 表示“因欠费导致函数不可用”。函数的部署状态 `Status = Active` 与计费可用状态 `AvailableStatus = Available` 是两套独立状态；因此“部署完成”不能证明函数当前可被调用。[函数和层的状态说明](https://cloud.tencent.com/document/product/583/115197)
- SCF 当前状态码表把 `410 InsufficientBalance` 定义为“账号余额不足”，处理方式是充值后重试。[云函数状态码](https://cloud.tencent.com/document/product/583/42611)

因此，此处的 `410` 是 **SCF 平台执行状态码**，不能按通用 HTTP 语义解释为 “Gone”，也不能把它当作业务 handler 返回的 HTTP 410。直接 Invoke API 的 `Result.InvokeResult` 字段目前已标记为“不再维护，不推荐继续使用”，诊断应优先使用明确的 `ErrMsg`、`AvailableStatus`、云 API 错误码和 Request ID。[SCF Result 数据结构](https://cloud.tencent.com/document/api/583/17244)

HTTP 网关返回的 `FUNCTIONS_INVOCATION_FAILED` 只是上游函数调用失败的泛化包装。CloudBase 官方错误码仅把它定义为“函数执行失败”或“调用云函数超时或失败”，不提供根因粒度；本案中更具体的直接 Invoke 结果 `InsufficientBalance` 应覆盖这个泛化判断。[CloudBase 云函数 HTTP API](https://docs.cloudbase.net/http-api/functions/%E4%BA%91%E5%87%BD%E6%95%B0)、[CloudBase 错误码概述](https://docs.cloudbase.net/error-code/basic)

## 为什么函数日志为空

SCF 官方欠费停服说明明确写明：账号欠费超过 24 小时后，已有函数无法被触发，通过云 API 或 API 网关进行同步调用都会报错且无法执行。[欠费与停服说明](https://cloud.tencent.com/document/product/583/12283)

这与当前“网关报错 + 直接调用 410 + 无函数执行日志”完全一致：请求在平台可用性检查阶段就被拒绝，handler 没有开始执行，自然不会产生业务代码日志。SCF 定价页也区分了“未执行的请求错误”和“已执行的代码错误”；只有后者才实际加载函数代码并计量。[SCF 定价与计量原则](https://buy.cloud.tencent.com/price/scf)

所以当前不能用“日志为空”反推日志系统故障，也不应继续修改业务代码来制造日志。应先恢复 SCF 的计费可用状态，再重新验证。

## 恢复条件与验证闸门

### 官方恢复条件

SCF 官方说明的欠费恢复条件是：**腾讯云账号余额充值为正值后，服务自动恢复**，函数随后可以被正常触发；不是只要 CloudBase 套餐仍在有效期内就一定可调用。[欠费与停服说明](https://cloud.tencent.com/document/product/583/12283)

费用中心对“可用余额”的定义为：

`可用余额 = 账户总金额 - 暂时冻结金额 - 欠费金额`

只有账号创建者或具有财务管理权限的子账号能查看与管理该账户。[云费用账户说明](https://cloud.tencent.com/document/product/555/7424)

因此应由具备财务权限的账号在腾讯云费用中心完成以下人工操作：

1. 查看“可用余额”和“欠费金额”，确认欠费来源。
2. 补缴欠费，并使可用余额明确大于 0。
3. 等待 SCF 自动恢复；若账号已被人为“手动冻结”，还需在 SCF 控制台执行“恢复服务”。官方把“欠费恢复”和“手动恢复”列为两个不同流程。[欠费与停服说明](https://cloud.tencent.com/document/product/583/12283)

### 恢复后的最小验证顺序

恢复后按下面顺序验证，不需要先改代码或路由：

1. **函数详情**：确认部署 `Status` 为 `Active`，计费 `AvailableStatus` 为 `Available`。只有两者同时成立才表示可执行。[函数和层的状态说明](https://cloud.tencent.com/document/product/583/115197)
2. **直接 Invoke**：使用原来的无敏感测试事件再次调用。通过标准是：不再出现 `InsufficientBalance` / 410，并得到 `FunctionRequestId` 与业务层返回。标准 Invoke API 支持 `Qualifier`，未指定时默认 `$LATEST`。[运行函数 API](https://cloud.tencent.com/document/api/583/17243)
3. **按 Request ID 查链路日志**：CloudBase CLI v3 推荐使用 `tcb logs search`，可按 `request_id`、`function_name`、`qualifier`、`src` 和 `retry_num` 检索；旧 `tcb fn log` 已废弃。[CLI 日志检索](https://docs.cloudbase.net/cli-v1/logs/search)、[已废弃的云函数日志命令](https://docs.cloudbase.net/cli-v1/functions/logger)
4. **公网 HTTP 网关**：再访问原公网路径。通过标准是请求进入 handler，未认证请求返回项目预期的认证/业务错误，而不是 `FUNCTIONS_INVOCATION_FAILED`。
5. **若直接 Invoke 成功而公网仍失败**：此时才进入下文的路由、函数类型和事件协议核对。

## CloudBase 套餐与底层 SCF 的边界

CloudBase 的套餐确实包含云函数计算资源。2025-07-30 起，CloudBase 套餐中的计算资源以 CU 统一计量，并按“套餐额度 → 有效资源包 → 按量计费”的顺序抵扣；云函数计算资源属于该通用资源池。[CloudBase 计算资源计量说明](https://cloud.tencent.com/document/product/876/120342)

但是官方同时把函数是否可调用建模为 SCF 的独立 `AvailableStatus`，而 SCF 欠费停服规则针对的是腾讯云账号余额。由此可以得出以下边界：

- CloudBase 环境 `NORMAL`：只能证明环境资源本身未处于创建、销毁或隔离异常状态。
- CloudBase 套餐/体验版未到期：只能证明套餐生命周期和额度仍有效。
- SCF `Status = Active`：只能证明函数部署状态正常。
- SCF `AvailableStatus = InsufficientBalance`：直接证明当前函数因账号欠费不可执行。

“套餐有效但底层 SCF 因账号欠费不可用”并不矛盾。官方没有文档声称有效的 CloudBase 体验版可以绕过腾讯云账号级欠费停服；相反，CloudBase 套餐文档明确存在超额后的按量计费链路，而 SCF 官方又明确要求账号余额为正才恢复。故本案应以 SCF 的明确 `AvailableStatus` 为准。

这一段最后一句属于根据两组官方状态与计费文档作出的交叉推论；如果费用中心显示账号从未欠费、可用余额已经大于 0，但 `AvailableStatus` 长时间仍为 `InsufficientBalance`，应携带腾讯云 API 的 `RequestId`、函数名、地域、命名空间和发生时间提交腾讯云工单，而不是继续改 Cyrene 代码。

## 欠费恢复后仍失败时的官方诊断路径

以下各项现在都是次级检查，不应阻塞“先把账号余额冲正”。

### 1. HTTP 网关路由与函数类型必须匹配

HTTP 网关路由的上游类型明确区分：

- `SCF`：普通/事件云函数。
- `WEB_SCF`：HTTP/Web 云函数。

路由还应核对 `Path`、`UpstreamResourceName`、`Enable`、`EnableAuth`、`EnablePathTransmission` 与路径重写。[CloudBase HTTPServiceRoute 数据结构](https://cloud.tencent.com/document/product/876/34822)、[CloudBase CLI 路由管理](https://docs.cloudbase.net/cli-v1/routes)

腾讯 CloudBase 官方 MCP 源码文档进一步明确：为已有函数创建访问入口时，必须让 `type` 与目标函数类型一致；省略时默认按 Event 处理，HTTP 函数可能因此返回 `FUNCTION_PARAM_INVALID`。[CloudBase-MCP 官方工具文档](https://github.com/TencentCloudBase/CloudBase-MCP/blob/main/doc/mcp-tools.md)

路由配置本身没有 `Qualifier` 字段，只有上游资源名；因此不能假设 HTTP 路由固定到了刚部署的 `$LATEST`。CloudBase 函数始终有 `$LATEST`，已发布版本是不可变快照，灰度配置可把流量分配到不同版本。[CloudBase 灰度发布](https://docs.cloudbase.net/cloud-function/gray-release)、[CLI 版本管理](https://docs.cloudbase.net/cli-v1/functions/management)

只读核对时应同时查看：

- 路由实际指向的函数名与上游类型。
- 函数自身类型（Event 或 HTTP）。
- `$LATEST` 与已发布版本列表。
- 灰度/别名流量是否仍指向旧版本。

### 2. Node.js 20.19 是受支持的运行时

CloudBase 官方运行时表同时列出普通云函数与 HTTP 云函数对 Node.js 20.19 的支持，CLI 也把 `Nodejs20.19` 列为默认/推荐运行时。[运行环境支持](https://docs.cloudbase.net/cloud-function/runtime-support)、[CLI 函数配置](https://docs.cloudbase.net/cli-v1/functions/configs)

因此，看到 `Nodejs20.19` 本身不是本次 410 的解释。只有在恢复计费可用性后出现容器启动、入口加载或代码异常，才继续检查入口格式。

### 3. 普通函数与 HTTP 函数的入口模型不同

普通 Node.js 云函数：

- 默认 handler 是 `index.main`。
- 入口文件必须位于代码包根目录。
- `index.js` 以 CommonJS 方式导出 `exports.main`。
- 部署接口成功返回不等于部署最终成功；handler 与代码包不匹配可能导致部署失败。

来源：[Manager Node 云函数接口](https://docs.cloudbase.net/api-reference/manager/node/function)、[编写普通云函数](https://docs.cloudbase.net/cloud-function/how-coding)

HTTP/Web 云函数：

- 需要根目录下的可执行 `scf_bootstrap`。
- Web Server 必须监听 `0.0.0.0:9000`。
- 启动命令必须使用对应运行时的绝对路径；Node.js 20.19 的路径为 `/var/lang/node20/bin/node`。

来源：[启动文件说明](https://docs.cloudbase.net/cloud-function/develop/scf-bootstrap)、[运行环境支持](https://docs.cloudbase.net/cloud-function/runtime-support)

### 4. HTTP 网关事件与直接 Invoke 原始事件不是同一种输入

普通 Event 函数通过 HTTP 网关访问时，handler 的 `event` 是网关信封，包含：

- `path`
- `httpMethod`
- `headers`
- `queryStringParameters`
- `body`（字符串）
- `isBase64Encoded`
- `requestContext`

来源：[通过 HTTP 访问云函数](https://docs.cloudbase.net/service/access-cloud-function)

而 `tcb fn invoke --params` 或 SCF Invoke API 会把提供的 JSON 直接作为 `event`；`Qualifier` 默认 `$LATEST`。[CLI 云函数管理](https://docs.cloudbase.net/cli-v1/functions/management)、[运行函数 API](https://cloud.tencent.com/document/api/583/17243)

所以直接 Invoke 在恢复后若要复现公网路径，测试参数应显式构造同样的 HTTP 信封。反过来，直接传业务 JSON 成功只能证明 handler 的某条输入路径可执行，不能单独证明 HTTP 网关协议适配正确。

### 5. 日志要分“服务调用日志”和“函数执行日志”

CloudBase 官方说明，通过 HTTP 访问服务调用资源时会自动产生服务调用日志，包含 `traceId`、`spanId`、`service`、`event`、调用来源和 `httpPath`；这类日志可用于判断请求是否到达网关以及上游调用失败在哪一层。[服务调用日志](https://docs.cloudbase.net/logger/tracelog)

函数执行日志则应按 `function_name`、`request_id`、`qualifier`、`src:system/app`、`retry_num=0` 检索。查询为空前应确认：

- 日志服务已开通。
- 环境 ID、地域、时间范围正确。
- 检索了实际流量命中的 qualifier，而不只查 `$LATEST`。
- 先用 HTTP 响应的 `X-Request-Id` 或直接 Invoke 的 Request ID 查服务调用链，再关联函数 Request ID。

CloudBase HTTP 函数 API 在成功和失败响应中都定义了 `X-Request-Id`，这是提交工单与跨层关联的首选证据。[调用云函数 HTTP API](https://docs.cloudbase.net/http-api/functions/functions-post)

## 可复用官方能力

- 费用中心：确认账号可用余额、欠费金额与账单明细。
- SCF `Status` / `AvailableStatus`：分别判断部署状态和计费可用状态。
- CloudBase HTTP 网关路由查询：核对路径、上游类型、上游函数名与启用状态。
- CloudBase CLI v3 `tcb logs search`：统一检索网关服务调用日志和函数执行日志。
- SCF/CloudBase Request ID 与 `X-Request-Id`：跨网关、函数和腾讯云工单关联单次请求。
- CloudBase 版本/灰度管理：核对 `$LATEST`、已发布版本和实际流量。

## Cyrene 仍需自研或验证的部分

- 在控制面 handler 最前端输出脱敏追踪字段：Cyrene 自己的 trace ID、请求路径、方法、实际版本、认证阶段和结果分类；不得记录凭据、令牌或完整请求体。
- 为公网探测建立明确不变量：未认证请求应进入 handler 并返回项目定义的认证错误；平台 `FUNCTIONS_INVOCATION_FAILED`、SCF 410 或完全没有 handler 追踪都判定为基础设施失败。
- 在部署后自动验证三层：SCF `AvailableStatus` → 直接 Invoke → HTTP 网关；任一层失败就停止移动端联调。
- 对直接 Invoke 测试构造真实 HTTP 网关信封，避免用不同事件形状得出错误结论。

## 为什么不整套替换 CloudBase

当前根因是账号级 SCF 欠费停服，不是 CloudBase 架构能力缺失。HTTP 网关、函数版本、日志检索、Request ID 和套餐计量都有官方现成能力，迁移平台既不能免除账号/计费治理，也会引入新的部署、鉴权、日志、域名和运维风险。

合理做法是复用 CloudBase 的托管路由、运行时和日志能力，只补 Cyrene 所需的脱敏跨层追踪、部署后健康闸门和告警。只有在账号冲正且官方确认 SCF 状态恢复后仍持续出现平台不可用，并且工单无法解决时，才有证据评估替换执行平台。

## 当前行动结论

1. 现在不应修改 handler、Node.js 版本、HTTP 事件解析或移动端。
2. 由具备财务权限的账号把腾讯云账户欠费结清，并使可用余额大于 0。
3. 等待 SCF `AvailableStatus` 从 `InsufficientBalance` 变为 `Available`。
4. 按“直接 Invoke → Request ID 日志 → HTTP 网关”的顺序验证。
5. 若余额已为正但状态不恢复，携带 Request ID 与函数状态信息提交腾讯云工单。
