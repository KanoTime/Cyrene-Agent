# CloudBase 之外的控制面替代方案

> 调研日期：2026-07-24
>
> 范围：Cyrene 的设备配对、凭据轮换、呼叫状态、LiveKit 短期令牌与媒体信封分发；不承载媒体流。

## 结论

**推荐迁移到中国内地轻量应用服务器上的单实例 Node 服务，使用 SQLite 持久化、Caddy 终止 HTTPS，并以 Docker 部署。**

这不是把整个系统推倒重写。现有领域处理器、LiveKit 授权服务、媒体信封逻辑和客户端协议都可保留；CloudBase 只位于 HTTP 入口和 `DeviceAuthorizationAggregateStore` 的适配层。需要新增的主要是：

1. 标准 Node HTTP 运行时适配器；
2. SQLite 事务存储适配器；
3. Docker/Caddy、备份、健康检查和密钥注入。

腾讯云轻量应用服务器支持容器镜像、地域选择、宿主机目录挂载持久化和容器自动重启。当前官方中国内地通用型 2 核 2 GB、60 GB SSD、4 Mbps、300 GB/月套餐标价为 52 元/月，超过项目原先 50 元软目标 2 元，但成本固定、不会因函数资源点耗尽而突然停服。[购买与地域](https://cloud.tencent.com/document/product/1207/44580) [Docker 持久化与重启](https://cloud.tencent.com/document/product/1207/60329/) [中国内地套餐价格](https://cloud.tencent.com/document/product/1207/119345)

Caddy 可以自动申请和续期公开域名证书，并自动将 HTTP 重定向到 HTTPS，适合把证书运维压到最低。[Caddy Automatic HTTPS](https://caddyserver.com/docs/automatic-https)

## 候选比较

| 方案 | 大陆可靠性 | 状态模型适配 | 成本/停服风险 | 迁移量 | 结论 |
|---|---|---:|---:|---:|---|
| 国内轻量服务器 + Node + SQLite + Caddy | 高；选择上海等内地区域 | 很高；单 Owner 聚合可用单库事务 | 固定月费，不受免费资源点影响 | 低 | **首选** |
| 阿里云函数计算 + 数据库 | 国内正式服务 | 高 | 仍需理解函数及数据库双重计量 | 中 | 国内 Serverless 备选 |
| Cloudflare Workers + Durable Objects | 全球网络好；大陆无低价正式承诺 | 很高；DO 是强一致、事务性、单线程状态单元 | Workers Paid 最低 5 美元/月 | 中 | 仅在大陆不是硬门槛时选 |
| Supabase Edge Functions + Postgres | 无中国大陆区域承诺 | 高 | Free 仍有配额/暂停类平台依赖 | 中 | 海外优先、开发速度优先时选 |
| Railway / Fly.io / Render | 无大陆区域承诺 | 高 | 套餐规则及休眠风险因平台而异 | 最低 | 不作为大陆关键控制面 |

Cloudflare Durable Objects 在架构上与当前“单聚合、事务修改”的存储接口非常匹配：它提供事务性、强一致的私有存储和单线程协调。但 Cloudflare 官方说明，中国境内网络是 Enterprise 的单独订阅且要求 ICP；因此不能把全球免费/付费 Workers 偶尔可达等同于大陆生产保障。[Durable Objects](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/) [Workers 定价](https://developers.cloudflare.com/workers/platform/pricing/) [Cloudflare China Network](https://developers.cloudflare.com/china-network/)

Supabase 的 Edge Functions 提供 TypeScript/Deno 运行时、Secret 和 Postgres 接入，迁移速度快；但它会把运行时和数据层一起迁入境外平台，并没有解决本项目最关键的大陆网络确定性问题。[Edge Functions](https://supabase.com/docs/guides/functions) [函数限制](https://supabase.com/docs/guides/functions/limits) [定价](https://supabase.com/pricing)

## 可复用、自研与不整套接入

- **直接复用：** `createDeviceAuthorizationHttpHandler`、设备授权领域状态机、LiveKit token 签发、媒体信封、请求/响应协议和现有测试。
- **新增自研：** 标准 HTTP 适配器、SQLite store、数据库迁移/备份、容器健康检查、部署脚本。
- **不直接整套接入 Supabase/Cloudflare：** 它们能减少部分基础设施代码，却会引入境外网络不确定性、运行时改造或新的免费额度故障域。Cyrene 的凭据族、即时撤销、单通话互斥和媒体密钥分发仍然必须由项目自身实现。
- **不优先用另一家国内 Serverless：** 可以规避 CloudBase 产品绑定，但没有消除配额、计量、冻结状态与多产品联动的运维复杂度；它适合作为不愿维护服务器时的第二选择。

## 迁移路径

1. 在本地新增 Node HTTP 与 SQLite store，复用现有合同测试，证明与 CloudBase 行为一致。
2. 部署一个内地轻量实例，使用 Docker volume 保存 SQLite，并把 LiveKit 凭据和媒体主密钥作为仅服务可读的运行时 Secret 注入。
3. 配置 Caddy、健康检查、每日加密备份和恢复演练；先用临时 Origin 做桌面/手机双端验证。
4. 通过后切换客户端控制面 Origin，保留 CloudBase 短期只读回退窗口，确认无旧流量后再退役。

## 仍需确认的外部条件

- 若使用中国内地实例和公开域名提供互联网信息服务，需要按腾讯云指引确认备案要求；正式切换前必须有可用域名与证书路径。
- 单实例方案目标是成本稳定和个人规模可靠性，不是跨可用区高可用。若以后要求 SLA，再把 SQLite store 替换为托管 PostgreSQL，并部署双实例。
