# DSH Teams 实施 Tasking 文档设计

> 日期：2026-08-27
> 状态：待用户审阅
> 关联 Issue：[GitHub #3](https://github.com/neil-wang-global/dsh-teams/issues/3)
> 上游设计：[DSH Teams 单租户账户与授权设计](2026-08-27-dsh-teams-user-authorization-design.md)

## 1. 目标

建立一份版本化、依赖有序的实施 tasking 文档，将已批准的 DSH Teams 设计转化为可独立验证的原子任务。该文档是后续实施工作的唯一计划来源；GitHub Issue 仅在某个已定义任务准备执行时创建，用于执行跟踪，不复制或改写任务规范。

## 2. 范围与不变量

Tasking 文档必须保留以下不可突破的边界：

- 不修改 DSH 源码。
- 先证明 in-process Cordis Plugin 可以可靠覆盖全部入口；任何覆盖缺口都使多人模式保持关闭，并触发 Plugin 管理的旁路网关评估。
- 旁路仍无法证明 Agent/Tool、文件、凭据和 Host 能力按工作区隔离时，采用隔离 DSH worker；若仍无法证明，关闭该能力并向 DSH 上游提出最小通用接缝。
- `dsh-teams` 独立拥有账户、凭据、登录会话、MFA 和授权，不依赖或双写 `dsh-auth-gate`。
- 未映射资源、未知 API/stream 和未证明可隔离的执行能力一律 fail closed。
- Phase 1-3 的 Baseline Multi-user Enablement Gate 是第二个真实用户的唯一启用门槛；TOTP/passkey 属于默认关闭的 Phase 4 条件能力。

## 3. 文档位置与结构

后续产物位于：

```text
docs/superpowers/plans/2026-08-27-dsh-teams-implementation-tasking.md
```

文档依次包含：

1. 计划状态、关联 Issue 和上游需求/设计链接；
2. 总体依赖图和明确的 go/no-go gate；
3. Phase 0 到 Phase 4 的任务表；
4. 横向验证与运维任务表；
5. 延期项、已知外部阻塞和上游 DSH 接缝请求模板；
6. 任务状态汇总规则。

任务按依赖而非文件或组件名称排序。Phase 内允许并行的任务必须显式列出互不依赖的前提；没有声明为可并行的任务默认按表中顺序执行。

## 4. 原子任务模型

每条任务使用稳定 ID `DT-<phase>-<sequence>`，例如 `DT-0-01`。每条均包含：

| 字段 | 要求 |
|---|---|
| 任务 | 可交付结果，而非泛化活动，例如“建立 manifest 探针”，而不是“研究 API”。 |
| 目的 | 此任务消除的能力缺口或安全风险。 |
| 依赖 | 已完成的任务 ID；没有依赖时写“无”。 |
| 来源 | 需求或设计文档的具体章节。 |
| 产出 | 预期代码、配置、文档或测试资产。 |
| 完成检查 | 可重复执行的测试、探针、审查或运维检查。 |
| 失败处置 | 失败时保持关闭、转入旁路/worker 评估，或提交上游接缝请求。 |
| 状态 | `not-started`、`in-progress`、`blocked`、`complete`、`deferred` 之一。 |

一个任务只应交付一个可验证的能力边界。若完成检查需要多个互不相关的系统变化，tasking 文档必须拆分该任务。

## 5. 分期与关键路径

### Phase 0：能力发现与架构裁决

覆盖 DSH 版本锁定、compatibility manifest、HTTP/download/attachment/WS/stream 探针、Client Slot 可用性、Plugin 生命周期、以及执行面隔离接缝的证据。此阶段输出唯一的模式裁决：in-process、旁路网关、隔离 worker，或保持单用户并提出 DSH 接缝请求。

**Gate A - 多人实现前提：** 未得到入口不可绕过和执行隔离的可复现实证前，不得启用第二个真实用户、向非 founder 暴露多人数据面，或把未证明的入口标记为可用能力。

### Phase 1：身份、数据库与基础运维

覆盖 SQLite 安全初始化、schema/migration、bootstrap、密码与会话、管理员账户生命周期、SMTP outbox、审计、秘密管理、备份与本地文件权限。该阶段仍只允许 founder 使用 DSH。

### Phase 2：统一授权与受控入口

覆盖 principal、Policy、资源映射、授权 epochs、撤销线性化、HTTP/RPC/download/attachment/search/export 和实时流过滤、compatibility guard、TLS/origin/Cookie、持久化限流以及选定网关或 worker 路径。每一个 DSH method/stream 必须分类或 blocked。

### Phase 3：工作区与多人启用

覆盖 managed roots/grants、工作区成员角色、Holder、quarantine、saga/reconciliation、迁移、工作区解散/恢复、Client UI 和完整的安全回归。完成本阶段后才能评估基线多人启用。

**Gate B - Baseline Multi-user Enablement Gate：** Phase 0-3 的入口覆盖、密码认证、策略、泄漏、执行隔离、撤销、迁移/恢复、TLS/origin/Cookie、限流、存储秘密和备份检查均通过，才可创建或启用第二个真实用户。

### Phase 4：条件安全因子

覆盖 TOTP、恢复码、passkey、因素开关、recent-auth、WebAuthn ceremony 和 key rotation。它不阻塞 Gate B；任何启用的因素必须完成自身测试和生产检查后才能向用户开放。

**Gate C - Factor Production Gate：** 仅在某一因素已开启时生效，要求该因素的生命周期、攻击面和恢复测试通过。

### 横向任务

横向表覆盖测试数据、审计/可观测性、部署 runbook、故障演练、性能和 release readiness。这些任务可跨阶段执行，但其完成检查必须被相关 gate 引用，不能以“文档已写”替代安全验证。

## 6. 依赖与状态规则

- `complete` 只在完成检查有记录时使用。
- `blocked` 必须写明外部条件、最后一次验证日期和下一步决策者。
- `deferred` 必须说明不影响哪个 gate，及重新评估触发条件。
- Gate 不得因部分完成、手工例外或 UI 隐藏而通过。
- 旁路或 worker 任务只在前一模式的证据失败后激活；它们不与 Plugin-first 路径并行假设为已选定架构。
- 上游接缝请求必须附带最小复现、受影响入口、威胁模型、当前失败证据和所需最小 API/Hook 合同。

## 7. 测试和验收表达

Tasking 文档中的完成检查必须引用或新增以下类别之一：

- 兼容性/覆盖探针；
- Policy 单元与角色矩阵；
- 直接 API/RPC 集成；
- HTTP/download/attachment/export/WS 泄漏测试；
- 授权 epoch 与并发撤销竞态；
- saga、quarantine、migration 和 crash recovery；
- Agent/Tool/文件/凭据执行面隔离；
- MFA/passkey 生命周期；
- 存储权限、秘密、备份和恢复演练；
- 生产部署和 readiness 检查。

每个 Gate 都应回链到确切的任务 ID 和其完成检查，避免“所有测试通过”这类不可审计的结论。

## 8. 非目标

本 tasking 文档不实现 DSH Teams 功能，不创建大量预先分配的 GitHub 子 Issue，不改变已批准需求或架构，也不把 P2 多租户或未来邮件 provider 纳入基线关键路径。

## 9. 审阅标准

在创建实施 tasking 文档前，本设计必须满足：

- 每个上游设计 Phase 都有清晰的 tasking 归属；
- Gate A、Gate B 和 Gate C 的前置条件和失败处置可区分；
- 原子任务字段足以让后续执行者在不猜测架构状态的情况下开始工作；
- Plugin-first、独立认证和 fail-closed 约束在所有 fallback 路径中一致；
- 未出现 `TBD`、`TODO` 或未定义的状态含义。
