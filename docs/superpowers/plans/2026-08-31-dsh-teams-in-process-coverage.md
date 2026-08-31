# DSH Teams In-Process Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce reproducible, fail-closed evidence that determines whether the current DSH profile can be protected by one in-process adapter.

**Architecture:** A disposable loopback probe server represents the observed `webServer` registration seam and sends all registered HTTP and WebSocket traffic through a temporary Fiber-scoped adapter. A separate coverage assessor compares its metadata-only transcripts to the committed profile inventory. Unresolved carriers, bypassed raw routes, and duplicate registrations force `sidecar-required`; the probe never treats unknown transport as covered.

**Tech Stack:** Node.js built-in `http`, `net`, `node:test`, TypeScript with NodeNext execution.

**Spec:** `docs/superpowers/specs/2026-08-27-dsh-teams-user-authorization-design.md`

## Global Constraints

- Do not modify DSH source or hard-code an operator DSH profile path.
- Record only surface identifiers, methods, stream modes, and allow/deny outcomes; never record request bodies, credentials, headers, response bytes, or attachment paths.
- A route or stream that has no proven physical carrier is `unresolved`, not covered.
- A raw or duplicate route that misses the adapter is an architecture failure and selects `sidecar-required`.
- No multi-user behavior is enabled by this probe.

---

### Task 1: Assess Coverage Transcripts

**Files:**
- Create: `packages/dsh-teams-probe/src/in-process-probe.ts`
- Create: `packages/dsh-teams-probe/test/in-process-probe.test.ts`

**Interfaces:**
- Consumes: `DshSurfaceSnapshot` from `src/snapshot.ts`.
- Produces: `ProbeTranscript`, `InProcessCoverageReport`, and `assessInProcessCoverage(snapshot, transcripts)`.

- [x] **Step 1: Write the failing decision tests**

```ts
const report = assessInProcessCoverage(snapshot, [{
  kind: 'http', id: 'GET /sidebar/file', observation: 'intercepted-denied',
}])

assert.equal(report.decision, 'sidecar-required')
assert.deepEqual(report.failures, [
  'missing transcript: http GET /api/session.export',
  'unresolved carrier: rpc session.list',
])
```

The test must also prove that a `bypassed` or duplicate transcript selects `sidecar-required` even when every other inventory entry is denied.

- [x] **Step 2: Run the focused test and verify RED**

Run: `npm test --workspace @dsh-teams/probe -- --test-name-pattern='coverage assessor'`

Expected: FAIL because `../src/in-process-probe.ts` does not exist.

- [x] **Step 3: Implement the minimal coverage assessor**

```ts
export type ProbeObservation = 'intercepted-denied' | 'bypassed' | 'unresolved'

export interface ProbeTranscript {
  kind: 'http' | 'rpc' | 'websocket'
  id: string
  mode?: 'baseline' | 'incremental'
  observation: ProbeObservation
}

export function assessInProcessCoverage(
  snapshot: DshSurfaceSnapshot,
  transcripts: readonly ProbeTranscript[],
): InProcessCoverageReport
```

Generate a deterministic transcript key from kind, id, and optional mode. Require exactly one non-bypassed transcript for each inventory surface; mark pre-existing `requires-upstream-clarification` surfaces unresolved. Sort failures lexically and select `in-process-covered` only when no failures remain.

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `npm test --workspace @dsh-teams/probe -- --test-name-pattern='coverage assessor'`

Expected: PASS.

### Task 2: Exercise a Fiber-Scoped Adapter Over Real Loopback Traffic

**Files:**
- Create: `packages/dsh-teams-probe/src/probe-server.ts`
- Modify: `packages/dsh-teams-probe/test/in-process-probe.test.ts`

**Interfaces:**
- Consumes: `ProbeTranscript` from `src/in-process-probe.ts`.
- Produces: `FiberProbeAdapter`, `DisposableProbeServer`, and test-only HTTP/upgrade helpers.

- [x] **Step 1: Write failing black-box server tests**

```ts
const server = await DisposableProbeServer.start({ adapter })
const response = await server.request('GET', '/sidebar/file')

assert.equal(response.status, 403)
assert.deepEqual(adapter.transcripts(), [{
  kind: 'http', id: 'GET /sidebar/file', observation: 'intercepted-denied',
}])
```

Add isolated tests for a raw duplicate `/sidebar/file` registration, an unregistered raw route, a rejected WebSocket upgrade, and a post-revocation incremental stream frame. Each test must assert observed client behavior and the corresponding metadata transcript.

- [x] **Step 2: Run the focused test and verify RED**

Run: `npm test --workspace @dsh-teams/probe -- --test-name-pattern='adapter|raw route|incremental frame'`

Expected: FAIL because `../src/probe-server.ts` does not exist.

- [x] **Step 3: Implement the minimum disposable server**

```ts
export class FiberProbeAdapter {
  deny(): void
  allow(): void
  inspect(surface: ProbeSurface): boolean
  transcripts(): readonly ProbeTranscript[]
}

export class DisposableProbeServer {
  static async start(options: ProbeServerOptions): Promise<DisposableProbeServer>
  request(method: string, path: string): Promise<{ status: number }>
  upgrade(path: string): Promise<{ status: number; frames: string[] }>
  emitIncrementalFrame(id: string, frame: string): void
  close(): Promise<void>
}
```

Use Node's loopback HTTP server and raw upgrade handling. Check adapter authorization before sending every HTTP response status, upgrade response, and incremental frame. Keep request payloads and response bodies out of transcripts.

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `npm test --workspace @dsh-teams/probe -- --test-name-pattern='adapter|raw route|incremental frame'`

Expected: PASS.

### Task 3: Record the Fail-Closed Architecture Evidence

**Files:**
- Create: `docs/compatibility/in-process-coverage.md`
- Modify: `packages/dsh-teams-probe/test/in-process-probe.test.ts`

**Interfaces:**
- Consumes: current inventory fixture and the coverage report from Tasks 1-2.
- Produces: a redacted, reproducible transcript and the selected `sidecar-required` decision for the current profile.

- [x] **Step 1: Write the failing disposable-profile evidence test**

```ts
const report = assessInProcessCoverage(currentProfile, probe.transcripts())

assert.equal(report.decision, 'sidecar-required')
assert.deepEqual(report.unresolved, [
  'rpc session.list',
  'rpc session.search',
  'rpc workspace.create',
  'websocket unresolved DSH stream carrier baseline',
  'websocket unresolved DSH stream carrier incremental',
])
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `npm test --workspace @dsh-teams/probe -- --test-name-pattern='disposable profile'`

Expected: FAIL until the server produces the required transcript and the report implements unresolved-carrier handling.

- [x] **Step 3: Add the redacted evidence document**

Document the observed DSH version, disposable profile source, tested HTTP/WS routes, raw-route result, stream-revocation result, unresolved carriers, decision, rerun command, and the explicit constraint that this is a negative architecture decision rather than live multi-user enablement.

- [x] **Step 4: Run full verification**

Run: `npm run check`

Expected: TypeScript no-emit check and all probe tests pass.

- [x] **Step 5: Inspect and commit**

Run: `git diff --check && git status --short && git diff --stat`

Commit: `test(probe): prove in-process authorization coverage`
