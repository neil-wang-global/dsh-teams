# DSH Teams Capability Decision

**Decision date:** 2026-09-01

**Decision owner:** DSH Teams maintainers

**Next review:** Before implementing `DT-2-04`, whenever the DSH version changes, or when a worker provisioning or confinement probe changes.

## Decision

| Plane | Selected boundary | Status | Evidence |
| --- | --- | --- | --- |
| Data | `sidecar` | Required | [In-process interception coverage](in-process-coverage.md) proves that the two required DSH event WebSocket upgrades have no supported in-process filtering seam. |
| Execution | `isolated-worker` | Required for non-admin execution | `execution-probe.test.ts` rejects every required escape from the in-process candidate and blocks every equivalent escape at the worker fixture boundary. |

The valid composed architecture is `sidecar + isolated-worker`. The sidecar is the only multi-user HTTP and WebSocket entry point; it assigns every execution request to the worker bound to that workspace. The raw DSH listener remains loopback-only.

## Scope And Version

The evaluated local DSH CLI and core web packages are `0.1.1-rc.1`. The compatibility fixture remains `@deepseek-ai/dsh-web-app@0.1.1-rc.2`; it is a regression input and not a substitute for the live runtime decision. The current data-plane evidence is recorded in [DSH Web Surface Inventory](dsh-web-current.md) and [In-Process Interception Coverage](in-process-coverage.md).

This decision selects the architecture needed to proceed after Gate A. It does not enable a second real user or non-admin Agent execution. Those remain blocked until the selected worker is provisioned, the sidecar routes only to that worker, and later Phase 1 through Phase 3 controls pass.

## Execution Evidence

Run the probe from the repository root:

```sh
node --test packages/dsh-teams-probe/test/execution-probe.test.ts
```

The probe uses real temporary filesystem directories for `alpha` and `bravo`. It evaluates the same five controls against both candidates:

| Control | In-process preset | Per-workspace worker fixture |
| --- | --- | --- |
| Read another workspace file | Violated | Blocked |
| Read another workspace credential | Violated | Blocked |
| Invoke an unapproved Host tool | Violated | Blocked |
| Let a subagent/fork inherit cross-workspace access | Violated | Blocked |
| Create an unapproved custom Remote | Violated | Blocked |

The in-process result is `blocked` because all five controls are violations. The worker result is `isolated-worker` because all five attempts are denied at the boundary. The fixture is deliberately limited to the contract that the production worker must preserve: a canonical workspace root, a private credential map, an explicit Host-tool allowlist, same-workspace fork inheritance, and rejection of unapproved Remote creation.

## Rejected Alternatives

### In-process isolation

Rejected. The installed `@deepseek-ai/dsh-fs-sandbox` documents that reads pass through unchanged and only mutation paths receive the workspace policy fence. Its local sandbox backend uses a macOS Seatbelt profile that denies writes but otherwise allows the default policy. The installed `@deepseek-ai/dsh-credentials-local` provider uses one `$DSH_HOME/.credentials.yaml` store. The in-process fork provider seeds each child from the parent session context. These are useful single-user controls, but they cannot prove the required separation of file reads, credentials, Host capabilities, forks, and Remote resources between team workspaces.

### Sidecar without isolated workers

Rejected. A sidecar can authorize data-plane requests but cannot retract bash, filesystem, credential, or Host capabilities already granted to an Agent in the DSH process.

### Non-admin execution without a worker boundary

Rejected and blocked. Application roles, client filtering, an undocumented preset, or a process-wide working directory are not execution isolation.

## Required Worker Contract

Each worker must be launched and continuously checked with all of the following independent state:

- A canonical, non-overlapping workspace root as its working directory.
- A distinct `DSH_HOME` and credential scope that contains no other workspace credentials.
- OS or container confinement that denies access outside the worker root and explicitly declared runtime paths. A failed confinement probe prevents worker readiness.
- A fixed Host-tool allowlist. Any tool not classified for that workspace is unavailable.
- Forked and subagent sessions that remain in the same worker and cannot select another worker context.
- A worker-local resource registry. Custom Remote resources start quarantined and stay unusable until an explicit policy mapping exists.
- Sidecar routing that pins every workspace session to its worker and rejects a mismatched worker identity before any execution request is released.

The implementation must rerun the execution probe at worker startup and fail readiness when a control is violated or omitted.

## Residual Risks And Failure Disposition

- The current probe is a versioned fixture, not a deployed worker process. `DT-2-04` must validate the actual worker launcher, OS or container confinement, sidecar routing, and restart behavior.
- A DSH upgrade can alter tool, credential, fork, or Remote behavior. Rerun DT-0-02 through DT-0-04 before accepting the changed surface.
- A worker that cannot prove its filesystem confinement, credential separation, Host-tool allowlist, fork routing, or Remote quarantine is unready. The sidecar blocks non-admin execution for that workspace.
- If DSH does not expose a stable hook needed to maintain the boundary, create an upstream request using [Upstream Seam Template](upstream-seam-template.md) and keep the affected capability blocked.

## Gate A Review

An auditor can reproduce this decision by running:

```sh
node --test packages/dsh-teams-probe/test/execution-probe.test.ts
npm run check
```

Gate A records the architecture choice only after those commands pass and the data-plane evidence remains `sidecar-required`. Gate B remains the only gate that can enable a second real user.
