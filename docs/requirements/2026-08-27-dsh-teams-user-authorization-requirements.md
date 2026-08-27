# DSH Teams 用户与权限需求文档

> **生成时间**: 2026-08-27
> **关联 Issue**: [#1](https://github.com/neil-wang-global/dsh-teams/issues/1)
> **状态**: 已确认，待实现

## 项目目标

在不修改 DSH 的前提下，为 DSH Web 增加默认单租户的团队账户、工作区成员和会话 Holder 权限体系。系统必须在 Host 或旁路网关边界执行授权，阻止通过直接 API、附件、导出或实时事件流产生的越权访问。

## 目标用户

- Founder admin：首次安全注册的受保护系统管理员。
- Admin：管理账户、本站设置、安全能力及全部工作区与会话。
- User：被管理员创建的普通系统用户，只能访问受邀工作区。
- Workspace owner/member/guest：独立于系统角色的工作区权限。

## 功能需求

### P0 - 核心功能

- 系统默认为单租户，不提供租户创建、切换或跨租户能力。
- 空系统首次注册者成为 founder admin；founder 不可禁用、删除或降级。
- 邮箱是唯一登录账户，管理员创建后续用户，不开放公众自助注册。
- 管理员可配置本站规范 URL、邮件 provider 和 SMTP。
- 管理员可选择系统生成临时密码并发邮件，或亲自设置临时密码并获取一次性可复制的账户/密码文本。
- 所有临时密码首次登录后必须重设；完成前只能访问改密、登出和自身安全状态。
- 管理员可重设密码；旧会话立即失效，页面只显示一次新凭据，并发送不含新密码的通知邮件。
- 管理员可禁用、解禁用户和修改 `admin`/`user` 系统角色；操作写审计并发送邮件。
- 所有登录用户可查看全站公开成员目录。
- 通用设置和账户管理仅 admin 可访问。
- System admin 无需工作区成员身份即可查看和操作全部工作区与会话。
- System user 只能看到已加入的工作区。
- 任一 active、已完成首次改密的用户可在管理员分配的受控工作区根目录下创建工作区并自动成为 owner；普通用户不能采用任意 Host 路径。
- 工作区角色为 `owner`、`member`、`guest`，创建者自动成为 owner。
- owner/admin 可管理成员、工作区角色、成员移除和工作区解散。
- owner 离开后必须仍有其他 owner；member 与 guest 可直接离开。
- owner/admin 可创建和操作工作区全部会话。
- member 可创建会话、操作自己 Hold 的会话，并只读查看其他会话。
- guest 只能只读查看全部会话，不能创建、操作或 Hold 会话。
- 新会话 Holder 为创建者。owner/member/admin 只能主动转移自己 Hold 的会话，目标必须是该工作区 owner/member 或 system admin。
- Holder 被禁用、移出、降为 guest，或 admin 降级后不再具备工作区资格时，系统自动将其会话转给一个有效 owner；ungrouped 会话转给 founder；选择规则必须确定、可审计。
- DSH 内部、subagent、fork 或 custom Remote 产生但尚无权限映射的资源必须保持 quarantine，不出现在列表、搜索、导出或实时流。
- 未登录返回 401；不可见资源统一返回 404；可见但无动作权限返回 403。
- 对列表、搜索、历史、附件、导出、实时事件和所有写操作执行服务端授权。

### P1 - 重要功能

- 管理员分别启用或关闭 TOTP 与 passkey 登录能力，用户自愿绑定。
- TOTP 支持恢复码、secret 加密和防重放。
- Passkey 支持稳定 RP ID、规范 HTTPS origin、短期 challenge 和凭据计数器。
- 邮件采用 provider 抽象，第一版交付 SMTP provider。
- 账户、角色、成员、Holder、安全因子和工作区生命周期操作进入审计日志。
- 邮件通过事务 outbox 异步发送并支持重试。
- 用户禁用、改密或权限版本变化后，HTTP 会话与 WebSocket 立即失效。

### P2 - 后续增强

- 增加 Resend、SendGrid 等邮件 API provider。
- 数据保留、工作区彻底清理及审计归档策略。
- 多租户能力仅在另立需求和迁移设计后考虑。

## 集成需求

- DSH Web：优先通过 Cordis Plugin 接入现有 Host 服务与 Client Slot。
- 旁路网关：Plugin 无法安全覆盖入口时，由 Plugin 生命周期拉起，代理 DSH 静态内容、HTTP RPC 与 WebSocket。
- SQLite：保存账户、权限、Holder、outbox、审计和操作日志。
- SMTP：第一版邮件发送实现。
- TOTP：使用维护中的标准实现。
- WebAuthn/passkey：使用维护中的服务端与浏览器实现。

## 约束条件

- 第一优先级是零修改 DSH。
- 原始 DSH 监听必须保持 loopback-only，不允许用户绕过授权网关。
- Plugin 无法可靠授权时，允许拉起旁路 Web 与旁路数据库。
- 旁路仍不能保证安全时，相关能力必须关闭，并与 DSH 沟通最小通用授权接缝。
- 未完成工作区角色、Holder、全入口授权、实时泄漏和 Agent 执行面隔离测试前，不开放第二个真实用户。
- 非 admin Agent 的工具、文件、凭据与 Host 能力必须被限制在所属工作区；无法证明隔离时保持 blocked。
- 前端隐藏按钮不构成授权。
- 当前范围不支持多租户。

## 成功标准

- 角色 × 资源关系 × action 的策略矩阵有完整自动化测试。
- 猜测 ID、伪造 RPC、绕过 UI、附件与导出访问不能跨工作区边界。
- 附件与递归导出的完整 descendant closure 不能包含不可见或未映射会话。
- WebSocket 基线与增量流不包含未授权事件；降权提交后不存在旧授权发送窗口。
- 禁用、降权、移除和 Holder 转移与并发请求按授权 epoch 线性化；每个响应字节、download chunk 和 stream frame 发送前重验当前授权，提交后不再释放旧授权数据。
- founder、最后 owner、guest 不可 Hold、自动接管等不变量在并发下成立。
- 跨 SQLite/DSH 操作在崩溃恢复后不会产生对用户可见的孤儿资源。
- 未识别的新 DSH API method 默认拒绝。

## 附录：原始输入

> 默认单租户，暂时不支持多租户。账户系统，管理员->成员。管理员可以管理账户。
>
> 第一次登录 DSH，先注册者为系统管理员（admin）。管理员配置本站域名和 email。管理员注册用户，用户必须有邮箱；可选择发送包含账户、初始化密码和登录链接的邮件，也可由管理员亲自设置密码并复制账户和密码。用户第一次登录必须重设密码。
>
> 管理员可重设用户密码、禁用/解禁用户、修改 admin/user 级别，并按规则发送通知邮件。管理员可开启或关闭 2FA 与 passkey，用户可自行添加。通用设置仅管理员访问。
>
> 用户可添加工作区，管理员可查看全部工作区，成员只能查看相关工作区。工作区创建者为 owner；工作区角色为 owner/member/guest。owner/admin 管理成员、角色和移除。所有用户默认可查看成员列表。
>
> 会话有 Holder，创建者为 Holder。owner/admin 可操作全部会话；member 可新增会话并只读查看他人会话；guest 只读。会话可转移，guest 不可 Hold。普通 user 只能看到被邀请的工作区。
>
> member/guest 可离开；owner 离开时必须仍有其他 owner；owner 可解散工作区。权限系统必须可靠返回 403 或 404。

## 已确认澄清

- 邮箱即登录账户。
- 无论密码由系统生成还是管理员亲设，首次登录都强制改密。
- 初始管理员是不可降级、不可禁用的 founder admin。
- TOTP/passkey 是全站功能开关，用户自愿绑定；2FA 第一版为 TOTP。
- 邮件层采用 provider 抽象，第一版仅实现 SMTP。
- owner 离开时检查是否仍有其他 owner。
- owner/admin/member 都只能主动转移自己 Hold 的会话。
- Holder 失效时自动转给任一有效 owner，实现采用确定性选择。
- 存量工作区和会话全部归 founder admin。
