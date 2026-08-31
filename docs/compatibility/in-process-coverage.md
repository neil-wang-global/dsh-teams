# In-Process Interception Coverage

## Decision

**Data-plane decision: `runtime-inventory-required`.**

DSH 0.1.1-rc.2 has a proven core carrier contract: `POST /api/:method`, plus WebSocket upgrades at `/api/events.mux` and `/api/events.host`. The current no-credential loopback runtime reaches the HTTP prefix (`415` when the audit deliberately omits JSON) and accepts both standard WebSocket upgrades (`101`). A conforming read-only `session.list` envelope returned `200`, with its response body discarded. The prior `sidecar-required` conclusion was based on a disposable fixture that omitted these known core carriers and is superseded.

This is not proof that one in-process adapter reaches every dynamically registered plugin route. It does not enable multi-user mode, pass Gate A, or establish execution isolation. DT-0-02 and DT-0-03 remain in progress until a composed runtime registration inventory is captured and deny-probed. DT-0-04 remains responsible for the separate execution-plane decision.

## Profile And Harness

- Observed profile: `@deepseek-ai/dsh-web-app@0.1.1-rc.2`.
- Inventory input: `tests/fixtures/dsh-profile/current.json`.
- Harness: `DisposableProbeServer` on an ephemeral `127.0.0.1` port with `FiberProbeAdapter`, plus a no-credential runtime carrier probe.
- Recorded metadata: surface kind, identifier, optional stream mode, and interception outcome only.

The disposable harness validates adapter behavior for the committed inventory. The runtime audit records every status and treats any status other than `401` or `403` as `not-denied`; its CLI then fails closed. The current `415` and `101` results independently prove carrier reachability. It records no credentials, request headers, or response body. Neither probe replaces registration-time inventory capture for dynamically composed plugins.

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

The live no-credential runtime audit produced these reachable results:

| Carrier | Outcome |
| --- | --- |
| `POST /api/session.list` | `415` without the intentionally omitted JSON content type |
| `POST /api/session.search` | `415` without the intentionally omitted JSON content type |
| `POST /api/workspace.create` | `415` without the intentionally omitted JSON content type |
| `/api/events.mux` standard upgrade | `101` |
| `/api/events.host` standard upgrade | `101` |
| Valid `session.list` client-request envelope | `200`; body discarded |

The runner selects `runtime-inventory-required` because the core carriers are known but the complete runtime registration inventory has not yet been captured. The current runtime does not supply a default identity boundary: its non-denial results are a security finding, not in-process coverage evidence. The documented `ctx.connection.rpc.intercept('/api', ...)` seam can cover matching HTTP RPC methods, while the inspected public extension interfaces expose no equivalent interceptor for the core event WebSockets, which are exclusively registered by DSH. The dedicated bypass probes still show that a duplicate raw `GET /sidebar/file` registration and an unregistered raw route return `200` without adapter denial. Each produces a `bypassed` transcript and would select `sidecar-required` for an actual composed runtime. A connection established while the adapter is allowed receives no incremental frame after the adapter is revoked; the rejected frame is recorded as `websocket /sidebar/ws/terminal incremental` with `intercepted-denied`.

## Runtime Research Notes (2026-09-01)

- The supplied runtime at `http://localhost:3080` is a loopback listener launched by `dsh web`. It was used only as a read-only audit target; the running process was not modified or instrumented.
- Its observed `415`, `101`, and body-discarded `200` responses are carrier-reachability evidence only. They show that the raw DSH listener has no default identity boundary, but cannot reveal registrations that occurred before the process started.
- The installed DSH profile exposes `@deepseek-ai/dsh-host-webserver` with public `register(route)` and `registerUpgrade(route)` methods. Those are the supported metadata-capture boundary for a disposable composed runtime; an auditor must be installed before plugins register.
- A post-start audit cannot reconstruct the complete plugin route or RPC inventory. Gate A therefore remains blocked on a disposable startup-time capture, followed by a deny-probe for every captured entry.
- The two core event WebSocket upgrades remain a distinct proof obligation. Until a supported filtering seam is demonstrated for them, their reachability prevents an `in-process-covered` decision.

## Required Follow-Up

Instrument a disposable composed DSH runtime before plugins register. Capture every `webServer.register`, `webServer.registerUpgrade`, and generic RPC registration, add the resulting routes to the inventory, and deny-probe every captured carrier. Prove a supported filtering seam for the two existing event upgrades, or select a sidecar for them. Select `in-process-covered` only if every resulting route is intercepted with no bypass; select `sidecar-required` for any bypass or unfilterable core event route. Keep the raw DSH listener loopback-only and every uncaptured route blocked until then.
