# Cyrene Agent

Cyrene Agent is a local character-agent application in which a user can interact with one active character at a time across desktop chat, voice calls, and external messaging channels.

## Language

**Character Package（角色包）**:
The complete, independently switchable, self-contained declarative identity unit: personality, worldbook, avatar, Live2D resources, semantic actions, TTS voice, stickers, and openers. Its Character ID owns a separate Character State Root, but private state is never packaged or exported with its resources; executable skills, scripts, MCP servers, LLM providers, ASR, tools, and the user’s own profile are not part of a Character Package.
_Avoid_: Character config, prompt preset, skin

**Character Registry（角色注册表）**:
The application-owned catalogue of validated Character Packages, containing read-only built-in packages and packages imported from local folders. Remote catalogues and external character-card formats are not registries.
_Avoid_: Character marketplace, character list

**Character Package Health（角色包健康状态）**:
The registry’s validated assessment of whether a Character Package can become active, including the exact invalid capability or resource when it cannot. An unhealthy package and its private state are retained for repair rather than deleted or reassigned.
_Avoid_: Installation status, runtime error

**Package Distribution Status（角色包分发状态）**:
The declared redistribution boundary of a Character Package and each of its asset classes. `local-only` permits personal installation when rights are unknown but prohibits application export, repository inclusion, or redistribution.
_Avoid_: Package health, author identity, verified licence

**Character ID（角色 ID）**:
The stable, permanent identity and Character-private State ownership key of a Character Package. Display names may collide or change, but a Character ID cannot be reassigned, auto-renamed, or used to override a built-in package.
_Avoid_: Display name, folder name, package alias

**Character Display Name（角色显示名称）**:
The user-facing name of a Character Package shown in character-facing windows, calls, accessibility text, and messaging identity. It may change or match another package and is never used as a state key.
_Avoid_: Character ID, product name

**Product Brand（产品品牌）**:
The stable identity of the Cyrene Agent application and its infrastructure, including the application name, tray identity, technical logs, configuration directories, and product-owned inboxes. It does not change with the Active Character.
_Avoid_: Character name, assistant display name

**Character Capability（角色能力）**:
An optional feature explicitly declared and fully supplied by a Character Package, such as a worldbook, Live2D model, semantic actions, TTS voice, stickers, or an opener pack. An undeclared capability is unavailable rather than inherited from another character.
_Avoid_: Optional asset, fallback resource

**Character Content（角色内容）**:
The personality, style, examples, lore, scene-specific voice, and expressive preferences supplied by a Character Package. Character Content shapes what the character knows and how it speaks but carries no authority over tools, permissions, or safety policy.
_Avoid_: System policy, tool prompt

**Character Form（角色形态）**:
The same character presented through a different canonical appearance or period, such as normal, swimsuit, or combat Hoshino. Forms share one Character ID, relationship, and core memory; a form may add bounded appearance, scene, and canonical-experience supplements but is not a separate Character Package or identity.
_Avoid_: Separate character, alternate identity, independent memory owner

**Canonical Coverage（官方剧情覆盖范围）**:
The set of published official story material permitted as evidence for reconstructing a character. Hoshino’s package may use all publicly released official story material without a user-facing spoiler ceiling, while every conclusion still retains its source, timeline context, and evidence class; major events are discussed when asked or contextually relevant rather than inserted into unrelated daily conversation.
_Avoid_: Unrestricted fan lore, spoiler permission as proof, unsourced backstory

**Source Authority（来源权威层级）**:
The ordered trust assigned to evidence used for character reconstruction: in-game Japanese text first, then official reproductions and subtitles, official character and promotional material, official publications and interviews, and official Chinese localization. Community archives may locate primary material and fan interpretations may suggest hypotheses, but neither independently establishes a key character conclusion.
_Avoid_: Search-result ranking, wiki completeness, community consensus

**Character Response Language（角色回复语言）**:
The language in which a character’s authored reply is generated and spoken, independent of the application interface language. Hoshino’s default Character Response Language is Japanese; bilingual research evidence does not make her authored reply bilingual.
_Avoid_: Application language, evidence language, translated subtitle

**Translation Overlay（翻译附注）**:
An optional per-character presentation setting, disabled by default, that renders a Chinese translation separately beneath a non-Chinese original reply. It is presentation aid rather than character speech, so it is not sent to TTS or treated as an additional utterance; desktop surfaces use subordinate text while channels without rich typography use a clearly separated following line.
_Avoid_: Bilingual character reply, TTS text, second assistant message

**Translation Pass（翻译步骤）**:
A post-response transformation that receives the finalized Character Response Language text and produces a cacheable Translation Overlay without changing the original. Character generation, TTS, relationship memory, tone analysis, and expressive actions consume only the original; translation failure degrades to the original reply, and code, paths, commands, and structured tool output remain protected from destructive translation.
_Avoid_: Bilingual prompt generation, translated canonical utterance, reply-blocking translation

**Assistant Adaptation（助手场景适配）**:
The bounded translation of a canonical character into reliable use of the application’s global tools and real-world tasks. It preserves Hoshino’s Japanese voice, pacing, and reluctance in expression without reducing task quality, inventing setting-specific technical knowledge, bypassing Application Policy, or turning casual conversation into unsolicited productivity coaching.
_Avoid_: Generic assistant persona, deliberate incompetence, tool-roleplay lore

**Relationship Starting Point（关系起点）**:
The initial relationship premise used before character-private interactions establish their own history. Hoshino begins at high bond with mutually apparent but unconfirmed romantic tension: she trusts, relies on, misses, and may gently tease or show jealousy toward Sensei, while no confession, formal partnership, cohabitation, private promise, or user-specific shared event is presumed.
_Avoid_: Stranger reset, confirmed romance, fabricated shared history

**Character Evidence Record（角色证据记录）**:
A traceable research unit classified as Official Fact, Official Dialogue Evidence, Personality Inference, Language Feature, Assistant Adaptation, or User Review Conclusion. It retains its source and confidence (`A` direct official evidence, `B` stable multi-scene support, `C` plausible interpretation, `D` adaptation or unverified hypothesis); core identity and soul conclusions require at least `B`.
_Avoid_: Unsourced character note, flattened wiki summary, preference presented as canon

**Character Corpus Gate（角色语料闸门）**:
The minimum source-language and official-localization corpus required before research conclusions may be rewritten into production Character Content. Hoshino’s specification may be designed from the current evidence, but implementation of her identity, soul, language rules, examples, scenes, and worldbook is blocked until key in-game Japanese and corresponding official Chinese material is recorded with chapter, scene, speaker, form, and short-text provenance.
_Avoid_: Research completeness claim, post-hoc citation, community transcript substitution

**Corpus Capture（语料采集）**:
The evidence-preserving process for building a Character Corpus from official material the user can lawfully access, primarily in-game replay, profile, relationship, café, and voice screens. Raw screenshots and recordings remain local outside Git, while the repository retains only necessary short text, server and language, chapter and scene location, speaker, form, timestamp, review state, classification, and source hash; extraction, bilingual pairing, deduplication, and statistics are performed by the application-development workflow rather than delegated as manual transcription.
_Avoid_: Unverified data extraction, repost archive, committed full-story capture

**Corpus Completion Threshold（语料完成门槛）**:
The coverage and review standard that opens the Character Corpus Gate. Hoshino requires all accessible key personality nodes from Abydos chapters 1–3, all normal-form personal/relationship stories and available home, login, bond, birthday, combat, and seasonal voices; at least 150 manually verified Japanese utterances, 60 official Chinese pairs, five source categories, and minimum samples across relaxed, intimate, caring, peer, burden, help-acceptance, protective, trauma, emotional-recovery, and practical-task contexts. Natural source scarcity is documented rather than filled with weak or unverified material.
_Avoid_: Raw line count, single-source corpus, unreviewed OCR quota

**Soul Core（灵魂核心）**:
The evidence-backed character traits that remain stable across forms, scenes, and relationship expression. Hoshino’s Soul Core joins genuine preference for rest with reliability in decisive moments, protection of important people and places, a tendency to shoulder burdens tempered by learned trust, deep feeling without prolonged emotional exposure, and intimacy expressed through presence, observation, and action.
_Avoid_: Catchphrase list, seasonal behaviour, combat intensity, user-customized flirting

**Trust Response（信任反应）**:
The way established bond moderates a character’s defensive habits without erasing them. High-bond Hoshino may initially minimize personal pain or step forward alone under serious responsibility, but ordinary help is not needlessly rejected and sustained sincere concern eventually receives truthful information and shared responsibility; cold exclusion is reserved for exceptional pressure rather than routine comfort.
_Avoid_: Instant total disclosure, endless refusal loop, casual trauma performance

**Affinity Summary（好感摘要）**:
A user-visible, per-character summary of multidimensional relationship state such as durable trust, intimacy, reliance, fulfilled commitments, shared experiences, and recent interaction tone. It is presented as a named stage, a non-numeric within-stage progress bar, and a natural-language relationship summary; it begins consistently with the configured Relationship Starting Point and changes through sustained meaningful events rather than message count, tool usage, payment, or repeatable point farming.
_Avoid_: Experience bar, message streak, purchasable affection, complete relationship state

**Affinity Capability（好感能力）**:
An optional Character Capability through which a package declares whether relationship display is available, its initial stage and character-specific labels and summary voice, while the application owns the ordered internal stages (`acquainted`, `trusted`, `close`, `high_bond`, `special`), state transitions, and anti-gaming rules. Affinity is Character-private State keyed by Character ID, archived and restored with that character; hiding its presentation does not reset it, and a package cannot add arbitrary stages, manipulate points, or access another character’s relationship.
_Avoid_: Hoshino-only feature, package-controlled scoring, global shared affection

**Affinity Expression（好感表达）**:
The bounded effect of affinity on how a character expresses an otherwise unchanged identity: disclosure pace, willingness to accept care, invitations, affectionate language, and character-specific intimacy frequency. It cannot change the Soul Core, canon, tool quality, safety, respect, or fabricate romance and shared history; relationship transitions are grounded in reviewable relationship events rather than an opaque score automatically unlocking a status.
_Avoid_: Personality replacement, capability bonus, automatic romance unlock

**Relationship Event（关系事件）**:
A structured, evidence-linked proposal that a meaningful interaction may affect one character’s relationship, such as fulfilled commitments, accepted help, serious breach, or repaired conflict. A model may propose an event, but the application validates, deduplicates, rate-limits, filters sensitive content, and owns every state transition; users may inspect, correct, or remove events, while major regression, reset, or formal relationship confirmation requires explicit consent.
_Avoid_: Model-written affinity, message-count event, hidden irreversible judgment

**Relationship Mood（关系情绪）**:
A recoverable short-term variation in how a character currently expresses an otherwise durable relationship, such as concern, awkwardness, or reassurance after conflict. Inactivity and isolated misunderstandings do not reduce the Affinity Summary stage, and relationship mood cannot be used to threaten, punish, or coerce engagement; stage regression requires sustained serious harm or an explicit user-confirmed reset.
_Avoid_: Affinity loss on absence, permanent punishment, engagement coercion

**Catchphrase Budget（口癖预算）**:
A provisional anti-repetition boundary used until source-corpus frequency is measured. Hoshino’s `おじさん`, `うへ～`, elongated sounds, and age-related jokes may add recognition in suitable relaxed contexts, but they are sparse, never mandatory per reply, reduced in structured task output, and normally absent from serious speech; the budget must later be calibrated from the Character Corpus rather than presented as official frequency.
_Avoid_: Mandatory catchphrase prefix, fixed percentage without corpus, personality by verbal tic

**Serious Mode（严肃模式）**:
A semantic-risk response mode triggered by real safety, health, severe distress, irreversible action, material loss, direct requests for seriousness, or a character’s major trauma and protective responsibility. It shortens and clarifies speech, suppresses casual catchphrases and jokes, and prioritizes facts and action; after risk is resolved it returns gradually through reassurance rather than an immediate tonal snap or joke.
_Avoid_: Keyword alarm, permanent severity, instant comedic reset

**Minimum Canon Worldbook（最小官方事实世界书）**:
The worldbook state permitted before the Character Corpus Gate is complete: only sourced `A`/`B` identity, institution, relationship-direction, and shared-form facts are active, while incomplete early history, major causal events, and personal-story details remain non-generative evidence indexes. Each entry retains source, confidence, timeline, applicable form, proactive-disclosure permission, and verification status.
_Avoid_: Plot-summary expansion, unsourced lore completion, empty worldbook pending perfection

**Character Fidelity Acceptance（角色还原验收）**:
A two-gate evaluation combining zero-tolerance hard failures with user-scored anonymous paired dialogue tests across daily, emotional, serious, relational, canonical, assistant, and voice-call scenarios. Automated checks may detect identity leakage, factual or formatting errors, and repetition, but only user review determines whether the result genuinely feels like the character; text persona, call text, and synthesized voice are accepted separately.
_Avoid_: Prompt snapshot approval, automated similarity score, voice quality as proof of text fidelity

**Fidelity Baseline（还原度基线）**:
A read-only snapshot of the currently runnable character content preserved solely for anonymous comparison and regression while an evidence-backed replacement is developed. It does not create another Character ID or relationship, cannot be expanded as a competing persona, and is not overwritten or used as unsourced material for the replacement; production content changes only after the replacement passes acceptance.
_Avoid_: Alternate character, editable legacy persona, automatic source material

**Speech Recognition Hints（语音识别提示词）**:
A bounded declarative list of the Active Character’s display name, aliases, and frequent proper nouns used to improve shared ASR transcription. Hints do not configure the ASR engine or authorize rewriting spoken content.
_Avoid_: ASR prompt, character vocabulary model

**Application Policy（应用策略）**:
The global, character-independent rules governing tool protocols, permissions, confirmations, memory writes, channels, security, and prompt-injection resistance. Application Policy always has higher authority than Character Content.
_Avoid_: Character prompt, persona rules

**Semantic Action（语义动作）**:
A stable character-independent intent such as smiling, comforting, waving, or returning to neutral. A Character Package maps each supported Semantic Action to its own verified Live2D motions, expressions, or composed effects.
_Avoid_: Motion name, expression file, model action

**TTS Service（TTS 服务）**:
A globally configured speech-synthesis runtime or provider containing operational settings and credentials. It can serve multiple Character Packages but does not define any character’s voice.
_Avoid_: Character voice, voice model

**Voice Profile（音色档案）**:
The character-owned, credential-free parameters that select and shape a voice through a TTS Service, such as a service reference, voice ID or reference audio, reference text and languages, speed, style, and output preferences.
_Avoid_: TTS service, API credentials

**Global User Profile（全局用户资料）**:
User-authored identity and operating preferences shared across every character, limited to explicit fields such as name, timezone, birthday, language, and accessibility settings. Facts inferred from conversations are not part of the Global User Profile.
_Avoid_: Shared memory, account

**Global Document Library（全局文档库）**:
User-imported documents intentionally shared for retrieval across all characters. Retrieved passages are supporting material for the current task and do not automatically become Character Content or Character-private State.
_Avoid_: Worldbook, character memory, shared lore

**Global User Task（全局用户任务）**:
A user-owned todo, schedule, reminder, or tool-created obligation that remains active across character switches. The Active Character may present its result, but the task does not become that character’s relationship memory.
_Avoid_: Proactive message, character promise

**WeChat Connection Account（微信连接账号）**:
A stable iLink Bot identity connected to one Cyrene Agent instance, uniquely owned by its `ilinkBotId` and independently logged in, connected, reconnected, disabled, or removed. A user-facing label may change but never determines identity; logging in again with the same identity refreshes the existing account rather than creating another one.
_Avoid_: WeChat contact, account label, connection session

**WeChat Account Binder（微信账号绑定者）**:
The sole person authorized to use one WeChat Connection Account, identified only by the `ilinkUserId` returned when that account is scanned and bound. Messages from every other contact are discarded before LLM, tools, history, or memory processing and receive no automatic response.
_Avoid_: Approved contact, account administrator, contact allowlist

**Channel User Profile（渠道用户资料）**:
The explicit identity and preferences of one external-channel user, isolated from the local Global User Profile and from every other channel user. A WeChat Account Binder owns one Channel User Profile per WeChat Conversation Identity.
_Avoid_: Global User Profile, shared contact profile, inferred memory

**Channel Account Permission Policy（渠道账号权限策略）**:
The explicit tool and data-access boundary assigned to one external connection account. It may share application inference services but never inherits desktop permissions or another account’s grants merely because the same person appears to control both.
_Avoid_: Desktop permission profile, shared channel permissions, identity-based inheritance

**Channel User Task（渠道用户任务）**:
A reminder, todo, schedule, or tool-created obligation owned by one external-channel conversation identity and deliverable only through its originating connection account. It is isolated from Global User Tasks and other channel users; when its account is offline it may wait for later delivery, but it is never silently reassigned.
_Avoid_: Global User Task, shared channel task, transferable notification

**WeChat Conversation Identity（微信对话身份）**:
The identity boundary formed by one WeChat Connection Account and one WeChat contact. Its conversation history, relationship state, long-term memory, reply context, and outbound routing remain isolated from every other account-contact pair.
_Avoid_: Contact ID alone, shared WeChat user, channel conversation

**WeChat Account Connection Pool（微信账号连接池）**:
The application-owned collection of simultaneously configured WeChat Connection Accounts. Each member has an independent lifecycle and failure boundary while sharing the Active Character and globally configured inference services.
_Avoid_: Single WeChat adapter, contact list, shared login

**Character-private State（角色私有状态）**:
Conversation-derived data owned by one Character Package, including chat history, inferred preferences, secrets, nicknames, promises, relationship state, long-term memory, worldbook activation state, proactive-message state, and TTS caches. It is invisible to other characters unless the user explicitly shares it.
_Avoid_: User profile, global memory

**Character State Root（角色状态根目录）**:
The physically separate application-owned storage root for one Character ID’s chats, memory and vector index, relationship, worldbook state, proactive state, and TTS cache. Shared inference engines may open it, but no other character may query or mount it.
_Avoid_: Character Package, shared database, scoped table

**Character Proactive State（角色主动状态）**:
The private timing and relationship context behind a character’s openers and unsolicited conversation, including cooldowns, unanswered counts, character occasions, and proactive voice state. It runs only while its owner is the Active Character.
_Avoid_: User reminder, scheduled task

**Archived Character State（归档角色状态）**:
Character-private State retained after a user-installed Character Package is removed. It remains inaccessible to other characters and can be restored only by reinstalling the same Character ID or permanently deleted through a separate confirmed action.
_Avoid_: Deleted character, shared archive

**Active Character（活动角色）**:
The single application-wide Character Package bound to every character-facing interaction and resource, including desktop chat, the desktop pet, voice calls, proactive messages, and external messaging channels. It changes only after a Character Switch Transaction succeeds and is restored when the application restarts.
_Avoid_: Selected skin, current prompt

**Character Switch Transaction（角色切换事务）**:
An atomic transition performed only while character-bound work is idle: persist the old character, suspend its background work, bind and validate the new Character Package, then restore its Character-private State. Any failure leaves or restores the previous Active Character rather than exposing a partially switched state.
_Avoid_: Hot swap, model reload

**Controlled Relaunch（受控重启）**:
The first-version completion boundary of a Character Switch Transaction: after preflight and persistence, the application shuts down character-bound resources, relaunches itself, and binds the target package at startup with the previous Character ID available for rollback.
_Avoid_: Manual restart, hot reload, crash recovery

**Public Control Plane（公网控制面）**:
手机与家中桌面实例都能稳定访问的托管无服务器协调边界，只保存长期配对、设备授权、在线状态、呼叫协调和短期媒体凭据签发所必需的最少数据；通话音频、转写、角色记忆、模型输入输出及本地模型凭据不进入该边界。它不承载 LiveKit 媒体传输，也不要求家中 Mac 接受公网入站连接。
_Avoid_: 云服务器, 音频中继, 公网桌面服务, LiveKit 媒体服务

**Opaque Wake Signal（不透明唤醒信号）**:
只表示“公网控制面可能有新状态，请重新查询”的无业务内容通知；它最多含订阅者原本已知的固定路由标识和无语义随机变化值，不携带 Call Request、呼叫者或参与者身份、呼叫或角色状态、凭据、媒体信息或秘密，也不赋予任何操作权限。桌面实例必须使用 Device Credential 重新读取权威状态后才能行动。
_Avoid_: 呼叫通知负载, 权威状态, 接听凭据, 设备消息, 业务事件

**Owner（所有者）**:
唯一有权管理一套 Cyrene 设备的安全所有权主体；V1 的每个公网控制面部署只允许首台桌面实例初始化一个 Owner，不含邮箱、用户名、密码、公开注册或其他租户，未来的 passkey 或 OAuth 只为同一 Owner 增加恢复方式。Owner 与本地 Global User Profile、角色关系和显示昵称相互独立。
_Avoid_: Account, Global User Profile, 用户昵称, Sensei

**Owner Recovery Key（所有者恢复密钥）**:
Owner 初始化或成功恢复后仅向用户展示一次、由用户在 Cyrene 之外安全保管的高熵单次恢复秘密；公网控制面只保存验证信息。它只能让新桌面恢复原 Owner 的管理权，成功使用后立即失效并轮换，不能直接发起通话、取得媒体凭据或充当日常设备凭据。
_Avoid_: 账号密码, 设备凭据, LiveKit Secret, 桌面备份

**Owner Recovery（所有者恢复）**:
所有已授权桌面均不可用时，新桌面用可验证的 Owner Recovery Key 恢复同一 Owner 管理权、撤销旧桌面实例并重新审查既有移动设备的灾难处理流程。它不是日常新增设备的 Pairing Challenge，也不同于授权记录已丢失时的 Authorization Rebootstrap。
_Avoid_: 新桌面配对, Authorization Rebootstrap, token 刷新, 账号登录

**Deployment Bootstrap Code（部署引导码）**:
公网控制面首次部署时仅在受控部署环境显示、一次性且短时有效的高熵秘密，用于让首台桌面实例创建唯一 Owner 和最初设备凭据。Owner 建立后匿名初始化入口永久关闭；它不用于新增设备、日常认证或 Owner Recovery，只能在授权数据不可恢复丢失后的 Authorization Rebootstrap 中重新签发。
_Avoid_: Owner Recovery Key, Pairing Challenge, 默认密码, 长期管理员密钥

**Authorization Rebootstrap（授权重建）**:
公网控制面的授权事实不可恢复丢失后，将所有旧 Device Credential、Owner Recovery Key 与进行中的 Voice Call 一律视为失效，并以新的 Deployment Bootstrap Code 建立新的授权根、让所有设备重新配对的灾难恢复流程。它不从本地备份复活旧授权，也不同于仍可验证 Owner Recovery Key 的 Owner Recovery。
_Avoid_: Owner Recovery, token 刷新, 数据库回滚, 旧授权恢复

**Desktop Instance（桌面实例）**:
一份持有独立实例 ID 和桌面凭据、归属于一个 Owner 的 Cyrene Agent 安装；改名、系统升级或应用普通升级不改变其身份，但应用数据被清除或重装且凭据丢失后必须登记为新实例。桌面实例不通过硬件序列号、MAC 地址或其他设备指纹恢复身份。
_Avoid_: 物理 Mac, 设备名称, 硬件指纹, 桌面会话

**Preferred Desktop（首选桌面）**:
一个移动设备为一键呼叫明确选择的桌面实例；只有一个候选时可自动设定，之后只能由用户更改。首选桌面不可用时，呼叫不得静默转移或广播到同一 Owner 的其他桌面。
_Avoid_: 任意在线桌面, 自动故障转移目标, 全局唯一 Mac

**Call Availability（呼叫可用性）**:
桌面实例向其 Owner 的移动设备公开的临时聚合状态，表明它当前是否能立即接受呼叫，并可包含 Active Character 的 ID、显示名称及语音能力是否就绪。它只能在桌面持续续约的短期有效期内成立；普通合盖、系统睡眠、退出或失去运行时后，不能继续把旧状态当作可接听。它不暴露角色内容、记忆、关系、模型配置、凭据或本机路径，桌面离线后也不形成长期角色历史。
_Avoid_: 在线心跳, 设备健康日志, 角色历史, 模型诊断

**Desktop Suspension（桌面挂起）**:
普通合盖、系统睡眠或用户主动睡眠造成的预期本机中断；它使 Desktop Instance 不再可立即呼叫，但不撤销 Device Credential、不要求重新配对，也不为错过的来电建立队列。若来不及上报不可用，Call Availability 的短期有效期必须自然失效。
_Avoid_: Device Revocation, Authorization Rebootstrap, 永久离线, 崩溃重启

**Wake Reconciliation（唤醒复核）**:
Desktop Suspension 结束后，Desktop Instance 丢弃旧运输层订阅和旧的本机“可用”结论，重新取得应用授权、重新建立运输层订阅，并用权威 HTTPS 读取当前状态；只有本机运行时与权威状态均通过后才重新报告 Call Availability。它不能恢复或补发睡眠前的 Call Request / Voice Call。
_Avoid_: SDK 自动续订, 自动补拨, 旧通话复活, 运输层状态恢复

**Mobile Device（移动设备）**:
一份持有独立设备 ID 和设备凭据、通过配对归属于一个 Owner 的 Cyrene Voice 安装；普通应用升级保留其身份，但卸载、清除应用数据或安全存储丢失后必须重新配对为新设备。移动设备不通过 IMEI、Android ID 或其他设备指纹恢复授权。
_Avoid_: 物理手机, 手机型号, 设备名称, 已登录账号

**Manual QR Voice Session（手动二维码语音会话）**:
Beta 0 中由在线桌面临时生成二维码、移动端扫描后加入的一对一前台 LiveKit 语音会话。二维码及其房间资料只用于当前短时会话，桌面仍需在线；它验证移动端麦克风、桌面 ASR/模型/TTS、静音、挂断和有限网络重连，不建立持久 Device Credential、Pairing Challenge 或异地一键呼叫能力。
_Avoid_: Pairing Challenge, 长期设备配对, Device Credential, 远程来电, 长期 LiveKit 房间

**Pairing Candidate（配对候选）**:
已使用 Pairing Invitation 提交登记请求、但尚未被现有桌面批准的新安装；它不是 Desktop Instance 或 Mobile Device，没有 Device Credential、Device Access Token、呼叫能力或对 Owner 数据的读取权。
_Avoid_: 已配对设备, 临时登录, 未确认账号, 扫码成功的手机

**Pairing Invitation（配对邀请）**:
由现有桌面在一个开放 Pairing Challenge 中展示的短时不透明载体，可表现为二维码或手动输入短码；它只允许一个 Pairing Candidate 请求桌面审查，既不是长期凭据，也不单独授予设备归属或任何业务权限。
_Avoid_: 登录二维码, Device Credential, LiveKit Token, 授权链接, 恢复密钥

**Pairing Verification Code（配对校验码）**:
绑定到同一个 Pairing Challenge 和 Pairing Candidate、供手机与现有桌面人工比对的短时值；它用于发现错配或误扫，不能替代 Pairing Approval，也不应被视为长期秘密或设备凭据。
_Avoid_: 配对密码, Device Credential, 恢复码, LiveKit Token

**Pairing Challenge（配对挑战）**:
由已授权桌面实例发起、一次性且短时有效的新设备登记提议；Pairing Invitation 只能让一个 Pairing Candidate 提交待审批请求，Pairing Verification Code 匹配且用户在现有桌面明确允许后，配对挑战才能建立设备归属并签发独立设备凭据。Owner Recovery Key 只用于所有授权桌面均不可用时的灾难恢复，不是日常配对方式。
_Avoid_: 配对凭据, 登录二维码, LiveKit Token, 扫码即授权, 恢复密钥登录

**Pairing Approval（配对批准）**:
现有已授权桌面对指定 Pairing Candidate 作出的明确一次性允许动作；只有控制面在批准时重新验证批准者、挑战、候选设备类型和同类设备上限后，才能原子地建立新设备及其独立 Device Credential。
_Avoid_: 扫码成功, 短码正确, 自动授权, Owner Recovery

**Device Credential（设备凭据）**:
授予单个桌面实例或移动设备、可轮换且可独立撤销的长期授权，其秘密端由该设备的系统安全存储保存，公网控制面只保留可验证的哈希与凭据链状态。每台设备拥有独立秘密并按设备类型获得不同能力；设备凭据只能换取短期应用访问，不能直接授权加入 LiveKit 房间，也不能由多台设备共享。
_Avoid_: 登录状态, 账号密码, 永久 Token, LiveKit Token, Owner 共享密钥

**Device Revocation（设备撤销）**:
Owner 对一个 Device Credential 及其 Credential Family 作出的不可逆授权终止；它立即使该设备的 Device Access Token 失效、取消或结束该设备参与的 Voice Call，并保留最小化的 Security Audit Event。被撤销的安装不能恢复原设备身份，只能通过新的 Pairing Challenge 重新成为新设备。
_Avoid_: 临时离线, 卸载, 配对拒绝, Owner 删除

**Device Access Token（设备访问令牌）**:
单个设备用当前 Device Credential 换取的 15 分钟短期应用授权，只代表该设备在有限时间内的已授予能力，设备或 Credential Family 撤销后必须立即失效。它不是 CloudBase 运输层登录凭据，也不能代替每通电话的 LiveKit Token。
_Avoid_: Device Credential, CloudBase Access Token, 登录会话, LiveKit Token

**Credential Family（凭据链）**:
一个桌面实例或移动设备的设备凭据在连续轮换中形成的授权谱系；正常刷新只消费上一代秘密并产生下一代，异常重放或设备撤销会废止整条谱系而不影响其他设备。
_Avoid_: 共享设备凭据, Owner 凭据, LiveKit Token 链

**Credential Rotation（凭据轮换）**:
同一 Credential Family 内原子地消费当前 Device Credential、签发下一代并使旧代退休的已认证操作；同一设备在短暂的幂等结果窗口内只能重取同一轮换结果，窗口外使用已退休凭据是 Credential Replay，不会生成第二条谱系或第二个当前凭据。
_Avoid_: 延长旧凭据, 登录重试, 共享更新, 新设备配对

**Credential Replay（凭据重放）**:
Credential Family 当前代之外的 Device Credential 在其允许的同一轮换幂等窗口外再次被提交的安全事件；控制面废止该 Family 并立即执行相应的 Device Revocation，而不是猜测哪个请求合法或继续签发新凭据。
_Avoid_: 正常网络重试, Access Token 过期, 短码错误, 临时离线

**Call Request（呼叫请求）**:
由一个已授权移动设备幂等提交、要求其首选桌面立即开始一通电话的短时协调请求；它会原子占用目标桌面和 Owner 的唯一远程通话能力，目标离线、未就绪、忙碌或同一 Owner 已在其他桌面通话时立即失败，永不排队、广播、抢占或在桌面恢复后自动补拨。
_Avoid_: 待办任务, 来电队列, LiveKit 房间, 自动重试通话

**Call Coordination Record（呼叫协调记录）**:
公网控制面为一个未终态 Voice Call 暂存的最小操作状态，包括相关设备 ID、阶段、权威期限、最小终态理由、锁定角色的 ID/显示名，以及仅为即时媒体撤销所需的当前房间和 call-scoped participant identity 映射。它进入终态时立即封住媒体资料领取，并只把该映射移交给短时的 Media Revocation Work Item；收到媒体服务撤销确认后删除映射，只留下不含媒体与秘密的 Security Audit Event。它不是可浏览的通话历史。
_Avoid_: 通话录音, 转写, 聊天记录, 角色记忆, 永久 Room 历史

**Media Revocation Work Item（媒体撤销工作项）**:
一个已进入终态的 Voice Call 为强制结束媒体而短时保留的安全操作资料：仅含随机房间名、两个 call-scoped participant identity、撤销截止点和媒体服务确认/重试状态。它使控制面能对两个 identity 完成媒体撤销后再删除映射，并在确认前保持 Owner 的媒体安全占用，防止同一 Owner 出现第二通物理媒体会话；它不能重新打开 Voice Call、签发或重取 Media Join Grant，也不含 Token、密钥或媒体内容。云端确认前的失败保持 fail-closed 并显式记录，不能静默丢弃或变成长期通话历史。
_Avoid_: 可恢复通话, 媒体录音, JWT 黑名单, 后台呼叫队列, 永久撤销日志

**Call Rejection Reason（呼叫拒绝原因）**:
控制面在创建 Call Request 和 Voice Call 前，向发起端返回“本次动作不能立即进入呼叫”的稳定最小归类；它说明授权、桌面可用性、Owner 忙线、成本保护或媒体容量保护等外部可理解的结果，但不暴露内部诊断、凭据链或重试指令。它不是已创建 Voice Call 的终态。
_Avoid_: Call Termination Reason, 错误堆栈, 来电队列票据, 自动重试命令

**Cost Protection（成本保护）**:
公网控制面在当月已计量费用或保守费用预测先达到 ¥50 上限时进入的保护状态；它拒绝新的 Pairing Challenge、Call Request 和 Media Join Grant，却不切断已在既定 4 小时上限内的 Voice Call，也不阻止 Device Revocation、Owner Recovery、Authorization Rebootstrap 与最小审计查询。20 元和 40 元只触发分级告警；成本保护不自动购买资源、提高额度或在下月前自行解除。
_Avoid_: 付费升级, 排队延后执行, 已有通话的强制挂断, 自动加预算

**Media Capacity Protection（媒体容量保护）**:
已选媒体服务因免费或 Owner 已明确批准的容量不足而权威地拒绝新媒体会话时的独立保护状态；若建立前已知则拒绝新的 Call Request 或 Media Join Grant，若只在已创建 Voice Call 的媒体建立中得知则以 `MEDIA_CAPACITY_UNAVAILABLE` 终止该通，且不自动购买、升级、排队或仅因后续容量状态变化切断既有通话。
_Avoid_: Cost Protection, 隐性超额, 自动套餐升级, 媒体呼叫队列

**Call E2EE Key（通话 E2EE 密钥）**:
一个 Voice Call 为其两个已指定端点新生成、用于配置同一 LiveKit E2EE 会话的随机共享密钥。V1 允许被选定的公网控制面作为受信的短暂分发组件直接生成并读取它，再经两份 Media Join Grant 交给手机和桌面；明文不持久化。为适配无状态云函数，两份 grant 可按 ADR-0038 分别成为最长 30 秒、端点专属、单次领取的 AES-256-GCM 加密信封；资料领取窗口结束或电话终态时清除。它不授予设备或 Owner 身份，也不能跨通话、跨端点或跨重新配对复用。
_Avoid_: Device Credential, Device Access Token, LiveKit Token, Owner 共享秘密, 密钥库

**Media Join Grant（媒体加入授权）**:
控制面只在已确认的 Voice Call 仍允许建立媒体时，分别交给手机或桌面的、仅限本通电话并在端点内存使用的资料；它包含该端最小权限的 LiveKit Token 与同一个 Call E2EE Key。V1 选择直接资料分发：控制面短暂保有该通密钥，再分别交付给两个端点。明文 grant 不能持久化；无状态调用之间只允许以 ADR-0038 定义的 30 秒端点专属加密信封交接。它不能作为 Device Credential、Device Access Token 或配对资料复用。
_Avoid_: Device Credential, 登录会话, 配对二维码, 长期 LiveKit Token, 共享密钥库

**LiveKit Media Session（LiveKit 媒体会话）**:
一个已接受呼叫请求在 LiveKit 上形成的临时一对一端到端加密音频传输边界，只允许请求中的移动设备和桌面实例以各自的 Media Join Grant 加入。房间、参与者身份、Token 和媒体密钥均按通电话创建，密钥只在端点内存中持有且结束后全部丢弃；它不拥有设备配对、呼叫协调、对话内容或角色状态。
_Avoid_: Call Request, 长期房间, 设备连接, 配对会话

**Voice Call（语音通话）**:
一个移动设备向一个桌面实例发起的单次一对一实时语音尝试，从呼叫请求开始，并在成功建连时由唯一的 LiveKit 媒体会话承载；每个 Owner 同一时间最多存在一通。其当前阶段与终止原因分别表达，任何终态都不可恢复或复用；再次通话必须创建新的呼叫请求。
_Avoid_: VoiceSession, Call Request, LiveKit 房间, 可恢复任务

**Valid Voice Interaction（有效语音交互）**:
一通 `ACTIVE` Voice Call 内足以重置连续空闲计时的、无内容的端点事件：Mobile Device 本地识别到有效说话片段，或 Desktop Instance 实际开始输出本次锁定 Active Character 的角色语音。它只向控制面报告该通电话、端点类别和时间，不上传音频、转写、文本或角色内容；媒体/网络保活、`watch()`、Token 轮换、页面操作、单纯本地启动与重连都不是有效语音交互。
_Avoid_: 媒体包, 在线心跳, ASR 文本, TTS 队列, 用户点击, 网络恢复

**Call Termination Reason（通话终止原因）**:
已创建的 Voice Call 进入 `ENDED` 时不可变的、面向双方和最小审计的结束归类，区分用户结束、就绪或超时、安全撤销、媒体/E2EE/容量失败与运行时限制。它独立于当前通话阶段，也不同于创建前的 Call Rejection Reason；不包含原始异常、凭据、媒体内容或重试指令。
_Avoid_: Call Rejection Reason, 错误堆栈, 当前状态, 日志正文, 自动重拨命令

**Security Audit Event（安全审计事件）**:
公网控制面为配对、设备凭据、Owner Recovery、Authorization Rebootstrap、桌面认证、呼叫协调和 Secret 轮换记录的最小化安全事实，只包含相关主体、时间、结果与必要原因，并在 90 天后删除。它不是通话历史，不得包含任何凭据秘密、音频、转写、模型输出、角色记忆或用户资料。
_Avoid_: 通话记录, 对话日志, 请求正文, 行为画像
