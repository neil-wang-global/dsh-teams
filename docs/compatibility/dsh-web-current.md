# DSH Web Surface Inventory

## Profile Contract

- Snapshot schema: `1`
- Observed DSH Web bundle: `@deepseek-ai/dsh-web-app@0.1.0-rc.6`
- Canonical fixture: `tests/fixtures/dsh-profile/current.json`
- Profile input: `DSH_PROFILE_DIR/dsh-web-profile.json` only. The scanner has no user-profile fallback.

The observed bundle list contains `@deepseek-ai/dsh-web-app@0.1.0-rc.6` and records that `@deepseek-ai/dsh-auth-gate@0.1.0-rc.6` may be installed. In either case, `dsh-auth-gate` is not used by `dsh-teams`; its identity data is neither imported nor shared.

`Covered` means the surface has a versioned inventory and policy classification. It does not claim interception proof, which remains the DT-0-03 gate.

## Service Signatures

| Service | Observed signature | Disposition |
| --- | --- | --- |
| `typertGateway` | `invoke(request)` | Covered |
| `webServer` | `register(route)`, `registerUpgrade(route)` | Covered |

## Surface Disposition

| Kind | Surface | Disposition | Classification or reason |
| --- | --- | --- | --- |
| HTTP | `GET /attachments/:attachmentId` | Blocked | `blocked` until byte-level attachment interception is proved |
| HTTP | `GET /sessions/:sessionId/export` | Blocked | `blocked` until descendant closure and export repacking are proved |
| HTTP | `POST /api` | Covered | `public-authenticated` carrier; RPC method authorization remains separate |
| RPC | `session.export` | Blocked | `blocked` until archive traversal is covered |
| RPC | `session.list` | Covered | `workspace-visible-read` |
| RPC | `session.search` | Blocked | `blocked` until workspace filtering is proved |
| RPC | `workspace.create` | Covered | `owner-write` |
| RPC | `workspace.members.list` | Covered | `workspace-visible-read` |
| WebSocket | `/events` baseline | Requires upstream clarification | `blocked` until the baseline stream registry is introspectable |
| WebSocket | `/events` incremental | Requires upstream clarification | `blocked` until incremental frame registration is introspectable |
| Client slot | `app.sidebar.footer` | Covered | Slot is available for controlled diagnostics wiring |
| Client slot | `session.toolbar` | Requires upstream clarification | Slot ownership and ordering require an upstream contract |
| Resource creation | `attachment.attach` | Blocked | Attachment ownership mapping is not yet proven |
| Resource creation | `session.create` | Covered | Session creation is inventoried for later pre-allocation |
| Resource creation | `session.fork` | Requires upstream clarification | Parent lineage contract is not yet available |
| Resource creation | `workspace.create` | Covered | Workspace creation is inventoried for later operation journaling |

## Blocked Introspection Contract

No public runtime registry exposes the complete DSH route, upgrade, baseline-stream, or incremental-stream inventory. The snapshot therefore contains the explicit blocked entry `dsh.route-stream-introspection`, with upstream-contract candidate `DSH-ROUTE-STREAM-INTROSPECTION`.

The requested contract must enumerate named HTTP routes with methods, upgrade paths, stream modes, owning bundle, and service signature before Phase 0 can treat an unobserved entry as anything other than blocked. The compatibility check fails when discovery adds or removes a surface, changes the DSH Web version, or changes an observed service signature.
