# DSH Teams 单租户账户与授权设计

> 日期：2026-08-27  
> 状态：已批准设计  
> 关联 Issue：[GitHub #1](https://github.com/neil-wang-global/dsh-teams/issues/1)

## 1. 摘要

DSH 当前是单用户、本机优先的 Web 应用。现有 `dsh-auth-gate` 能在整个页面、API 和 WebSocket 外围要求登录，但成功后只给出 allow/deny，不把稳定的人类用户身份传入 DSH API。DSH 的会话列表、工作区列表和两条实时流都是全局视图，Workspace 只表达服务器目录与 Session 归组，不包含用户或角色。

本设计在不修改 DSH 的前提下提供单租户团队能力。`dsh-teams` 首先作为 Cordis Plugin 接入；若现有扩展点不能可靠接管全部数据面，则由 Plugin 拉起旁路 Web 网关和 SQLite 数据库。公开域名只访问旁路网关，原 DSH 保持 loopback-only。任何无法可靠授权的 DSH 能力默认关闭，直到能通过 Plugin/旁路覆盖，或 DSH 上游提供最小通用接缝。

## 2. 目标与非目标

### 2.1 目标

- 建立邮箱账户、founder/admin/user 系统角色和管理员账户管理。
- 支持临时密码、强制首次改密、禁用、重置、通知和立即撤销。
- 支持工作区 owner/member/guest 与会话 Holder。
- 对 HTTP RPC、下载、附件、搜索和实时事件统一执行 deny-by-default 授权。
- 支持 SMTP provider、TOTP、恢复码与 passkey。
- 保持 DSH 会话 JSONL 内容与 SessionHeader 不变。
- 对升级、崩溃和跨存储操作 fail closed、可恢复、可审计。

### 2.2 非目标

- 多租户、租户切换和租户级管理员。
- OAuth/OIDC、SAML 或社交登录。
- 第一版实现多个邮件 provider。
- 第一版彻底删除工作区目录、会话 JSONL、附件和审计记录。
- 把 system admin 等同于操作系统 root，或绕过原有 Host/Origin 安全边界。

## 3. 已有系统事实

- Web profile 由 Cordis composition 挂载 Session、JSONL persistence、Workspace、API proxy、Web server、Client connection 和 UI 插件。
- `dsh-auth-gate` 用户记录只有 username、passwordHash、disabled 和未启用的 totpSecret。
- 登录会话使用随机 opaque token，数据库介质只保存 SHA-256 digest；但禁用用户不会撤销已登录会话。
- DSH SessionHeader 不包含人类用户或访问控制字段。
- Workspace 是 canonical directory 的稳定 UUID，保存 title、timestamps 和有序 sessionIds；没有 ACL。
- `session.list`、workspace API、mux stream 和 host stream 当前面向整个实例。
- DSH JSON domain 是整文件原子更新，不提供关系约束和跨表事务；Node 运行时可使用 SQLite。

这些事实意味着外围登录与前端隐藏不足以构成多人授权。

## 4. 信任边界与部署拓扑

### 4.1 一级：同进程 Plugin

Host Plugin 提供：

- `IdentityService`：bootstrap、用户、凭据、登录会话、安全因子；
- `PolicyService`：principal + resource + action 的唯一授权入口；
- `TeamRepository`：SQLite migration 与事务；
- `MailService`：provider registry、outbox worker、模板；
- `AuditService`：不可变审计写入和查询；
- `CompatibilityGuard`：DSH method/stream/route 清单和启动自检；
- API/stream adapter：授权、过滤、错误映射和连接撤销。

Client Plugin 使用现有 Slot 增加账户菜单、管理员面板、成员管理、工作区权限和安全设置。登录与 bootstrap 页面由 Host 路由直接提供，避免依赖登录后的 SPA。

所有包装必须绑定 Fiber 生命周期，可卸载、可恢复原状态。进入 in-process 多人模式前，自动化探针必须逐一证明 HTTP RPC、download、attachment、WebSocket upgrade、baseline 和 incremental stream 都经过不可绕过的 adapter；仅存在 compatibility manifest 不算证明。任一入口不能拦截、出现重复原始 route，或可绕过 principal 时，Plugin 不得部分启用，必须整体选择旁路模式或保持单用户。

### 4.2 二级：Plugin 管理的旁路网关

当同进程扩展点无法安全接管所有入口时，Plugin 拉起独立旁路监听：

- 公开域名只解析到旁路端口；
- DSH 继续绑定 `127.0.0.1`；
- 旁路代理 DSH 静态资源和 Client plugin bundle；
- 旁路校验并转发允许的 `/api/*`；
- 旁路订阅 DSH 全量 WS，并按 principal 重新分发过滤后的事件；
- 禁用、改密、降权时关闭关联连接；
- 任何未知 API method 默认拒绝。

原 DSH 端口若可被远端直接访问，部署自检失败。不能依靠“用户不知道端口”作为边界。

### 4.3 Agent 执行面隔离

API 授权不能约束 Agent 已获得的 bash、文件系统、凭据或 Host 工具。多人模式必须先证明每个会话的工具执行被限制在其工作区与允许的服务集合内。优先使用可验证的 Plugin/preset 沙箱接缝；若当前 DSH 只能提供进程级 workspace root，旁路层必须按工作区拉起隔离的 DSH worker（独立 cwd、DSH_HOME、凭据范围和 OS/container 边界），并把该工作区会话固定路由到对应 worker。

在执行面隔离证明通过前，非 admin 用户的 prompt、fork、approval 和任何可触发 Agent/Tool 的操作保持 blocked；只读历史不能作为工具执行入口。应用 RBAC 不得被描述为 OS 隔离。

### 4.4 最后手段

如果 Plugin、旁路和隔离 worker 均无法防止某个入口泄漏或越权：

1. 关闭该能力；
2. 记录最小复现、威胁模型和所需通用接缝；
3. 与 DSH 上游沟通；
4. 接缝发布并通过回归测试后再开放。

## 5. 领域模型

### 5.1 系统用户

`users` 的关键字段：

- `id`：不可变随机 UUID；
- `email_normalized`：唯一登录标识；
- `email_display`：显示和发信使用；
- `system_role`：`admin | user`；
- `status`：`active | disabled`；
- `is_founder`：仅一条记录为 true；
- `must_change_password`；
- `auth_version`：授权或凭据变化时递增；
- created/updated timestamps。

Founder admin 不可禁用、删除或降级。系统角色不直接写入登录 Cookie，每次敏感操作从数据库读取当前状态或校验 auth_version。

### 5.2 工作区成员

`workspace_memberships`：

- `(workspace_id, user_id)` 唯一；
- `role`：`owner | member | guest`；
- `joined_at`、`role_changed_at`；
- 确定性 membership id，用于自动接管排序。

`team_workspaces` 关联现有 DSH WorkspaceId，保存 creator_user_id 和生命周期状态。DSH 仍拥有 path、title 和 sessionIds。

### 5.3 会话 Holder

`session_holders` 保存：

- `session_id` 唯一；
- `workspace_id` 可空；空值表示尚未归入工作区的 legacy/personal session；
- `holder_user_id`；
- `assigned_at`、`assigned_by`、reason/version。

新工作区会话 Holder 是创建者。guest 不可成为 Holder。Holder 只能主动转移自己持有的会话，目标必须是该工作区 owner/member 或 system admin。Ungrouped session 只对其 Holder 与 system admin 可见，不可直接转给工作区成员；必须通过显式 attach saga 同时建立 workspace 关联和合格 Holder。

Holder 被禁用、移除、降为 guest，或 system admin 降为 user 后不再具备目标工作区成员资格时，在同一 SQLite 事务中转给一个有效 owner。被降级 admin 持有的 ungrouped session 转给 founder。业务没有 owner 优先级；实现按稳定 membership id 选择第一名，确保测试和审计可重复。若无 owner，成员或角色变化失败。

### 5.4 邮件与审计

`mail_outbox` 与业务变更同事务写入，worker 按状态和 next_attempt_at 发送，使用幂等 message key。`audit_events` 保存 actor、target、workspace/session、action、结果、时间和最小必要上下文，不保存密码、token、TOTP secret 或 SMTP secret。

## 6. 账户生命周期

### 6.1 Bootstrap

空系统首次访问进入 bootstrap。注册必须来自 loopback，或携带启动日志打印的一次性 setup token。数据库事务同时：

1. 验证 bootstrap 尚未完成；
2. 创建 founder admin；
3. 写 `bootstrap_completed=true`；
4. 消费 setup token；
5. 写审计事件。

系统永不通过 `users.count === 0` 重新开放 bootstrap。

### 6.2 管理员创建用户

两种交付模式：

- `email`：系统生成临时密码，创建账户和 outbox 邮件；邮件包含邮箱、临时密码和本站登录链接。
- `manual`：管理员输入临时密码，不发送创建邮件；成功响应只显示一次账户/密码可复制文本。

两种模式都设置 `must_change_password=true`。数据库只保存版本化密码哈希，不保存可恢复明文。

### 6.3 首次改密

临时密码登录只签发 restricted session。仅允许：

- 修改自身密码；
- 登出；
- 读取自身最小安全状态。

改密成功后递增 auth_version、撤销 restricted session 并签发正常 session。绑定 TOTP/passkey、访问工作区或调用 DSH API 均在改密前拒绝。

### 6.4 管理员重置与禁用

重置密码：

- 管理员亲设临时密码；
- 设置 must_change_password；
- 递增 auth_version；
- 撤销所有 HTTP/WS session；
- 成功页只显示一次凭据；
- 邮件只通知已重置，不包含密码。

禁用立即撤销全部会话；解禁不恢复旧会话。角色变化、禁用和解禁写审计并发通知邮件。

## 7. 认证与安全因子

### 7.1 登录会话

使用高熵 opaque token，数据库仅保存 digest。Cookie 使用：

- `__Host-` 前缀；
- Secure、HttpOnly、SameSite=Lax、Path=/；
- 不设置 Domain；
- idle 与 absolute expiry；
- 登录/提权/改密后 rotation；
- 写操作 CSRF 校验。

公开部署必须有规范 HTTPS URL。开发环境可使用独立的明确 insecure 配置，不能静默降级。

### 7.2 密码

迁移时可验证现有 scrypt 格式；新密码使用版本化 hash 参数并在部署硬件上校准。未知邮箱执行 dummy KDF。登录、bootstrap、token 和 MFA 端点采用持久化限流。

### 7.3 TOTP

管理员开启能力后用户可自愿绑定。TOTP secret 使用外部 deployment key 进行 AES-256-GCM 加密。恢复码仅存哈希并单次消费。验证记录时间步，拒绝同一时间步重放。

关闭 TOTP 后禁止通过它登录或新绑定，但保留加密凭据，重新开启后恢复使用。

### 7.4 Passkey

使用维护中的 WebAuthn server/browser 实现。保存 credential id、public key、counter、backup flags、transports 和 user handle。Challenge 短期、单次、绑定 ceremony 与 session。origin 必须等于 canonical site URL，RP ID 稳定且不可从不可信 Host 推导。

关闭 passkey 后禁止登录和新绑定但保留凭据。

## 8. 权限矩阵

任何 `active`、已完成首次改密的 system user 都可创建工作区，并自动成为该工作区 creator/owner。普通 user 只能在管理员配置并分配给其使用的 managed workspace roots 下创建新目录或采用目录；不能提交任意 Host 绝对路径、符号链接逃逸或采用其他用户/工作区已占用的目录。System admin 可在全部受控 roots 下创建或采用目录，但仍不绕过 realpath、owner 和目录类型检查。workspace.create endpoint 的 manifest action 固定为 `workspace:create`，不能归入笼统 CRUD 放行。

| Action | System admin | Workspace owner | member | guest |
|---|---:|---:|---:|---:|
| 查看任意工作区 | 是 | 仅所属 | 仅所属 | 仅所属 |
| 查看工作区全部会话 | 是 | 是 | 是 | 是 |
| 创建会话 | 是 | 是 | 是 | 否 |
| 操作自己 Hold 的会话 | 是 | 是 | 是 | 不适用 |
| 操作他人会话 | 是 | 是 | 否，只读 | 否，只读 |
| 转移自己 Hold 的会话 | 是 | 是 | 是 | 否 |
| 管理成员与工作区角色 | 是 | 是 | 否 | 否 |
| 移除成员 | 是 | 是 | 否 | 否 |
| 解散工作区 | 是 | 是 | 否 | 否 |
| 离开工作区 | 按成员身份 | 有其他 owner 才可 | 是 | 是 |
| 访问账户/通用设置 | 是 | 否 | 否 | 否 |

会话写操作包括 prompt、steer/queue、cancel、rename、archive/unarchive、fork 和影响运行状态的审批/回答。member 对他人会话可读历史与附件，但不能导出；guest 同样只读且不能导出。

所有登录用户可查看公开成员目录。目录不得返回密码状态、MFA/passkey 状态、auth_version、审计详情或秘密配置。

## 9. 授权执行与错误语义

每个请求遵循：

1. Host/Origin、media type、body size 与 CSRF；
2. 解析 opaque session；
3. 校验用户状态、expiry、auth_version 和 restricted state；
4. 加载资源与成员关系；
5. 判断 visibility；
6. 判断 action，并取得当前资源/授权 epoch；
7. 在调用 DSH 前再次比较 epoch；角色、成员或 Holder 变化与资源操作通过同一资源锁/串行链线性化；
8. 调用 DSH；
9. 在释放任何响应字节前重新加载当前授权状态并比较 epoch，再按当前 policy 投影；普通响应失效则丢弃结果并返回 401/403/404，download/stream 在每个 chunk/frame 前检查，失效立即 abort 上游且不再发送；
10. 写必要审计。

降权的 `suspended` 屏障阻止受影响 principal 的新读、新写、新 frame 和新 stream chunk。若授权在 DSH 调用开始前或响应释放前失效，请求拒绝；已经进入不可取消副作用的写请求由资源锁先完成，再提交降权事务。降权不能与旧权限读写或响应发送无序并发。

错误规则：

- 无效认证：401；
- Host/Origin/CSRF 或明确的管理功能边界：403；
- 不存在或对用户不可见的 workspace/session/attachment：404；
- 可见但不允许 action：403；
- DSH RPC 保持 HTTP 200 envelope，业务错误使用 `forbidden` 或对应 `*-not-found`；
- 邀请/重置查找不枚举邮箱，接受响应和失效 token 均不泄露账户存在性。

## 10. DSH API 与实时过滤

维护版本化 compatibility manifest，将每个 DSH endpoint 分类为：

- public authenticated；
- workspace visible read；
- Holder write；
- owner write；
- system admin；
- blocked。

未分类 endpoint 默认 blocked。覆盖 session/workspace CRUD、search、history、prompt、cancel、queue、fork、attachment、export、approval、question、job、goal、agent preset、settings、credentials、models 和自定义 Remote。导出必须在发送任何响应字节前计算完整 descendant closure，并逐个验证可见性；只要一个 descendant 不可见或未映射，整个导出返回 404，或者由旁路重新打包仅包含已明确授权的 Session，绝不直接转发未经检查的 DSH archive。

实时流在旁路服务端过滤，不能把全量事件交给浏览器后再丢弃。每个发送动作都比较连接 auth_version 与数据库当前 authorization epoch，principal snapshot 只作缓存提示。降权事务先在受影响连接上设置同步 `suspended` 屏障，阻止新 frame 与新 HTTP 写入，再提交角色/成员/Holder/status 变化、递增 epoch 并关闭连接；失败则解除屏障。这样提交之后不存在仍按旧 snapshot 发送的窗口，重连会重新生成可见基线。

## 11. SQLite 设计

数据库路径默认 `$DSH_HOME/teams/teams.sqlite3`，启用：

- WAL；
- foreign_keys=ON；
- busy_timeout；
- 明确 transaction mode；
- 单调 schema migration；
- startup integrity/compatibility checks。

建议表：

- site_state；
- users；
- password_credentials；
- auth_sessions；
- one_time_tokens；
- totp_factors；
- passkeys；
- recovery_codes；
- team_workspaces；
- workspace_memberships；
- session_holders；
- mail_outbox；
- audit_events；
- operation_journal。

非秘密设置可存 SQLite。SMTP password、TOTP encryption master key 等部署秘密通过 secret reference 解析，不通过普通 API 返回。

`$DSH_HOME/teams` 与数据库、WAL、SHM、备份文件必须归运行 DSH 的 OS 用户所有，目录 0700、文件 0600；启动时使用不跟随符号链接的安全打开/校验并拒绝 owner、mode、realpath 异常。威胁模型不防拥有同一 OS 账户或 root 权限的攻击者，但防止其他本机普通账户读取。备份按数据库同级秘密处理，必须加密、校验恢复演练并限制保留。TOTP deployment key 必须有独立备份和版本号；轮换采用双读单写迁移，丢失时只能撤销受影响因子并要求重新绑定，不能静默跳过解密失败。

## 12. 跨 DSH 一致性

SQLite 与 DSH JSONL 不具备分布式事务，使用 operation journal + saga。不得假设 DSH Workspace API 接受调用方预分配的 workspaceId：

1. 网关为业务操作分配 idempotency key，写 pending operation 和预期授权状态；
2. Session create 等现有契约允许时预分配 sessionId；Workspace create 先调用 DSH，记录其返回的 WorkspaceId；
3. 成功后 finalize sidecar 映射；
4. 失败后补偿或保持资源隐藏；
5. 启动时 reconciliation，并在运行期持续消费 DSH workspace/session/lineage 事件。

所有能产生或改变资源归属的路径都必须有状态机：workspace.create/delete、session.create/fork、subagent spawn/fork、attach/detach/move、archive 和 Plugin/Remote 内部创建。由 DSH 内部 Cordis consumer 创建、旁路未发起或在崩溃窗口产生的未知 Workspace/Session 一律进入 `quarantined-unmapped`，不进入列表、搜索、导出或实时 fan-out；管理员诊断只能看到最小元数据。reconciliation 根据 lineage 让 subagent 继承父 Session 的 workspace 与 Holder，无法证明父关系时保持隔离。

创建 Session 时先预分配 sessionId 和 Holder，再调用 DSH；pending 记录不出现在列表。Workspace create 在获得 DSH 返回 id 前保持 operation-only 状态，若崩溃留下未知 Workspace，由持续 reconciliation 隔离并要求补偿/认领。解散工作区先进入 deleting，阻止新写入，再解除 DSH registration 并写 tombstone。不能安全补偿的操作保持 blocked 并进入管理员诊断队列。

## 13. 邮件设计

`MailProvider` 定义发送接口、健康检查和 provider 配置 schema。第一版实现 SMTP；后续 provider 不改变业务 outbox schema。

模板至少包括：

- 用户创建与临时密码；
- 管理员重置通知；
- 禁用/解禁；
- 系统角色变化；
- 安全因子变化；
- 可选的登录安全提醒。

邮件正文中的站点链接只能来自管理员确认的 canonical site URL，不能从请求 Host 动态构造。

## 14. 迁移

1. 创建 SQLite 与 schema；
2. 关闭多人入口；
3. 创建/确认 founder；
4. 可选一次性导入 `dsh-auth-gate` YAML 用户，处理规范化邮箱冲突；
5. founder 成为所有现有 Workspace 的 owner；
6. 所有现有 Session Holder 设为 founder，包括 ungrouped session；
7. 写 migration watermark 和审计摘要；
8. 失效全部旧 auth-gate session，要求重新登录；
9. 完成授权兼容与泄漏测试后才允许创建第二个真实用户。

原 YAML 归档，不双写。迁移可重入，任何部分失败都不开放多人模式。

## 15. 测试策略

### 15.1 Policy 单元测试

覆盖 system role × workspace role × holder relation × action 的笛卡尔矩阵。显式测试未知 action 默认 deny。

### 15.2 API 集成测试

每个 endpoint 覆盖：未登录、不可见、guest、member-other、member-holder、owner、admin。直接构造 RPC，不依赖 UI。

### 15.3 泄漏测试

- session/workspace list 与 search；
- history pagination；
- attachment 与 export，包括 descendant closure 中存在不可见、跨工作区或 unmapped Session；
- WS baseline 与 incremental frames，以及降权 commit 同时发生的发送竞态；
- approval/question/job/goal/projection；
- 错误详情、日志和审计响应。

### 15.4 撤销与并发

- 禁用、改密、降权、移除成员后的即时断流；
- founder 不变量；
- 最后 owner 并发离开/降级；
- guest 不可 Hold；
- Holder 自动接管；
- outbox 单次发送与 token 单次消费；
- auth_version race。

### 15.5 恢复测试

在每个 saga 阶段注入崩溃，重启 reconciliation 后不得出现未授权可见资源。验证运行期由 subagent、fork、内部 Cordis consumer 和 custom Remote 创建的未映射资源持续进入 quarantine；同时验证 DSH 不可用、SQLite busy、SMTP 超时和 Plugin reload。

### 15.6 MFA/Passkey

测试 TOTP 时间窗与重放、恢复码单次消费、WebAuthn challenge 绑定、origin/RP ID、counter 与备份标志。

### 15.7 DSH 升级与执行隔离契约

对 route/API/method/stream manifest 做 snapshot。新增或签名变化导致多人模式启动失败，直到明确分类并补齐测试。自动探针证明每条 route/stream 不可绕过；执行测试证明 member/owner Agent 的 bash、文件、凭据和 Host 工具无法越过所属工作区。若采用隔离 worker，验证独立 cwd、DSH_HOME、凭据、进程/容器边界及跨 worker 路由。

### 15.8 本地存储与秘密

验证 teams 目录、SQLite/WAL/SHM、备份和 secret 文件的 owner/mode/realpath/symlink 拒绝；执行加密备份恢复、TOTP key 双读单写轮换和 key-loss 撤销演练。

## 16. 分期交付

### Phase 1：身份基础

SQLite、migration、bootstrap、登录、管理员账户、强制改密、设置、SMTP/outbox 和审计。此阶段仍只允许 founder 实际使用 DSH。

### Phase 2：授权网关、执行隔离与部署基线

旁路入口、principal、Policy、全 API/下载/附件/实时过滤、线性化撤销、compatibility guard，以及 per-workspace Tool/文件/凭据隔离或隔离 DSH worker。同时完成 TLS/canonical origin、Secure Cookie、reverse proxy、持久限流、原端口 loopback、本地文件权限和加密备份恢复基线。此阶段仍只允许 founder 实际使用，测试账户不得连接生产数据。

### Phase 3：工作区、Holder 与多人启用门槛

成员管理、owner/member/guest、Holder 创建/转移/自动接管、ungrouped/quarantine、离开/解散流程及 Client UI。

唯一的 **Multi-user Enablement Gate** 位于 Phase 3 末：Phase 1-3 的授权、泄漏、执行隔离、线性化撤销、迁移/恢复、TLS/origin/Cookie、持久限流、本地秘密和备份检查必须全部通过，才能创建或启用第二个真实用户。其他章节提到“第二用户”时均引用此门槛，不另设较弱条件。

### Phase 4：增强认证

TOTP、恢复码、passkey、密钥轮换体验和可选的额外外网防护。TOTP/passkey 默认关闭，因此它们的实现不是启用基础密码多人模式的前置条件；一旦管理员开启，对应 Phase 4 测试和生产检查必须先通过。

## 17. 可观测性与运维

- 启动报告 DSH compatibility、数据库 migration、网关 bind、canonical URL 与 Secure Cookie 状态；
- 日志只使用 user/workspace/session id，不记录 secret；
- 管理员可查看 outbox dead-letter、blocked saga、兼容失败和最近安全事件；
- 提供 SQLite 一致性检查与备份说明；
- 原 DSH 端口暴露检测为 fatal；
- readiness 仅在数据库、策略和入口保护全部就绪后成功。

## 18. 风险与缓解

- **DSH 升级改变内部形状**：版本锁定、manifest、startup fail closed、契约测试。
- **原端口绕过**：loopback-only、防火墙、启动检查和部署文档。
- **全量实时流泄漏**：旁路服务端 fan-out，不在浏览器过滤。
- **跨存储部分失败或 DSH 内部创建资源**：operation journal、DSH 返回 ID、持续 reconciliation、quarantine unmapped、隐藏 pending。
- **身份规范化冲突**：迁移前报告并要求管理员解决。
- **WebAuthn 域名变化**：canonical URL/RP ID 配置不可静默改变，变更需迁移确认。
- **共享 OS 进程能力过大**：应用授权不能被描述为 OS 沙箱；workspace 创建路径必须受控，敏感 Host 能力只给 admin 或保持 blocked。
- **邮件不可用**：outbox 重试，账户变更不依赖同步 SMTP；管理员可查看失败状态。

## 19. 验收门槛

- 所有测试类别通过；
- compatibility manifest 与当前 DSH 完全匹配；
- 原 DSH 仅 loopback 可达；
- 未授权 API、附件、递归导出和 WS 测试均无泄漏；
- 非 admin Agent 的工具执行已证明不能越过所属工作区，或该执行能力保持 blocked；
- 禁用/降权与并发请求/发送按授权 epoch 线性化，旧连接在 commit 后不能再执行或收到 frame；
- DSH 内部、subagent、fork 和 custom Remote 产生的未知资源持续隔离；
- migration 与 crash recovery 演练通过；
- teams 目录、SQLite/WAL/SHM、备份与 secret 的本地权限、symlink 和恢复/轮换检查通过；
- TLS、Secure Cookie、canonical URL 和备份策略在生产检查中通过；
- 在此之前不启用第二个真实用户。
