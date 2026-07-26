# 微信多连接账号能力增量

## ADDED Requirements

### Requirement: 多个微信连接账号

Cyrene SHALL 以 `ilinkBotId` 为稳定身份保存并同时运行多个微信连接账号。

#### Scenario: 两个账号同时在线

- GIVEN 两个已启用且凭据有效的微信连接账号
- WHEN 应用启动
- THEN 两个账号分别建立自己的 iLink 长轮询
- AND 任一账号连接失败不停止另一个账号

#### Scenario: 重复扫码同一账号

- GIVEN 某个 `ilinkBotId` 已存在
- WHEN 再次扫码得到相同 `ilinkBotId`
- THEN 系统更新该账号凭据并恢复连接
- AND 不创建重复账号

### Requirement: 仅扫码绑定者可用

每个微信连接账号 SHALL 只处理扫码返回的 `ilinkUserId` 本人发送的消息。

#### Scenario: 非绑定者发消息

- GIVEN 消息发送者不是该账号的绑定者
- WHEN iLink 收到消息
- THEN 消息在媒体下载、ASR、LLM、工具、历史和记忆之前被丢弃
- AND 系统不自动回复
- AND 日志不保存消息正文或完整联系人 ID

### Requirement: 微信对话身份隔离

Cyrene SHALL 使用连接账号和联系人组成的结构化微信对话身份隔离所有用户状态。

#### Scenario: 同一联系人地址出现在两个 Bot 账号

- GIVEN 两个连接账号都存在与同一联系人 ID 的上下文
- WHEN 两边分别发来消息
- THEN 历史、记忆、关系、权限、任务、TTS 缓存和回复路由互不共享

### Requirement: 明确的出站账号路由

所有非直接入站回复的微信出站消息 SHALL 明确指定连接账号和目标绑定者。

#### Scenario: 主动消息没有账号

- GIVEN 配置了多个微信连接账号
- WHEN 主动消息只提供联系人而没有连接账号
- THEN 系统拒绝发送并报告账号缺失
- AND 不选择默认账号

#### Scenario: 入站回复

- GIVEN 一条来自账号 A 的合法入站消息
- WHEN Cyrene 发送回复
- THEN 回复使用账号 A 的 client 和对应 context token

### Requirement: 独立连接生命周期

每个微信连接账号 SHALL 独立启用、停用、重连、重新扫码、退出和删除。

#### Scenario: 单账号凭据失效

- GIVEN 账号 A 和账号 B 同时在线
- WHEN 账号 A 返回明确的凭据失效
- THEN 账号 A 停止自动重试并标记需要扫码
- AND 账号 B 继续正常收发

#### Scenario: 应用重启

- GIVEN 多个已启用且凭据有效的账号
- WHEN 应用重新启动
- THEN 所有账号自动恢复连接
- AND 重连使用带抖动的退避与并发节流

### Requirement: 公平且有界的消息执行

微信消息 SHALL 在同一对话内顺序执行，并在不同账号之间有限并发、公平排队。

#### Scenario: 两个账号并发消息

- GIVEN 两个账号同时有待处理消息
- WHEN 全局 LLM 并发上限为 2
- THEN 两个账号均可获得执行机会
- AND 任一账号不能通过连续消息长期阻塞另一个账号

#### Scenario: 同一对话连续消息

- GIVEN 某对话正在生成回复
- WHEN 同一对话又收到消息
- THEN 新消息排队
- AND 不取消或合并当前回复

### Requirement: 全局活动角色协调

所有微信账号 SHALL 使用应用全局唯一的活动角色。

#### Scenario: 角色切换期间收到消息

- GIVEN 角色切换事务正在进行
- WHEN 微信账号收到新消息
- THEN 连接保持在线且消息被暂存
- AND 已开始回复由旧角色完成
- AND 未开始消息在切换成功后由新角色处理

### Requirement: 渠道资料、权限和任务隔离

微信绑定者 SHALL 使用独立渠道用户资料、账号权限策略和渠道用户任务，不继承本机用户或其他账号的数据。

#### Scenario: 高风险工具

- GIVEN 微信账号没有显式高风险权限
- WHEN绑定者请求读取本机文件、执行 Shell 或发送邮件
- THEN 工具调用被账号级权限策略拒绝
- AND 不使用桌面端权限作为回退

#### Scenario: 离线任务到期

- GIVEN 某微信任务到期时原账号离线
- WHEN 账号之后恢复在线
- THEN 结果通过原账号向原绑定者补发一次
- AND 不转移到其他账号

### Requirement: 安全凭据存储

每个微信账号的敏感凭据 SHALL 使用设备绑定加密独立保存，并排除在导出和日志之外。

#### Scenario: 单账号凭据损坏

- GIVEN 一个账号的凭据文件无法解密
- WHEN 应用加载账号列表
- THEN 仅该账号标记为凭据损坏或需要扫码
- AND 其他账号继续加载和连接

### Requirement: 旧版单账号迁移

系统 SHALL 在不要求重新扫码的前提下迁移旧版单账号凭据和可归属历史。

#### Scenario: 迁移成功

- GIVEN 存在合法旧版 `credentials.json`
- WHEN 新版首次启动
- THEN 创建并启用对应 `ilinkBotId` 的第一个账号
- AND 校验新加密结构后归档旧文件
- AND 不再双写旧结构

#### Scenario: 迁移失败

- GIVEN 旧凭据可读但新结构写入或校验失败
- WHEN 应用启动
- THEN 保留旧文件并进入单账号兼容模式
- AND 微信不会因迁移失败整体不可用

### Requirement: 多账号设置体验

设置页 SHALL 展示账号汇总、逐账号状态和安全的逐账号操作。

#### Scenario: 查看账号列表

- GIVEN 配置了多个账号
- WHEN 用户打开微信设置
- THEN 每个账号显示备注、脱敏 ID、状态、最近连接时间和错误摘要
- AND 页面提供添加、备注、启停、重连、重新扫码、退出和删除
- AND 不提供联系人审批、开放模式或一键全部退出

## MODIFIED Requirements

### Requirement: 渠道消息身份

微信 `IncomingMessage` 和 `OutgoingMessage` SHALL 携带可追踪的连接账号身份；现有仅使用 `senderId` 或 `targetId` 的会话派生和路由不得用于多账号场景。

#### Scenario: 派生微信会话

- GIVEN 两条消息的联系人 ID 相同但连接账号不同
- WHEN 系统派生 session key 和出站路由
- THEN 两条消息得到不同且稳定的会话身份
- AND 出站消息保留各自连接账号

### Requirement: 微信状态

微信渠道状态 SHALL 同时提供聚合状态和逐账号状态，而不是只表示单个 adapter 是否在线。

#### Scenario: 部分账号异常

- GIVEN 三个账号中两个在线、一个需要重新扫码
- WHEN 设置页读取微信状态
- THEN 聚合状态显示两个在线和一个需要重新登录
- AND 每个账号保留自己的状态、时间和错误摘要
