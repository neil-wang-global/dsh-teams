# DSH Teams Identity And Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement independent password identity, opaque sessions, bootstrap, account lifecycle changes, and persistent login throttling for DT-1-03.

**Architecture:** `IdentityService` owns transactional use of the existing SQLite authority. Password and opaque-token cryptography remain in separate modules; sessions keep only token digests and validate the stored user authorization version before returning a principal. A `002-identity` migration extends the foundation without changing its existing tables' semantics.

**Tech Stack:** Node.js ESM, `node:crypto`, `node:sqlite`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-03-dsh-teams-identity-session-design.md`

## Global Constraints

- Use the DT-1-02 `openDatabase({ path })` authority and preserve its fail-closed storage guarantees.
- Keep password, reset-token, session-token, and rate-limit plaintext out of SQLite, errors, and test diagnostics.
- Preserve the single-founder invariant from the initial migration.
- Do not add gateway, SMTP, audit, policy, factor, or multi-user enablement behavior.
- Add a failing focused test before each production behavior.

---

### Task 1: Extend The Stored Identity Contract

**Files:**
- Create: `packages/dsh-teams-core/src/db/migrations/002-identity.mjs`
- Modify: `packages/dsh-teams-core/src/db/migrations/index.mjs`
- Test: `packages/dsh-teams-core/test/identity.test.mjs`

**Interfaces:**
- Consumes: `applyMigrations(connection)` from `src/db/database.mjs`.
- Produces: `auth_sessions.auth_version`, `auth_sessions.restricted`, and `login_rate_limits` with no plaintext login key.

- [x] **Step 1: Write a migration assertion that expects the identity columns and table.**

```js
const opened = await openDatabase({ path: databasePath })
assert.deepEqual(
  opened.connection.prepare("SELECT name FROM pragma_table_info('auth_sessions') ORDER BY name").all().map(({ name }) => name),
  ['auth_version', 'created_at', 'expires_at', 'id', 'restricted', 'revoked_at', 'token_digest', 'updated_at', 'user_id'],
)
assert.equal(opened.connection.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'login_rate_limits'").get().name, 'login_rate_limits')
```

- [x] **Step 2: Run the focused test and confirm it fails because the columns and table are absent.**

Run: `npm test --workspace @dsh-teams/core -- --test-name-pattern='identity storage contract'`

- [x] **Step 3: Add migration version `002-identity`.**

```js
connection.exec(`
  ALTER TABLE auth_sessions ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0 CHECK (auth_version >= 0);
  ALTER TABLE auth_sessions ADD COLUMN restricted INTEGER NOT NULL DEFAULT 0 CHECK (restricted IN (0, 1));
  CREATE TABLE login_rate_limits (
    key_digest BLOB PRIMARY KEY,
    failure_count INTEGER NOT NULL CHECK (failure_count >= 0),
    window_started_at TEXT NOT NULL,
    blocked_until TEXT,
    updated_at TEXT NOT NULL
  );
`)
```

- [x] **Step 4: Re-run the focused test and verify it passes.**

Run: `npm test --workspace @dsh-teams/core -- --test-name-pattern='identity storage contract'`

### Task 2: Add Password And Opaque Session Primitives

**Files:**
- Create: `packages/dsh-teams-core/src/identity/passwords.mjs`
- Create: `packages/dsh-teams-core/src/identity/sessions.mjs`
- Test: `packages/dsh-teams-core/test/identity.test.mjs`

**Interfaces:**
- Produces: `hashPassword(password)`, `verifyPassword(password, hash)`, `hashOpaqueValue(value)`, `createOpaqueToken()`, and `createSessionRecord({ userId, authVersion, restricted, expiresAt })`.

- [x] **Step 1: Write failing tests for a verifiable versioned password hash and a random opaque session token whose digest differs from its token.**

```js
const passwordHash = await hashPassword('correct horse battery staple')
assert.equal(await verifyPassword('correct horse battery staple', passwordHash), true)
assert.equal(await verifyPassword('wrong password', passwordHash), false)
const session = createSessionRecord({ userId: 'user-1', authVersion: 0, restricted: false, expiresAt: now })
assert.notEqual(session.token, session.tokenDigest.toString('base64url'))
```

- [x] **Step 2: Run the focused tests and confirm imports fail because the modules do not exist.**

Run: `npm test --workspace @dsh-teams/core -- --test-name-pattern='password primitives|opaque session primitive'`

- [x] **Step 3: Implement scrypt hashes, SHA-256 digests, and 32-byte base64url tokens.**

```js
const digest = createHash('sha256').update(value).digest()
const token = randomBytes(32).toString('base64url')
```

- [x] **Step 4: Re-run the focused primitive tests and verify they pass.**

Run: `npm test --workspace @dsh-teams/core -- --test-name-pattern='password primitives|opaque session primitive'`

### Task 3: Implement Transactional Identity Operations

**Files:**
- Create: `packages/dsh-teams-core/src/identity/service.mjs`
- Modify: `packages/dsh-teams-core/src/errors.mjs`
- Test: `packages/dsh-teams-core/test/identity.test.mjs`

**Interfaces:**
- Consumes: an opened database plus password/session primitives.
- Produces: `IdentityService` with `bootstrapFounder`, `createTemporaryUser`, `authenticate`, `assertSession`, `rotateSession`, `changePassword`, `beginPasswordReset`, `resetPassword`, `setUserStatus`, and `setSystemRole`.

- [x] **Step 1: Add failing bootstrap and founder-invariant tests.**

```js
const service = new IdentityService(opened, { now: () => now })
const founder = await service.bootstrapFounder({ email: 'Founder@example.test', password: password })
await assert.rejects(() => service.bootstrapFounder({ email: 'other@example.test', password }), { code: 'founder-already-exists' })
await assert.rejects(() => service.setUserStatus({ actorUserId: founder.id, userId: founder.id, status: 'disabled' }), { code: 'founder-protected' })
```

- [x] **Step 2: Run the focused tests and confirm they fail because `IdentityService` is absent.**

Run: `npm test --workspace @dsh-teams/core -- --test-name-pattern='bootstrap|founder invariant'`

- [x] **Step 3: Implement input normalization, active-admin checks, founder bootstrap, temporary-user creation, and founder protection in explicit immediate transactions.**

```js
connection.exec('BEGIN IMMEDIATE')
try {
  // validate state, insert or update identity rows, then commit
  connection.exec('COMMIT')
} catch (error) {
  connection.exec('ROLLBACK')
  throw error
}
```

- [x] **Step 4: Add failing tests for restricted sessions, digest-only session storage, rotation, password changes/resets, lifecycle revocation, and durable rate limiting.**

```js
const login = await service.authenticate({ email: 'member@example.test', password })
assert.equal(opened.connection.prepare('SELECT token_digest FROM auth_sessions WHERE id = ?').get(login.session.id).token_digest.equals(Buffer.from(login.session.token)), false)
await assert.rejects(() => service.assertSession(login.session.token, { requireUnrestricted: true }), { status: 403 })
```

- [x] **Step 5: Run each focused test group and confirm every new assertion fails for the missing behavior.**

Run: `npm test --workspace @dsh-teams/core -- --test-name-pattern='session|password reset|rate limit|lifecycle revocation'`

- [x] **Step 6: Implement the minimal transactionally consistent session, password, reset, revocation, and rate-limit behavior.**

```js
connection.prepare('UPDATE users SET auth_version = auth_version + 1, updated_at = ? WHERE id = ?').run(now, userId)
connection.prepare('UPDATE auth_sessions SET revoked_at = ?, updated_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(now, now, userId)
```

- [x] **Step 7: Re-run the identity suite and verify all focused tests pass.**

Run: `npm test --workspace @dsh-teams/core -- --test-name-pattern='identity|session|password|rate limit|bootstrap|founder'`

### Task 4: Complete The Task Record And Verify The Repository

**Files:**
- Modify: `docs/superpowers/plans/2026-08-27-dsh-teams-implementation-tasking.md`
- Test: `packages/dsh-teams-core/test/identity.test.mjs`

- [x] **Step 1: Run the full core suite.**

Run: `npm test --workspace @dsh-teams/core`

- [x] **Step 2: Run repository verification.**

Run: `npm run check`

- [x] **Step 3: Mark DT-1-03 complete only after both commands pass, inspect the final diff, and create a focused conventional commit.**

```sh
git diff --check
git status --short
git add packages/dsh-teams-core docs/superpowers
git commit -m "feat(identity): establish password and session flows"
```
