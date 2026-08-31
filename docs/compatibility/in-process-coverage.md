# In-Process Interception Coverage

## Decision

**Data-plane decision: `sidecar-required`.**

The live DSH CLI, `@deepseek-ai/dsh-client-connection`, and `@deepseek-ai/dsh-host-webserver` are all `0.1.1-rc.1`. They expose the core carrier contract `POST /api/:method` plus WebSocket upgrades at `/api/events.mux` and `/api/events.host`. The no-credential loopback audit reaches the HTTP prefix (`415` when the audit deliberately omits JSON) and accepts both standard WebSocket upgrades (`101`).

The public in-process API has no filtering or observation seam for the two required WebSocket upgrades. `@deepseek-ai/dsh-client-connection` registers them directly with `webServer.registerUpgrade`; `webServer` admits one handler per path and rejects duplicates. `ctx.connection.rpc.intercept('/api', ...)` applies only to HTTP RPC dispatch and is not called for either upgrade. An unsupported method monkey-patch is not a coverage proof. Because an unfilterable required carrier is enough to reject the architecture, the data plane is `sidecar-required`; a complete in-process plugin-registration capture is no longer a Gate A prerequisite.

This does not enable multi-user mode, pass Gate A, or establish execution isolation. DT-0-04 remains responsible for the independent execution-plane decision.

## Profile And Harness

- Live runtime: DSH CLI and core web packages `0.1.1-rc.1` at `http://localhost:3080`.
- Canonical fixture: `tests/fixtures/dsh-profile/current.json` records the prior `@deepseek-ai/dsh-web-app@0.1.1-rc.2` profile and remains a unit-test input, not a substitute for the live decision.
- Harness: `DisposableProbeServer` on an ephemeral `127.0.0.1` port with `FiberProbeAdapter`, plus a no-credential runtime carrier probe.
- Recorded metadata: surface kind, identifier, optional stream mode, and interception outcome only.

The disposable harness validates adapter behavior for the committed inventory. The runtime audit records every status and treats any status other than `401` or `403` as `not-denied`; its CLI then fails closed. The current `415` and `101` results independently prove carrier reachability. It records no credentials, request headers, or response body. Neither probe treats the live listener as protected.

## Reproducible Transcript

Run:

```sh
npm test --workspace @dsh-teams/probe -- --test-name-pattern='disposable profile|raw route|incremental frame'
DSH_RUNTIME_URL=http://localhost:3080 npm run probe:runtime
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

The current runtime supplies no default identity boundary: its non-denial results are a security finding, not in-process coverage evidence. The source-level result is decisive: `@deepseek-ai/dsh-client-connection@0.1.1-rc.1` registers each core event route with `webServer.registerUpgrade`, and `@deepseek-ai/dsh-host-webserver@0.1.1-rc.1` has no middleware, listener, enumerator, or replacement API. A duplicate registration throws. The HTTP RPC interceptor cannot reach those upgrade handlers. The dedicated disposable bypass probes independently show that a raw route released without adapter denial is an architecture failure. The selected data-plane adapter is therefore a sidecar, not an in-process adapter.

## Runtime Research Notes (2026-09-01)

- The supplied runtime at `http://localhost:3080` is a loopback listener launched by `dsh web`. It was used only as a read-only audit target; the running process was not modified or instrumented.
- Its observed `415` and `101` responses are carrier-reachability evidence only. They show that the raw DSH listener has no default identity boundary.
- The installed `@deepseek-ai/dsh-client-connection@0.1.1-rc.1` calls `webServer.registerUpgrade` for both core event paths. The installed `@deepseek-ai/dsh-host-webserver@0.1.1-rc.1` stores exactly one handler per upgrade path and exposes no interception API.
- The one public interception facility, `ctx.connection.rpc.intercept('/api', ...)`, selects HTTP RPC endpoints before the `apiProxy` fallback. It does not participate in the core WebSocket registration or frame pumping.
- A post-start audit cannot reconstruct dynamic registrations, and a pre-start monkey-patch of unsupported internals would not establish a durable security boundary. The required core WebSocket failure alone selects the sidecar.

## Disposition

Use a sidecar as the only multi-user HTTP and WebSocket entry point. Keep the raw DSH listener loopback-only and deny every unimplemented or unclassified sidecar route. Do not add an in-process registration capture based on private mutation of the DSH route table. DT-0-04 may now begin its separate execution-isolation research; Gate A remains blocked until that work selects `in-process-isolated`, `isolated-worker`, or `blocked` for non-admin execution.
