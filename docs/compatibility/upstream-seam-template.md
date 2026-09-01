# DSH Teams Upstream Seam Request Template

Use this template when a required DSH execution or data-plane boundary cannot be proven. Do not enable the affected capability while any field below is unresolved.

## Summary

**Requested capability:**

**Affected DSH version and packages:**

**Affected DSH profile:**

**Affected DSH Teams action or carrier:**

## Minimal Reproduction

1. Start from a temporary `DSH_HOME` and a disposable profile.
2. Configure two distinct workspace roots and credentials.
3. Invoke the exact DSH action listed above as workspace `alpha`.
4. Attempt the same action against workspace `bravo` or its credential, Host tool, fork, or Remote resource.
5. Record only route, action, boundary result, package version, and exit status. Do not attach credentials, request bodies, session logs, or file contents.

```sh
# Replace every placeholder before filing.
DSH_HOME=/path/to/disposable-home dsh --profile web <reproduction-arguments>
```

## Observed Failure

**Expected denial:**

**Actual result:**

**Evidence file or command:**

**Whether the failure crosses a data-plane or execution-plane boundary:**

## Threat Model

State the untrusted principal, the protected workspace resource, the cross-boundary action, and the impact. Include whether the path exposes file contents, credentials, Host tools, execution state, or Remote resources.

## Required Minimal Contract

Describe the smallest stable, public hook that would permit a fail-closed implementation. The contract must state:

- The registration or invocation point and its lifecycle.
- The workspace, session, and principal identity supplied to the hook.
- When the hook runs relative to file, credential, tool, fork, Remote, HTTP, and stream effects.
- How the hook denies an action before a byte, frame, process, credential, or resource is released.
- How child sessions and custom resources inherit or receive a workspace identity.
- The versioning and compatibility behavior when a hook is unavailable.

## Requested Tests

- A cross-workspace file read is denied.
- A cross-workspace credential read is denied.
- An unapproved Host tool is denied.
- A fork or subagent cannot gain a broader workspace scope.
- A custom Remote starts quarantined until explicitly mapped.
- The denial remains effective after restart and after the caller reconnects.

## DSH Teams Fallback

Keep the capability blocked. The sidecar returns a denied result before forwarding the request, and no worker is marked ready for the affected workspace until the upstream contract exists and the regression probe passes.
