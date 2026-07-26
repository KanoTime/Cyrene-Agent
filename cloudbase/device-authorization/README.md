# Cyrene Device Authorization CloudBase Function

此目录是长期设备配对控制面的可部署 CloudBase Node 20 函数包。当前只完成本地构建和测试，尚未部署到正式环境。

## 构建

在仓库根目录运行：

```sh
npm run build:cloudbase-device-authorization
```

部署目录为 `cloudbase/device-authorization`，CloudBase 入口为根目录 `entry.main`，它只转发到构建产物 `dist/index.main`。运行时必须配置：

- `CYRENE_CONTROL_PLANE_PUBLIC_ORIGIN`：函数正式 HTTPS Origin，只允许 `https://`。
- `CYRENE_DEPLOYMENT_BOOTSTRAP_CODE_HASH`：高熵、一次性 `cy_db_…` 引导码的 SHA-256 Base64URL 验证值；不得配置引导码明文。

函数使用集合 `cyrene_device_authorization` 的单 Owner 文档 `owner_v1`。上线前还必须完成正常使用观察、生成一次性引导码、配置 HTTPS 路由并执行真实 Android/桌面公网验收。不得删除 CloudBase 环境本身。

当前受限 Beta 已部署到 `cyrene-agent-d2gfztehj201e3df3`：正式 Origin 为 `https://cyrene-agent-d2gfztehj201e3df3-1456695787.ap-shanghai.app.tcloudbase.com`，路由为 `/v1`，函数为 `cyrene_device_authorization_control`。错误引导码公网烟测返回 401；`cyrene_device_authorization` 集合已创建并复核为 `ADMINONLY`，Owner 尚未初始化。

## 部署边界

- 这是入口为 `entry.main` 的 **Event 函数**，由 CloudBase HTTP Access Service 映射 `/v1`；不要使用要求 `scf_bootstrap` 常驻服务器的 HTTP 函数模式。
- CloudBase 网关会从 Event 的 `path` 剥离已匹配的 `/v1`；部署入口必须配置 `gatewayPathPrefix: "/v1"`，只在 CloudBase Adapter 层还原前缀，厂商无关 HTTPS 合约仍使用完整 `/v1/...`。
- 正式函数名固定为 `cyrene_device_authorization_control`。示例配置位于仓库根目录 `cloudbaserc.device-authorization.example.json`，其中两个占位值不得直接部署。
- 部署前先只读查询环境的 HTTP Access Service 域名，以得到唯一 HTTPS Origin；不得猜测域名。
- Deployment Bootstrap Code 必须在本地生成，只把 SHA-256 Base64URL 验证值写入函数环境变量。明文只在首次桌面初始化时输入一次，不得写入仓库、CloudBase 配置、日志或聊天记录。
- `scripts/prepare-cloudbase-device-authorization-deploy.mjs` 生成或复用该引导码，将明文写入 macOS 钥匙串，并只在 `/tmp/cyrene-device-authorization-cloudbaserc.json` 写入验证哈希。脚本输出只含资源名、配置路径和 Origin，不输出明文；首次初始化成功后应删除对应钥匙串项目。
- 初始化成功前，以错误引导码调用应返回 `401`；初始化成功后，重复初始化必须失败。真实手机验收还要覆盖桌面批准、凭据安全保存、重装后重新配对和 Owner Recovery 使用后轮换。
- `DesktopAvailabilityCoordinator` 在桌面启动或首次配对后自动发现本机身份，清醒时每 30 秒续租 45 秒可用性，挂起和退出时停止续租并尽力清除，唤醒后显式恢复；单次 HTTPS 请求 10 秒超时，瞬时失败由下一轮修复且不记录运输层原始错误。该租约只表示桌面可参与 Owner 管理，不等同于 ASR 或媒体已就绪。
- 按 30 天持续在线、每次事务保守按一次数据库读和一次写估算，单桌面约产生 8.64 万次函数调用与 17.28 万次数据库调用；按腾讯云 2026-07-21 刊例价约为函数调用 ¥0.12、数据库调用 ¥3.46，另有少量函数 GBs，预计每月低于 ¥4。正式结论只能使用环境实际资源点增量，并继续执行 ¥20/¥40 告警和 ¥50 成本保护。
- 回滚只允许精确处理上述函数、`/v1` 映射和授权集合，并且需要单独授权；**绝对不得删除 CloudBase 环境** `cyrene-agent-d2gfztehj201e3df3`。
