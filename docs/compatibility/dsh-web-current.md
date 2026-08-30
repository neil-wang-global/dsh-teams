# DSH Web Surface Inventory

## Profile Contract

- Snapshot schema: `1`
- Observed DSH Web bundle: `@deepseek-ai/dsh-web-app@0.1.1-rc.2`
- Canonical fixture: `tests/fixtures/dsh-profile/current.json`
- Profile input: `DSH_PROFILE_DIR/dsh-web-profile.json` only. The scanner has no user-profile fallback.

The observed installed-package inventory records `@deepseek-ai/dsh-base@0.1.1-rc.2`, `@deepseek-ai/dsh-web-app@0.1.1-rc.2`, `dsh-plugin-sandbox-escalation-fix@0.1.1`, `dsh-notification@0.1.3`, `@linxin666/dsh-web-ui-all@0.2.8`, `dsh-pocket@2.10.0`, `dsh-auth-gate@0.7.2`, `dsh-deeptutor@0.1.9`, and `pomasa-studio@0.1.0`. `dsh-auth-gate` is installed profile infrastructure, not a `dsh-teams` dependency; its identity data is neither imported nor shared.

`Covered` means the surface has a versioned inventory and policy classification. It does not claim interception proof, which remains the DT-0-03 gate.

## Service Observations

| Service | Observed signature | Disposition |
| --- | --- | --- |
| `apiProxy` | No physical route registration | Covered as a transport-agnostic service only |
| `webServer` | `register(route)`, `registerUpgrade(route)` | Covered |

## Surface Disposition

| Kind | Surface | Disposition | Classification or reason |
| --- | --- | --- | --- |
| HTTP | `HEAD /api/session.export` | Blocked | The header action probes the export URL with `sessionId` and `includeDescendants=true` before download |
| HTTP | `GET /api/session.export` | Blocked | The browser then downloads the Session ZIP from the same export URL; descendant logs and attachments are in scope |
| HTTP | `POST /sidebar/api/:method` | Blocked | Source-confirmed physical route; `apiProxy` transport remains unclassified |
| HTTP | `GET /sidebar/file` | Blocked | Source-confirmed download route with `sessionId`, `path`, optional `cwd`, and `download=1` query fields |
| HTTP | `GET /sidebar/html` | Blocked | Source-confirmed physical route |
| HTTP | `GET /sidebar/bundle` | Blocked | Source-confirmed physical route |
| WebSocket | `/sidebar/ws/terminal` | Blocked | Source-confirmed physical route |
| WebSocket | `/sidebar/ws/agent-terminals` | Blocked | Source-confirmed physical route |
| RPC | `session.list`, `session.search`, `workspace.create` | Requires upstream clarification | Source-confirmed `apiProxy` methods, but the physical carrier has no route registration |
| WebSocket | unresolved DSH stream carrier, baseline | Requires upstream clarification | Source includes baseline frames, but no live carrier URL is registered |
| WebSocket | unresolved DSH stream carrier, incremental | Requires upstream clarification | Incremental frame delivery needs the same upstream carrier contract |
| Client slot | `conversation.session.header.utilities` | Covered | Source-confirmed extension slot |
| Resource creation | `session.create` | Requires upstream clarification | Source-confirmed behind transport-agnostic `apiProxy` |
| Resource creation | `workspace.create` | Requires upstream clarification | Source-confirmed behind transport-agnostic `apiProxy` |

## Blocked Introspection Contract

No confirmed carrier or contract exposes the complete DSH stream inventory. The snapshot therefore contains the explicit blocked entry `dsh.stream-carrier-introspection`, with upstream-contract candidate `DSH-STREAM-CARRIER-CONTRACT`. It records baseline and incremental mode coverage against an explicitly unresolved carrier; it does not infer an `/events` route.

The requested contract must enumerate stream carriers, stream modes, owning bundle, and service signature before Phase 0 can treat an unobserved entry as anything other than blocked. The compatibility check fails when discovery adds or removes a surface, changes the DSH Web version, or changes an observed service signature.

## Evidence Records

| Source | Observation | Reproduction |
| --- | --- | --- |
| Browser live page | Session export triggers a browser download; the unauthenticated root returns `401` with `no-store`. | Open an authenticated session and export its log; request the unauthenticated root. |
| Installed package inventory | The installed packages and versions match the canonical fixture. | Read the installed package inventory from the configured DSH profile. |
| Source inspection | `webServer` and `apiProxy` are present; `apiProxy` registers no physical routes. The sidebar registers its HTTP and WebSocket routes, while the export client performs the `HEAD` then browser download flow. | Inspect DSH Web service registrations and extension declarations. |
