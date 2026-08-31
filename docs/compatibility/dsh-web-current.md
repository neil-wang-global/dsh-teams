# DSH Web Surface Inventory

## Profile Contract

- Snapshot schema: `1`
- Canonical fixture bundle: `@deepseek-ai/dsh-web-app@0.1.1-rc.2`
- Live runtime core: DSH CLI, connection, and webserver packages `0.1.1-rc.1` at `http://localhost:3080`
- Canonical fixture: `tests/fixtures/dsh-profile/current.json`
- Profile input: `DSH_PROFILE_DIR/dsh-web-profile.json` only. The scanner has no user-profile fallback.

The canonical fixture inventory records `@deepseek-ai/dsh-base@0.1.1-rc.2`, `@deepseek-ai/dsh-web-app@0.1.1-rc.2`, `dsh-plugin-sandbox-escalation-fix@0.1.1`, `dsh-notification@0.1.3`, `@linxin666/dsh-web-ui-all@0.2.8`, `dsh-pocket@2.10.0`, `dsh-auth-gate@0.7.2`, `dsh-deeptutor@0.1.9`, and `pomasa-studio@0.1.0`. `dsh-auth-gate` is installed profile infrastructure, not a `dsh-teams` dependency; its identity data is neither imported nor shared.

`Covered` means the surface has a versioned inventory and policy classification. It does not claim interception proof, which remains the DT-0-03 gate.

## Service Observations

| Service | Observed signature | Disposition |
| --- | --- | --- |
| `apiProxy` | `POST /api/:method`; upgrades at `/api/events.mux` and `/api/events.host` | Core carrier contract proven; HTTP RPC interception does not cover event upgrades |
| `webServer` | `register(route)`, `registerUpgrade(route)` | One handler per named path; no public middleware, observer, or replacement API |

## Surface Disposition

| Kind | Surface | Disposition | Classification or reason |
| --- | --- | --- | --- |
| HTTP | `HEAD /api/session.export` | Blocked | The header action probes the export URL with `sessionId` and `includeDescendants=true` before download |
| HTTP | `GET /api/session.export` | Blocked | The browser then downloads the Session ZIP from the same export URL; descendant logs and attachments are in scope |
| HTTP | `POST /api/:method` | Blocked | Source-confirmed core RPC carrier; the current no-credential carrier probe reaches it (`415` without JSON), and a valid `session.list` envelope returned `200` |
| HTTP | `POST /sidebar/api/:method` | Blocked | Source-confirmed sidebar RPC carrier |
| HTTP | `GET /sidebar/file` | Blocked | Source-confirmed download route with `sessionId`, `path`, optional `cwd`, and `download=1` query fields |
| HTTP | `GET /sidebar/html` | Blocked | Source-confirmed physical route |
| HTTP | `GET /sidebar/bundle` | Blocked | Source-confirmed physical route |
| WebSocket | `/sidebar/ws/terminal` | Blocked | Source-confirmed physical route |
| WebSocket | `/sidebar/ws/agent-terminals` | Blocked | Source-confirmed physical route |
| WebSocket | `/api/events.mux` | Blocked | Source-confirmed core event carrier; a no-credential standard upgrade returned `101` |
| WebSocket | `/api/events.host` | Blocked | Source-confirmed core event carrier; a no-credential standard upgrade returned `101` |
| Client slot | `conversation.session.header.utilities` | Covered | Source-confirmed extension slot |
| Resource creation | `session.create` | Blocked | Reaches the source-confirmed `POST /api/:method` core carrier |
| Resource creation | `workspace.create` | Blocked | Reaches the source-confirmed `POST /api/:method` core carrier |

## Data-Plane Decision

**`sidecar-required` for the data plane.** The required core event WebSockets register directly through `webServer.registerUpgrade`. The public registry permits one handler for each path and rejects a duplicate; it exposes no interception or replacement seam. The only shared interception facility, `ctx.connection.rpc.intercept('/api', ...)`, applies to HTTP RPC endpoints and cannot filter either event upgrade or its frames.

The no-credential runtime audit reached both WebSocket paths with `101`; the raw listener is therefore not an authorization boundary. A supported registration-time capture cannot repair this missing filtering seam, and private route-table mutation is not accepted as proof. The sidecar must be the only multi-user entry point; raw DSH stays loopback-only and every sidecar route remains blocked until classified and implemented.

The fixture retains `dsh.runtime-registration-inventory` and upstream-contract candidate `DSH-RUNTIME-REGISTRATION-INVENTORY` as a profile-drift signal. It is deferred for the rejected in-process architecture, not treated as an implicit allow.

## Evidence Records

| Source | Observation | Reproduction |
| --- | --- | --- |
| Browser live page | Session export triggers a browser download; the current loopback root returns `200` without an authentication challenge. | Open an authenticated session and export its log; request the loopback root without credentials. |
| Installed package inventory | The live DSH CLI, connection, and webserver packages are `0.1.1-rc.1`; the canonical fixture remains the prior `0.1.1-rc.2` test profile. | Read the installed package manifests and the profile manifest without recording configuration values. |
| Source inspection | `dsh-client-connection` registers `/api/events.mux` and `/api/events.host` directly; `webServer` permits one upgrade handler per path, and the RPC interceptor applies only to HTTP dispatch. | Inspect the installed connection and webserver public source and declarations. |
| Runtime carrier audit | The current no-credential runtime reached each HTTP carrier (`415` for missing JSON content type) and accepted both standard WS upgrades (`101`). The audit exits nonzero for any non-`401`/`403` result. | `DSH_RUNTIME_URL=http://127.0.0.1:3080 npm run probe:runtime` |
| Read-only RPC probe | A valid no-credential `session.list` envelope returned `200`; its body was not retained. | POST a conforming `client-request` envelope to `/api/session.list`, discard the response body, and record only status and byte count. |
