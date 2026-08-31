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
| `apiProxy` | `POST /api/:method`; upgrades at `/api/events.mux` and `/api/events.host` | Core carrier contract proven; plugin registration inventory remains pending |
| `webServer` | `register(route)`, `registerUpgrade(route)` | Covered |

## Surface Disposition

| Kind | Surface | Disposition | Classification or reason |
| --- | --- | --- | --- |
| HTTP | `HEAD /api/session.export` | Blocked | The header action probes the export URL with `sessionId` and `includeDescendants=true` before download |
| HTTP | `GET /api/session.export` | Blocked | The browser then downloads the Session ZIP from the same export URL; descendant logs and attachments are in scope |
| HTTP | `POST /api/:method` | Blocked | Source-confirmed core RPC carrier; an unauthenticated runtime probe returned `401` for `session.list`, `session.search`, and `workspace.create` |
| HTTP | `POST /sidebar/api/:method` | Blocked | Source-confirmed sidebar RPC carrier |
| HTTP | `GET /sidebar/file` | Blocked | Source-confirmed download route with `sessionId`, `path`, optional `cwd`, and `download=1` query fields |
| HTTP | `GET /sidebar/html` | Blocked | Source-confirmed physical route |
| HTTP | `GET /sidebar/bundle` | Blocked | Source-confirmed physical route |
| WebSocket | `/sidebar/ws/terminal` | Blocked | Source-confirmed physical route |
| WebSocket | `/sidebar/ws/agent-terminals` | Blocked | Source-confirmed physical route |
| WebSocket | `/api/events.mux` | Blocked | Source-confirmed core event carrier; an unauthenticated runtime probe returned `401` for its upgrade request |
| WebSocket | `/api/events.host` | Blocked | Source-confirmed core event carrier; an unauthenticated runtime probe returned `401` for its upgrade request |
| Client slot | `conversation.session.header.utilities` | Covered | Source-confirmed extension slot |
| Resource creation | `session.create` | Blocked | Reaches the source-confirmed `POST /api/:method` core carrier |
| Resource creation | `workspace.create` | Blocked | Reaches the source-confirmed `POST /api/:method` core carrier |

## Blocked Introspection Contract

The snapshot contains the explicit blocked entry `dsh.runtime-registration-inventory`, with upstream-contract candidate `DSH-RUNTIME-REGISTRATION-INVENTORY`. The DSH core carrier contract is known, but the composed plugin runtime can add registrations dynamically. Phase 0 must capture every `webServer.register`, `webServer.registerUpgrade`, and generic RPC registration while composing the configured profile, then deny-probe every captured carrier.

Until that registration-time inventory exists, the data-plane assessment is `runtime-inventory-required`, not `in-process-covered` and not `sidecar-required`. A captured route that bypasses the selected adapter remains an architecture failure and selects `sidecar-required`. The compatibility check fails when discovery adds or removes a surface, changes the DSH Web version, or changes an observed service signature.

## Evidence Records

| Source | Observation | Reproduction |
| --- | --- | --- |
| Browser live page | Session export triggers a browser download; the unauthenticated root returns `401` with `no-store`. | Open an authenticated session and export its log; request the unauthenticated root. |
| Installed package inventory | The installed packages and versions match the canonical fixture. | Read the installed package inventory from the configured DSH profile. |
| Source inspection | `apiProxy` uses `POST /api/:method`, with event upgrades at `/api/events.mux` and `/api/events.host`. The sidebar registers its HTTP and WebSocket routes, while the export client performs the `HEAD` then browser download flow. | Inspect DSH Web service registrations, client transport constants, and extension declarations. |
| Runtime carrier probe | The unauthenticated standard runtime returned `401` for the three concrete RPC paths and both core event upgrade paths. | `DSH_RUNTIME_URL=http://127.0.0.1:3080 npm run probe:runtime` |
