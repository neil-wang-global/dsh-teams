# Core Configuration Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate the DSH Teams deployment configuration before any service becomes ready.

**Architecture:** A small ESM core package parses an explicit environment object into an immutable configuration value. It accepts only known deployment modes and explicit feature flags, derives the SQLite location from `DSH_HOME`, and raises a non-secret `ConfigurationError` for invalid input. A separate operator-facing document defines the required environment variables without writing secrets to a file.

**Tech Stack:** Node.js ESM, Node built-in `node:test`, TypeScript `tsc --noEmit` for the existing probe workspace.

**Spec:** `docs/superpowers/specs/2026-08-27-dsh-teams-user-authorization-design.md`

## Global Constraints

- Keep the raw DSH bind address on a literal loopback address (`127.0.0.1` or `::1`).
- Production requires an HTTPS canonical URL and Secure session cookies.
- Development may use insecure cookies only through an explicit configuration value.
- SMTP credentials are referenced, never parsed as plaintext configuration or exposed in diagnostics.
- TOTP and passkey flags default to disabled.
- Do not add SQLite initialization, identity, gateway, worker, or runtime-listener behavior in this task.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `packages/dsh-teams-core/package.json` | Declares the ESM core workspace and its test command. |
| `packages/dsh-teams-core/src/errors.mjs` | Provides safe startup configuration error types. |
| `packages/dsh-teams-core/src/config.mjs` | Parses, validates, freezes, and returns deployment configuration. |
| `packages/dsh-teams-core/test/config.test.mjs` | Exercises valid parsing and each fail-closed startup condition. |
| `package.json` | Adds core test coverage to the repository check command. |
| `docs/operations/configuration.md` | Documents required settings, secret references, secure defaults, and operator diagnosis. |
| `docs/superpowers/plans/2026-08-27-dsh-teams-implementation-tasking.md` | Records DT-1-01 only after fresh full-suite evidence. |

### Task 1: Add The Core Configuration Package

**Files:**
- Create: `packages/dsh-teams-core/package.json`
- Create: `packages/dsh-teams-core/src/errors.mjs`
- Create: `packages/dsh-teams-core/src/config.mjs`
- Create: `packages/dsh-teams-core/test/config.test.mjs`

**Interfaces:**
- Produces: `loadConfig(environment): Readonly<TeamsConfig>`.
- Produces: `ConfigurationError` with a stable `code` and a secret-free operator message.
- Consumes: an environment-like record, without reading the process environment directly.

- [x] **Step 1: Write the failing configuration tests**

```js
test('rejects a production canonical URL that is not HTTPS', () => {
  assert.throws(
    () => loadConfig({ ...productionEnvironment(), DSH_TEAMS_CANONICAL_URL: 'http://teams.example.test' }),
    { code: 'canonical-url-insecure' },
  )
})

test('rejects a non-loopback raw DSH bind address', () => {
  assert.throws(
    () => loadConfig({ ...developmentEnvironment(), DSH_TEAMS_DSH_BIND: '0.0.0.0' }),
    { code: 'dsh-bind-not-loopback' },
  )
})
```

- [x] **Step 2: Run the focused test and verify it fails**

Run: `npm test --workspace @dsh-teams/core`

Expected: FAIL because the core workspace and `loadConfig` do not exist.

- [x] **Step 3: Implement the smallest configuration contract**

```js
export function loadConfig(environment) {
  const mode = readMode(environment)
  const canonicalUrl = readCanonicalUrl(environment, mode)
  const dsh = readLoopbackDsh(environment)
  const cookie = readCookiePolicy(environment, mode)
  return Object.freeze({ mode, canonicalUrl, dsh, cookie, ...readOptionalSettings(environment) })
}
```

Use strict parsers for booleans and ports, derive `database.path` from absolute `DSH_HOME`, validate SMTP as a complete optional block, and retain only a secret reference identifier in the returned configuration.

- [x] **Step 4: Run the focused test and verify it passes**

Run: `npm test --workspace @dsh-teams/core`

Expected: PASS with valid production and development cases plus rejection of invalid URL, bind, secret reference, Cookie, flag, port, and SMTP combinations.

- [x] **Step 5: Commit the tested core package**

```bash
git add packages/dsh-teams-core
git commit -m "feat(config): validate deployment startup settings"
```

### Task 2: Integrate The Check And Document Operator Configuration

**Files:**
- Modify: `package.json`
- Create: `docs/operations/configuration.md`
- Modify: `docs/superpowers/plans/2026-08-27-dsh-teams-implementation-tasking.md`

**Interfaces:**
- Consumes: `npm test --workspace @dsh-teams/core` and the documented environment contract.
- Produces: `npm run check` that includes core tests and an operator runbook that never requests plaintext secrets.

- [x] **Step 1: Add the check command and operator documentation**

```json
{
  "scripts": {
    "test:core": "npm test --workspace @dsh-teams/core",
    "check": "npm run lint:plan && npm run test:probe && npm run test:core"
  }
}
```

Document production HTTPS/Secure-Cookie requirements, explicit development-only insecure Cookie opt-in, loopback binding, the `env:VARIABLE_NAME` secret-reference format, SMTP activation, disabled-by-default factors, and configuration-error handling.

- [x] **Step 2: Run focused and full verification**

Run: `npm test --workspace @dsh-teams/core && npm run check`

Expected: PASS with the core contract and all pre-existing probe tests.

- [x] **Step 3: Mark the task complete and commit**

```bash
git add package.json docs/operations/configuration.md docs/superpowers/plans/2026-08-27-dsh-teams-implementation-tasking.md docs/superpowers/plans/2026-09-01-core-configuration-contract.md
git commit -m "docs(operations): record configuration contract"
```
