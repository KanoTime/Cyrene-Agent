# ADR-0039：将公网控制面迁移到 Cloudflare Workers

- 状态：Accepted
- 日期：2026-07-24
- 决策者：Owner
- 取代：ADR-0027 中把 CloudBase 作为正式托管控制面的部分

## 背景

CloudBase 免费体验环境的月度资源点已经耗尽。结清腾讯云欠费和重新部署函数都不能恢复该免费环境的函数调用，因此“免费环境长期承载正式控制面”的成本假设不成立。

Owner 接受手机在使用异地控制功能时保持 VPN，并于 2026-07-24 选择 Cloudflare 全家桶。中国大陆网络不再要求由 Cloudflare 提供官方境内可用性承诺，但产品必须明确提示 VPN/网络路径依赖，且桌面端也必须能够稳定访问同一控制面。

## 决策

1. 公网 HTTPS 入口使用 Cloudflare Workers。
2. 单 Owner 的设备授权、配对和通话聚合状态保存在一个 SQLite-backed Durable Object 中；不使用最终一致的 KV 保存权威状态，也不额外引入 D1。
3. LiveKit API Secret、部署引导码哈希和媒体信封主密钥使用 Workers Secrets，绝不写入仓库、Wrangler 明文变量、日志或 Durable Object。
4. 现有厂商无关的 HTTP handler、领域状态机、LiveKit token 签发和 AES-256-GCM 媒体信封实现保持不变；只新增 Cloudflare HTTP 与存储适配层。
5. `/healthz` 是无状态健康检查；所有 `/v1/*` 权威请求按固定名称路由到同一个 Durable Object，以保持单 Owner 串行化语义。
6. CloudBase 在 Cloudflare 公网验收完成前不删除；新配对只在切换后使用 Cloudflare Origin，既有 CloudBase 凭据不自动跨存储迁移。

## 网络边界

- 手机挂 VPN 可以满足控制面访问的前提，但不是由 Cloudflare 或 Cyrene 保证的网络能力。
- 桌面端也必须能访问 `workers.dev` 或后续自定义域名；若桌面所在网络不稳定，需要为桌面配置同等可靠的代理/VPN 路径。
- LiveKit 媒体服务不经过 Worker。控制面可达不代表 LiveKit WebSocket、UDP/TURN 媒体路径可达，必须独立做真实通话验收。

## 后果

- 消除 CloudBase 免费资源点和 SCF 账户状态对控制面的依赖。
- Durable Object 的强一致事务和单线程协调与当前单聚合模型直接匹配。
- 新增 Cloudflare 账户、Workers/DO 配额、VPN 可用性和跨境网络作为运行依赖。
- 首次部署会建立新的空状态，Owner 需要在 Cloudflare Origin 上重新执行一次桌面 Owner Bootstrap，并重新配对手机。
