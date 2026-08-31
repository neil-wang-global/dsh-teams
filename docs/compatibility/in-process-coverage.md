# In-Process Interception Coverage

## Decision

**Data-plane decision: `runtime-inventory-required`.**

DSH 0.1.1-rc.2 has a proven core carrier contract: `POST /api/:method`, plus WebSocket upgrades at `/api/events.mux` and `/api/events.host`. A no-credential probe against the standard runtime returned `401` for concrete `session.list`, `session.search`, and `workspace.create` RPC paths and both event upgrade paths. The prior `sidecar-required` conclusion was based on a disposable fixture that omitted these known core carriers and is superseded.

This is not proof that one in-process adapter reaches every dynamically registered plugin route. It does not enable multi-user mode, pass Gate A, or establish execution isolation. DT-0-02 and DT-0-03 remain in progress until a composed runtime registration inventory is captured and deny-probed. DT-0-04 remains responsible for the separate execution-plane decision.

## Profile And Harness

- Observed profile: `@deepseek-ai/dsh-web-app@0.1.1-rc.2`.
- Inventory input: `tests/fixtures/dsh-profile/current.json`.
- Harness: `DisposableProbeServer` on an ephemeral `127.0.0.1` port with `FiberProbeAdapter`, plus a no-credential runtime carrier probe.
- Recorded metadata: surface kind, identifier, optional stream mode, and interception outcome only.

The disposable harness validates adapter behavior for the committed inventory. The runtime probe validates only carrier reachability and default denial; it records no request body, credentials, headers, response body, or response bytes. Neither probe replaces registration-time inventory capture for dynamically composed plugins.

## Reproducible Transcript

Run:

```sh
npm test --workspace @dsh-teams/probe -- --test-name-pattern='disposable profile|raw route|incremental frame'
DSH_RUNTIME_URL=http://127.0.0.1:3080 npm run probe:runtime
```

The disposable current-profile run produces these adapter-denial transcripts:

| Surface | Outcome |
| --- | --- |
| `GET /api/session.export` | `intercepted-denied` |
| `HEAD /api/session.export` | `intercepted-denied` |
| `POST /api/:method` | `intercepted-denied` |
| `POST /sidebar/api/:method` | `intercepted-denied` |
| `GET /sidebar/file` | `intercepted-denied` |
| `GET /sidebar/html` | `intercepted-denied` |
| `GET /sidebar/bundle` | `intercepted-denied` |
| `/sidebar/ws/terminal` upgrade | `intercepted-denied` |
| `/sidebar/ws/agent-terminals` upgrade | `intercepted-denied` |
| `/api/events.mux` upgrade | `intercepted-denied` |
| `/api/events.host` upgrade | `intercepted-denied` |

The live no-credential runtime probe produced these default-denial results:

| Carrier | Outcome |
| --- | --- |
| `POST /api/session.list` | `401` |
| `POST /api/session.search` | `401` |
| `POST /api/workspace.create` | `401` |
| `/api/events.mux` upgrade | `401` |
| `/api/events.host` upgrade | `401` |

The runner selects `runtime-inventory-required` because the core carriers are known but the complete runtime registration inventory has not yet been captured. The dedicated bypass probes still show that a duplicate raw `GET /sidebar/file` registration and an unregistered raw route return `200` without adapter denial. Each produces a `bypassed` transcript and would select `sidecar-required` for an actual composed runtime. A connection established while the adapter is allowed receives no incremental frame after the adapter is revoked; the rejected frame is recorded as `websocket /sidebar/ws/terminal incremental` with `intercepted-denied`.

## Required Follow-Up

Instrument a disposable composed DSH runtime before plugins register. Capture every `webServer.register`, `webServer.registerUpgrade`, and generic RPC registration, add the resulting routes to the inventory, and deny-probe every captured carrier. Select `in-process-covered` only if every resulting route is intercepted with no bypass; select `sidecar-required` for any bypass. Keep the raw DSH listener loopback-only and every uncaptured route blocked until then.
