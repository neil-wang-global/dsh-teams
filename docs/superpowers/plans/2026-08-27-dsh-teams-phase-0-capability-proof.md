# DSH Teams Phase 0 Capability Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce reproducible evidence that selects the DSH Teams authorization deployment mode before identity, workspace, or UI functionality is implemented.

**Architecture:** A standalone Node ESM probe package parses a strict compatibility manifest, scans an explicitly supplied DSH profile, and runs disposable black-box coverage and isolation probes. The resulting reports decide between in-process Cordis interception, a Plugin-managed sidecar gateway, isolated workers, or blocked capability; no later task may assume a mode that these probes have not proven.

**Tech Stack:** Node.js ESM, `node:test`, `node:assert/strict`, `node:fs/promises`, Cordis/DSH runtime only during disposable integration probes, JSON and Markdown reports.

## Global Constraints

- Do not edit `/Users/neil/.dsh/profiles/web`; it is evidence input only.
- Accept DSH profile location only through `DSH_PROFILE_DIR`; never bake an operator path into source, fixtures, or reports.
- Do not depend on `dsh-auth-gate`, even when the observed DSH profile lists it as an installed bundle.
- The probe records route, method, category, stream kind, and result metadata only; it must not persist prompts, session contents, credentials, cookies, or secret values.
- Unknown routes/streams/actions are hard failures, not warnings.
- A failed in-process or isolation probe selects a fallback/blocked result; it never downgrades the test to browser-side filtering.
- Run all dependency installs through `npm ci --ignore-scripts --registry=https://registry.npmjs.org`.

---

## File Structure

| Path | Responsibility |
|---|---|
| `package.json` | npm workspace list and root `test`, `test:probe`, `check` scripts; preserves `prepare`. |
| `packages/dsh-teams-probe/package.json` | Private ESM probe workspace with its test command. |
| `packages/dsh-teams-probe/src/manifest.mjs` | Manifest validation and category/scope invariants. |
| `packages/dsh-teams-probe/src/profile-scan.mjs` | Deterministic file inventory from `DSH_PROFILE_DIR`. |
| `packages/dsh-teams-probe/src/cli.mjs` | Explicit `scan`, `in-process`, and `isolation` report command entrypoint. |
| `packages/dsh-teams-probe/src/report.mjs` | Redacted JSON/Markdown report rendering. |
| `packages/dsh-teams-probe/src/in-process-probe.mjs` | Coverage evidence evaluator for HTTP, binary, upgrade, baseline, and incremental traffic. |
| `packages/dsh-teams-probe/src/execution-probe.mjs` | Workspace isolation evidence evaluator. |
| `packages/dsh-teams-probe/test/*.test.mjs` | Unit tests for each pure probe module. |
| `tests/fixtures/dsh-profile/current.json` | Sanitized observed DSH profile contract fixture. |
| `docs/compatibility/*.md` | Versioned inventory, coverage evidence, architecture decision, and upstream seam requests. |

## Interfaces

```js
// packages/dsh-teams-probe/src/manifest.mjs
export const ACTION_CATEGORIES = new Set([
  'public-authenticated',
  'workspace-visible-read',
  'holder-write',
  'owner-write',
  'system-admin',
  'blocked',
])

export function parseManifest(input) {
  // returns { version, entries: [{ id, transport, category, resourceScope }] }
  // throws Error for invalid or duplicate entries
}

// packages/dsh-teams-probe/src/profile-scan.mjs
export async function scanProfile(profileDir) {
  // returns { profileDir, packageBundles, files: [{ path, sha256, kind }] }
}

// packages/dsh-teams-probe/src/in-process-probe.mjs
export function evaluateCoverage(manifest, observations) {
  // returns { passed, missing, bypasses, duplicateRoutes, uncoveredStreams }
}

// packages/dsh-teams-probe/src/execution-probe.mjs
export function evaluateIsolation(attempts) {
  // attempts: [{ principalId, workspaceId, targetWorkspaceId, capability, allowed }]
  // returns { passed, violations }
}
```

### Task 1: Bootstrap the testable probe workspace

**Files:**
- Modify: `package.json:7-9`
- Create: `packages/dsh-teams-probe/package.json`
- Create: `packages/dsh-teams-probe/src/manifest.mjs`
- Create: `packages/dsh-teams-probe/test/manifest.test.mjs`

**Consumes:** Node.js 22.12 or later, existing root package metadata and hook scripts.

**Produces:** `@dsh-teams/probe` npm workspace whose tests run with the Node built-in runner.

- [ ] **Step 1: Write the failing manifest test**

```js
// packages/dsh-teams-probe/test/manifest.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseManifest } from '../src/manifest.mjs'

test('rejects an entry without an authorization category', () => {
  assert.throws(
    () => parseManifest({ version: 1, entries: [{ id: 'session.list', transport: 'rpc' }] }),
    /category/,
  )
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test packages/dsh-teams-probe/test/manifest.test.mjs`
Expected: FAIL because `manifest.mjs` does not exist.

- [ ] **Step 3: Add workspace configuration and minimal parser**

Add to root `package.json` without removing `prepare`:

```json
{
  "workspaces": ["packages/*"],
  "scripts": {
    "prepare": "lefthook install --force",
    "test": "npm run test --workspaces --if-present",
    "test:probe": "npm test --workspace @dsh-teams/probe",
    "check": "npm run test:probe"
  }
}
```

Create `packages/dsh-teams-probe/package.json`:

```json
{
  "name": "@dsh-teams/probe",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test test/**/*.test.mjs" }
}
```

Create the parser:

```js
export const ACTION_CATEGORIES = new Set([
  'public-authenticated', 'workspace-visible-read', 'holder-write',
  'owner-write', 'system-admin', 'blocked',
])

export function parseManifest(input) {
  if (!input || input.version !== 1 || !Array.isArray(input.entries)) {
    throw new Error('manifest must contain version 1 and entries')
  }
  const ids = new Set()
  for (const entry of input.entries) {
    if (!entry || typeof entry.id !== 'string' || entry.id.length === 0) throw new Error('entry id is required')
    if (ids.has(entry.id)) throw new Error(`duplicate manifest id: ${entry.id}`)
    ids.add(entry.id)
    if (!ACTION_CATEGORIES.has(entry.category)) throw new Error(`invalid category for ${entry.id}`)
    if (entry.category !== 'blocked' && typeof entry.resourceScope !== 'string') {
      throw new Error(`resourceScope is required for ${entry.id}`)
    }
  }
  return { version: 1, entries: input.entries.map((entry) => ({ ...entry })) }
}
```

- [ ] **Step 4: Run the focused and workspace tests**

Run: `npm ci --ignore-scripts --registry=https://registry.npmjs.org && npm run test:probe`
Expected: PASS with one test.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json packages/dsh-teams-probe
git commit -m "test(probe): validate compatibility manifests"
```

### Task 2: Validate complete, deterministic compatibility manifests

**Files:**
- Modify: `packages/dsh-teams-probe/src/manifest.mjs`
- Modify: `packages/dsh-teams-probe/test/manifest.test.mjs`
- Create: `tests/fixtures/dsh-profile/current.json`

**Consumes:** `parseManifest(input)` from Task 1.

**Produces:** Strict validation for duplicate IDs, unknown transport, missing scope, and every expected profile surface.

- [ ] **Step 1: Add failing cases for duplicates and unsafe classification**

```js
test('rejects duplicate and unknown transport entries', () => {
  assert.throws(() => parseManifest({
    version: 1,
    entries: [
      { id: 'session.list', transport: 'rpc', category: 'workspace-visible-read', resourceScope: 'session' },
      { id: 'session.list', transport: 'rpc', category: 'workspace-visible-read', resourceScope: 'session' },
    ],
  }), /duplicate/)
  assert.throws(() => parseManifest({
    version: 1,
    entries: [{ id: 'raw', transport: 'anything', category: 'blocked' }],
  }), /transport/)
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm run test:probe`
Expected: FAIL because the initial parser accepts the unknown transport.

- [ ] **Step 3: Add an explicit transport allowlist**

```js
const TRANSPORTS = new Set(['rpc', 'http', 'download', 'attachment', 'ws-baseline', 'ws-incremental', 'internal'])
// Inside parseManifest, after entry id validation:
if (!TRANSPORTS.has(entry.transport)) throw new Error(`invalid transport for ${entry.id}`)
```

Create the sanitized fixture with entries for at least `session.list`, `workspace.list`, `session.attachment`, `session.export`, `ws.baseline`, and `ws.incremental`; each entry must have an allowed category or `blocked`.

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm run test:probe`
Expected: PASS; fixture parses with no unknown transport.

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-teams-probe tests/fixtures/dsh-profile/current.json
git commit -m "test(probe): enforce complete transport classification"
```

### Task 3: Scan DSH profiles without recording secrets

**Files:**
- Create: `packages/dsh-teams-probe/src/profile-scan.mjs`
- Create: `packages/dsh-teams-probe/src/cli.mjs`
- Create: `packages/dsh-teams-probe/test/profile-scan.test.mjs`
- Create: `docs/compatibility/dsh-web-current.md`

**Consumes:** `DSH_PROFILE_DIR` and the manifest fixture from Task 2.

**Produces:** `scanProfile(profileDir)` deterministic inventory data with relative paths, SHA-256 hashes, and package bundle names.

- [ ] **Step 1: Write a failing deterministic scan test**

```js
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanProfile } from '../src/profile-scan.mjs'

test('returns sorted relative files and package bundles', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-teams-probe-'))
  await mkdir(join(dir, 'nested'))
  await writeFile(join(dir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['a', 'b'] } } }))
  await writeFile(join(dir, 'nested', 'route.mjs'), 'export {}')
  const snapshot = await scanProfile(dir)
  assert.deepEqual(snapshot.packageBundles, ['a', 'b'])
  assert.equal(snapshot.files[0].path, 'nested/route.mjs')
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test packages/dsh-teams-probe/test/profile-scan.test.mjs`
Expected: FAIL because `profile-scan.mjs` does not exist.

- [ ] **Step 3: Implement sorted, redacted scanning**

```js
import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

async function filesUnder(root, current = root) {
  const rows = await readdir(current, { withFileTypes: true })
  const output = []
  for (const row of rows) {
    const full = join(current, row.name)
    if (row.isDirectory() && row.name !== 'node_modules') output.push(...await filesUnder(root, full))
    if (row.isFile()) output.push(full)
  }
  return output
}

export async function scanProfile(profileDir) {
  const packageJson = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
  const files = await filesUnder(profileDir)
  return {
    profileDir: '<redacted>',
    packageBundles: [...(packageJson.dsh?.profile?.bundles ?? [])].sort(),
    files: (await Promise.all(files.map(async (full) => ({
      path: relative(profileDir, full),
      sha256: createHash('sha256').update(await readFile(full)).digest('hex'),
      kind: (await stat(full)).size === 0 ? 'empty' : 'file',
    })))).sort((a, b) => a.path.localeCompare(b.path)),
  }
}
```

Create `packages/dsh-teams-probe/src/cli.mjs` as the report entrypoint:

```js
import { writeFile } from 'node:fs/promises'
import { scanProfile } from './profile-scan.mjs'

const [command, outputFile] = process.argv.slice(2)
if (command !== 'scan' || !outputFile || !process.env.DSH_PROFILE_DIR) {
  throw new Error('usage: DSH_PROFILE_DIR=<dir> node src/cli.mjs scan <output-file>')
}
await writeFile(outputFile, `${JSON.stringify(await scanProfile(process.env.DSH_PROFILE_DIR), null, 2)}\n`)
```

- [ ] **Step 4: Run tests and create the observed report**

Run: `npm run test:probe && DSH_PROFILE_DIR=/path/to/disposable/profile node packages/dsh-teams-probe/src/cli.mjs scan docs/compatibility/dsh-web-current.json`
Expected: PASS; report contains relative paths and bundle names only.

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-teams-probe docs/compatibility/dsh-web-current.md
git commit -m "docs(compatibility): record DSH profile inventory"
```

### Task 4: Evaluate in-process adapter coverage from probe observations

**Files:**
- Create: `packages/dsh-teams-probe/src/in-process-probe.mjs`
- Create: `packages/dsh-teams-probe/src/cordis-interception-observer.mjs`
- Create: `packages/dsh-teams-probe/test/in-process-probe.test.mjs`
- Create: `docs/compatibility/in-process-observations.json`
- Create: `docs/compatibility/in-process-coverage.md`

**Consumes:** Parsed manifest from Task 2 and observations emitted by a Fiber-scoped temporary Cordis adapter.

**Produces:** `evaluateCoverage(manifest, observations)` and a coverage report that fails closed on missing/bypass/duplicate surfaces.

- [ ] **Step 1: Write failing coverage tests**

```js
import { evaluateCoverage } from '../src/in-process-probe.mjs'

test('fails when incremental stream traffic bypasses the adapter', () => {
  const result = evaluateCoverage(
    { entries: [{ id: 'ws.incremental', transport: 'ws-incremental', category: 'workspace-visible-read', resourceScope: 'session' }] },
    [],
  )
  assert.equal(result.passed, false)
  assert.deepEqual(result.uncoveredStreams, ['ws.incremental'])
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test packages/dsh-teams-probe/test/in-process-probe.test.mjs`
Expected: FAIL because the evaluator does not exist.

- [ ] **Step 3: Implement fail-closed evaluation**

```js
export function evaluateCoverage(manifest, observations) {
  const seen = new Map(observations.map((item) => [item.id, item]))
  const missing = manifest.entries.filter((entry) => !seen.has(entry.id)).map((entry) => entry.id)
  const bypasses = observations.filter((item) => item.bypassed === true).map((item) => item.id)
  const duplicateRoutes = observations.filter((item) => item.duplicateRawRoute === true).map((item) => item.id)
  const uncoveredStreams = manifest.entries
    .filter((entry) => entry.transport === 'ws-baseline' || entry.transport === 'ws-incremental')
    .filter((entry) => !seen.has(entry.id))
    .map((entry) => entry.id)
  return { passed: missing.length === 0 && bypasses.length === 0 && duplicateRoutes.length === 0, missing, bypasses, duplicateRoutes, uncoveredStreams }
}
```

- [ ] **Step 4: Run disposable integration probes**

Create `cordis-interception-observer.mjs` as a temporary Fiber-scoped adapter that appends one JSON observation per manifest ID with `id`, `bypassed`, and `duplicateRawRoute`; it must dispose with its Fiber. Run the adapter against a disposable profile, then evaluate only the produced evidence file:

```bash
node --input-type=module -e "import { readFile } from 'node:fs/promises'; import { parseManifest } from './packages/dsh-teams-probe/src/manifest.mjs'; import { evaluateCoverage } from './packages/dsh-teams-probe/src/in-process-probe.mjs'; const manifest = parseManifest(JSON.parse(await readFile('tests/fixtures/dsh-profile/current.json'))); const observations = JSON.parse(await readFile('docs/compatibility/in-process-observations.json')); const result = evaluateCoverage(manifest, observations); console.log(JSON.stringify(result, null, 2)); process.exit(result.passed ? 0 : 1)"
```

Expected: Each manifest surface appears once; direct raw routes have no successful observation; any failure writes `sidecar-required` to the report.

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-teams-probe docs/compatibility/in-process-coverage.md
git commit -m "test(probe): evaluate in-process route coverage"
```

### Task 5: Evaluate execution isolation and record Gate A

**Files:**
- Create: `packages/dsh-teams-probe/src/execution-probe.mjs`
- Create: `packages/dsh-teams-probe/src/execution-attempt-recorder.mjs`
- Create: `packages/dsh-teams-probe/test/execution-probe.test.mjs`
- Create: `docs/compatibility/execution-attempts.json`
- Create: `docs/compatibility/architecture-decision.md`
- Create: `docs/compatibility/upstream-seam-template.md`

**Consumes:** Mode evidence from Task 4 and controlled cross-workspace attempts from a disposable DSH environment.

**Produces:** `evaluateIsolation(attempts)` and a reviewed Gate A decision.

- [ ] **Step 1: Write a failing cross-workspace isolation test**

```js
import { evaluateIsolation } from '../src/execution-probe.mjs'

test('rejects a member capability reaching another workspace', () => {
  const result = evaluateIsolation([{
    principalId: 'member-a', workspaceId: 'workspace-a', targetWorkspaceId: 'workspace-b',
    capability: 'filesystem-read', allowed: true,
  }])
  assert.equal(result.passed, false)
  assert.equal(result.violations[0].capability, 'filesystem-read')
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test packages/dsh-teams-probe/test/execution-probe.test.mjs`
Expected: FAIL because the evaluator does not exist.

- [ ] **Step 3: Implement isolation evaluation**

```js
export function evaluateIsolation(attempts) {
  const violations = attempts.filter((attempt) => (
    attempt.allowed === true
    && attempt.workspaceId !== attempt.targetWorkspaceId
    && ['filesystem-read', 'credential-read', 'host-tool', 'subagent-cross-workspace'].includes(attempt.capability)
  ))
  return { passed: violations.length === 0, violations }
}
```

- [ ] **Step 4: Run candidate-mode probes and write the decision**

Create `execution-attempt-recorder.mjs` to write only `principalId`, `workspaceId`, `targetWorkspaceId`, `capability`, and `allowed` for controlled disposable attempts. Evaluate that evidence before writing the decision:

```bash
node --input-type=module -e "import { readFile } from 'node:fs/promises'; import { evaluateIsolation } from './packages/dsh-teams-probe/src/execution-probe.mjs'; const attempts = JSON.parse(await readFile('docs/compatibility/execution-attempts.json')); const result = evaluateIsolation(attempts); console.log(JSON.stringify(result, null, 2)); process.exit(result.passed ? 0 : 1)"
```

Expected: The report selects exactly one mode: `in-process`, `sidecar`, `isolated-worker`, or `blocked`; the Markdown decision records DSH version, evidence commands, rejected modes, residual risks, and required next task IDs.

- [ ] **Step 5: Commit and verify Gate A**

```bash
git add packages/dsh-teams-probe docs/compatibility
git commit -m "docs(architecture): decide DSH Teams deployment mode"
npm run test:probe
git diff --check HEAD^ HEAD
```

Expected: Tests pass and the decision explicitly keeps second-user enablement disabled unless the selected mode has complete route and execution isolation evidence.

## Phase 0 Exit Checklist

- [ ] Every route, download, attachment, RPC, baseline stream, incremental stream, and resource-creating path appears in the manifest.
- [ ] Every manifest entry has a classification and resource scope or is explicitly `blocked`.
- [ ] Coverage report has no bypass, duplicate raw route, missing entry, or uncovered stream in the selected mode.
- [ ] Cross-workspace Agent/Tool/filesystem/credential tests pass in the selected mode; otherwise the capability is worker-routed or blocked.
- [ ] Architecture decision and upstream-seam template contain no secrets or user content.
- [ ] Gate A decision is reviewed before any Phase 1 implementation Issue is opened.
