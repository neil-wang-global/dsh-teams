# Execution Isolation Decision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce reproducible evidence that selects the DSH Teams execution-plane boundary before Gate A.

**Architecture:** The probe models the two candidate boundaries separately. The in-process preset deliberately exposes process-global roots, credentials, Host tools, fork state, and Remote state so the test captures its failure; the worker fixture gives every workspace a separate root, credential scope, allowlist, and resource registry. The decision document combines that execution evidence with the existing sidecar-required data-plane evidence.

**Tech Stack:** Node.js ESM, TypeScript syntax executed by Node, `node:test`, temporary filesystem fixtures.

**Spec:** `docs/superpowers/specs/2026-08-27-dsh-teams-user-authorization-design.md`

## Global Constraints

- Do not modify DSH or treat application RBAC as OS isolation.
- Keep the raw DSH listener loopback-only; the selected data-plane adapter remains `sidecar`.
- Non-admin execution remains fail-closed until the worker boundary is provisioned and its probes pass.
- The evidence must cover cross-workspace file reads, credentials, Host tools, subagent/fork inheritance, and custom Remote creation.
- Unmapped resources remain quarantined and absent from exposed execution state.

---

### Task 1: Execution Isolation Probe

**Files:**
- Create: `packages/dsh-teams-probe/src/execution-probe.ts`
- Create: `packages/dsh-teams-probe/test/execution-probe.test.ts`

**Interfaces:**
- Produces: `createInProcessExecutionPreset(root)`, `createWorkspaceWorkerFixture(root)`, and `runExecutionIsolationProbe(candidate)`.
- Produces: an `ExecutionIsolationReport` with a `blocked` or `isolated-worker` decision and one result for each required boundary.
- Consumes: Node temporary directories only; no user DSH profile, credentials, or live listener data.

- [x] **Step 1: Write failing tests for the candidate boundary**

```ts
const report = await runExecutionIsolationProbe(await createInProcessExecutionPreset(root))

assert.equal(report.decision, 'blocked')
assert.deepEqual(report.violations, [
  'cross-workspace-file-read',
  'cross-workspace-credential-read',
  'unapproved-host-tool',
  'subagent-fork-inheritance',
  'custom-remote-creation',
])
```

- [x] **Step 2: Run the focused test and verify it fails**

Run: `npm test --workspace @dsh-teams/probe -- --test-name-pattern='in-process preset'`

Expected: FAIL because `execution-probe.ts` does not exist.

- [x] **Step 3: Write failing tests for the per-workspace worker fixture**

```ts
const report = await runExecutionIsolationProbe(await createWorkspaceWorkerFixture(root))

assert.equal(report.decision, 'isolated-worker')
assert.deepEqual(report.violations, [])
assert.deepEqual(report.blocked, [
  'cross-workspace-file-read',
  'cross-workspace-credential-read',
  'unapproved-host-tool',
  'subagent-fork-inheritance',
  'custom-remote-creation',
])
```

- [x] **Step 4: Implement the smallest fixture boundary**

```ts
interface ExecutionCandidate {
  readonly kind: 'in-process' | 'isolated-worker'
  readFile(workspace: string, relativePath: string): Promise<string>
  credential(workspace: string, name: string): string | undefined
  hostTool(workspace: string, name: string): boolean
  fork(workspace: string): string
  createRemote(workspace: string, name: string): boolean
}
```

Use canonical per-workspace paths, per-worker maps, explicit Host-tool allowlists, and workspace-keyed resource registries. Preserve failing in-process observations rather than masking them.

- [x] **Step 5: Run the focused test and verify it passes**

Run: `npm test --workspace @dsh-teams/probe -- --test-name-pattern='execution isolation'`

Expected: PASS with both candidate reports and no skipped required boundary.

### Task 2: Decision And Upstream Request Records

**Files:**
- Create: `docs/compatibility/architecture-decision.md`
- Create: `docs/compatibility/upstream-seam-template.md`
- Modify: `docs/superpowers/plans/2026-08-27-dsh-teams-implementation-tasking.md`

**Interfaces:**
- Consumes: `ExecutionIsolationReport` and `docs/compatibility/in-process-coverage.md`.
- Produces: a versioned decision identifying `sidecar` plus `isolated-worker`, reproducible commands, residual risks, and Gate A ownership.
- Produces: a fill-in upstream request with a minimal reproduction, affected capability, threat model, failure evidence, and requested contract.

- [x] **Step 1: Write the evidence requirements as assertions**

```ts
assert.equal(workerReport.decision, 'isolated-worker')
assert.equal(inProcessReport.decision, 'blocked')
assert.deepEqual(workerReport.violations, [])
```

The same focused test must prove the document claims before the document records them.

- [x] **Step 2: Record the decision and fallback contract**

Document the installed DSH version, the sidecar-required data-plane evidence, the in-process negative results, worker-fixture positive results, composition rules, deployment preconditions, residual risks, and the next review owner. State that a missing worker provisioner, failed OS confinement, or unclassified execution entry blocks non-admin execution and activates the upstream template.

- [x] **Step 3: Update task status only after fresh evidence**

Change `DT-0-04` to `complete` only after the focused probe, type check, and full workspace test suite succeed. Preserve the gate rule that no second real user is enabled by this decision alone.

- [x] **Step 4: Verify the full repository checks**

Run: `npm run check`

Expected: TypeScript checks and all probe tests pass.

- [x] **Step 5: Commit the completed task**

```bash
git add packages/dsh-teams-probe docs/compatibility docs/superpowers/plans
git commit -m "docs(architecture): record DSH Teams capability decision"
```
