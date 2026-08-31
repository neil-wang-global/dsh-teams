# In-Process Interception Coverage

## Decision

**Data-plane decision: `sidecar-required`.**

The current profile cannot prove that one static in-process adapter reaches every DSH data-plane surface. The registered `webServer` paths can be intercepted by the disposable Fiber-scoped adapter, but the inventory records no physical carrier for `apiProxy` RPC and no carrier contract for baseline or incremental DSH streams. Those unresolved surfaces must not be treated as covered.

This is a negative DT-0-03 architecture result. It does not enable multi-user mode, pass Gate A, or establish execution isolation. DT-0-04 remains responsible for the separate execution-plane decision.

## Profile And Harness

- Observed profile: `@deepseek-ai/dsh-web-app@0.1.1-rc.2`.
- Inventory input: `tests/fixtures/dsh-profile/current.json`.
- Harness: `DisposableProbeServer` on an ephemeral `127.0.0.1` port with `FiberProbeAdapter`.
- Recorded metadata: surface kind, identifier, optional stream mode, and interception outcome only.

The harness is a disposable reproduction of the observed `webServer` registration seam. It is deliberately not a claim that an unmodified DSH process exposed an unobserved carrier. The missing carriers are retained as failure evidence.

## Reproducible Transcript

Run:

```sh
npm test --workspace @dsh-teams/probe -- --test-name-pattern='disposable profile|raw route|incremental frame'
```

The disposable current-profile run produces these adapter-denial transcripts:

| Surface | Outcome |
| --- | --- |
| `GET /api/session.export` | `intercepted-denied` |
| `HEAD /api/session.export` | `intercepted-denied` |
| `POST /sidebar/api/:method` | `intercepted-denied` |
| `GET /sidebar/file` | `intercepted-denied` |
| `GET /sidebar/html` | `intercepted-denied` |
| `GET /sidebar/bundle` | `intercepted-denied` |
| `/sidebar/ws/terminal` upgrade | `intercepted-denied` |
| `/sidebar/ws/agent-terminals` upgrade | `intercepted-denied` |

The runner reports these unresolved inventory surfaces and therefore selects `sidecar-required`:

| Surface | Reason |
| --- | --- |
| `session.list` | `apiProxy` has no recorded physical route registration |
| `session.search` | `apiProxy` has no recorded physical route registration |
| `workspace.create` | `apiProxy` has no recorded physical route registration |
| DSH stream carrier, baseline | Carrier is unresolved in the profile contract |
| DSH stream carrier, incremental | Carrier is unresolved in the profile contract |

The dedicated bypass probes also show that a duplicate raw `GET /sidebar/file` registration and an unregistered raw route return `200` without adapter denial. Each produces a `bypassed` transcript and is an architecture failure. A connection established while the adapter is allowed receives no incremental frame after the adapter is revoked; the rejected frame is recorded as `websocket /sidebar/ws/terminal incremental` with `intercepted-denied`.

## Required Follow-Up

Use the selected sidecar path in DT-2-02 unless a later DSH version supplies a complete carrier contract and the in-process probe is rerun successfully. Keep the raw DSH listener loopback-only and keep every unresolved method and stream blocked until then.
