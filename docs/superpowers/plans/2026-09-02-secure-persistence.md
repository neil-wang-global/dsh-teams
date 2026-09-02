# Secure Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a fail-closed SQLite authority with secure local storage, idempotent schema migration, and encrypted backup/restore primitives.

**Architecture:** `@dsh-teams/core` uses Node's built-in `node:sqlite` `DatabaseSync` for a synchronous process-local SQLite connection. A permissions module validates the real filesystem path and every SQLite artifact before opening it; the database module applies monotonic migrations in an explicit immediate transaction, configures WAL/foreign keys/busy timeout, and exposes encrypted backup and restore operations using AES-256-GCM with a caller-supplied 32-byte secret.

**Tech Stack:** Node.js 26 built-in `node:sqlite`, `node:crypto`, `node:fs/promises`, and `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-27-dsh-teams-user-authorization-design.md`

## Global Constraints

- Database location remains the path derived by `loadConfig`, normally `$DSH_HOME/teams/teams.sqlite3`.
- The teams directory and backup directory must be owned by the runtime UID, have mode `0700`, and contain no symlinked path segment.
- Existing database, WAL, SHM, temporary backup, and encrypted backup files must be owned by the runtime UID, regular files, and mode `0600`.
- SQLite must enable WAL, `foreign_keys=ON`, a finite busy timeout, explicit `BEGIN IMMEDIATE` migration transactions, and `PRAGMA integrity_check` at startup.
- Migration versions are strictly increasing and are recorded only after their migration succeeds in the same transaction.
- Backup encryption uses AES-256-GCM with a caller-provided 32-byte key; no secret is written to configuration, schema, logs, errors, or documentation examples.
- This task establishes persistence foundations only. It does not add user bootstrap, identity, policy, gateway, or DSH migration behavior.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `packages/dsh-teams-core/src/db/permissions.mjs` | Validates and creates secure database/backup directories and rejects unsafe artifacts. |
| `packages/dsh-teams-core/src/db/migrations/001-initial.mjs` | Defines the initial schema and its single ordered migration. |
| `packages/dsh-teams-core/src/db/database.mjs` | Opens and configures SQLite, applies migrations, checks integrity, and performs encrypted backup/restore. |
| `packages/dsh-teams-core/test/db.test.mjs` | Exercises real SQLite security, migration, contention, and backup behavior. |
| `docs/operations/backup-and-restore.md` | Gives operators a secret-free backup and recovery procedure. |
| `docs/superpowers/plans/2026-08-27-dsh-teams-implementation-tasking.md` | Marks DT-1-02 complete only after full-suite evidence. |

### Task 1: Secure Local Storage and SQLite Lifecycle

**Files:**
- Create: `packages/dsh-teams-core/src/db/permissions.mjs`
- Create: `packages/dsh-teams-core/src/db/database.mjs`
- Create: `packages/dsh-teams-core/test/db.test.mjs`

**Interfaces:**
- Consumes: `{ path: string }` from `loadConfig(...).database`.
- Produces: `openDatabase({ path, expectedUid?, busyTimeoutMs? })` returning `{ connection, path, backupDirectory, close() }`.
- Produces: `StorageError` with stable, secret-free error codes for unsafe filesystem and SQLite startup state.

- [x] **Step 1: Write failing lifecycle and path-safety tests**

```js
test('opens a secure database with WAL, foreign keys, and an integrity check', async () => {
  const opened = await openDatabase({ path: databasePath })
  assert.equal(opened.connection.prepare('PRAGMA journal_mode').get().journal_mode, 'wal')
  assert.equal(opened.connection.prepare('PRAGMA foreign_keys').get().foreign_keys, 1)
  opened.close()
})

test('rejects a group-readable teams directory and a symlinked database path', async () => {
  await chmod(teamsDirectory, 0o750)
  await assert.rejects(() => openDatabase({ path: databasePath }), { code: 'storage-directory-mode' })
})
```

- [x] **Step 2: Run the focused test and verify it fails**

Run: `npm test --workspace @dsh-teams/core -- --test-name-pattern='secure database|unsafe teams directory'`

Expected: FAIL because `openDatabase` and `StorageError` do not exist.

- [x] **Step 3: Implement secure artifact checks and database opening**

```js
export async function openDatabase({ path, expectedUid = process.getuid(), busyTimeoutMs = 5_000 }) {
  const backupDirectory = await prepareStoragePaths(path, expectedUid)
  const connection = new DatabaseSync(path, { enableForeignKeyConstraints: true, timeout: busyTimeoutMs })
  connection.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = ${busyTimeoutMs};`)
  assertIntegrity(connection)
  return Object.freeze({ connection, path, backupDirectory, close: () => connection.close() })
}
```

`prepareStoragePaths` must create only new `teams` and `backups` directories at `0700`; it must reject, rather than repair, an existing wrong owner/mode, symlink, non-directory, non-regular database artifact, or realpath mismatch.

- [x] **Step 4: Run lifecycle tests and the core test suite**

Run: `npm test --workspace @dsh-teams/core`

Expected: PASS with tests proving safe creation, WAL, foreign keys, busy timeout, realpath/symlink rejection, owner mismatch through injected `expectedUid`, and unsafe modes.

### Task 2: Transactional Initial Schema and Monotonic Migration

**Files:**
- Create: `packages/dsh-teams-core/src/db/migrations/001-initial.mjs`
- Modify: `packages/dsh-teams-core/src/db/database.mjs`
- Modify: `packages/dsh-teams-core/test/db.test.mjs`

**Interfaces:**
- Consumes: an open `DatabaseSync` connection from Task 1.
- Produces: `applyMigrations(connection)` and an initial schema containing `site_state`, identity, session, factor, workspace, epoch, root/grant, membership, holder, outbox, audit, and operation-journal tables.

- [x] **Step 1: Add failing migration, foreign-key, and contention tests**

```js
test('records the initial migration once and preserves foreign-key enforcement after reopen', async () => {
  const first = await openDatabase({ path: databasePath })
  assert.equal(first.connection.prepare('SELECT count(*) AS count FROM schema_migrations').get().count, 1)
  first.close()
  const second = await openDatabase({ path: databasePath })
  assert.throws(() => second.connection.prepare('INSERT INTO password_credentials (user_id, password_hash) VALUES (?, ?)').run('missing', 'hash'))
  second.close()
})
```

- [x] **Step 2: Run the migration test and verify it fails**

Run: `npm test --workspace @dsh-teams/core -- --test-name-pattern='initial migration once'`

Expected: FAIL because no migration registry or schema exists.

- [x] **Step 3: Implement the ordered migration registry and initial schema**

```js
export const migrations = [initialMigration]

export function applyMigrations(connection) {
  connection.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)')
  for (const migration of migrations) {
    if (connection.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(migration.version)) continue
    connection.exec('BEGIN IMMEDIATE')
    try {
      migration.up(connection)
      connection.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(migration.version, new Date().toISOString())
      connection.exec('COMMIT')
    } catch (error) {
      connection.exec('ROLLBACK')
      throw error
    }
  }
}
```

The initial migration must create the planned tables with primary keys, timestamps, explicit status checks where needed, and foreign keys for credentials, sessions, factors, memberships, holders, outbox, audit, and journal records.

- [x] **Step 4: Run focused and complete core tests**

Run: `npm test --workspace @dsh-teams/core`

Expected: PASS with idempotent migration, foreign-key rejection, startup integrity, and a real `SQLITE_BUSY` contention case bounded by the configured timeout.

### Task 3: Encrypted Backup and Restore

**Files:**
- Modify: `packages/dsh-teams-core/src/db/database.mjs`
- Modify: `packages/dsh-teams-core/test/db.test.mjs`

**Interfaces:**
- Consumes: an open database object and a 32-byte `Buffer` supplied by the caller.
- Produces: `createEncryptedBackup(opened, { destination, key })` and `restoreEncryptedBackup({ source, destination, key, expectedUid? })`.

- [x] **Step 1: Add failing encrypted backup and corruption tests**

```js
test('restores an authenticated encrypted backup without retaining plaintext backup data', async () => {
  const opened = await openDatabase({ path: databasePath })
  opened.connection.prepare('INSERT INTO site_state (id, multi_user_enabled) VALUES (1, 0)').run()
  await createEncryptedBackup(opened, { destination: backupPath, key: backupKey })
  await restoreEncryptedBackup({ source: backupPath, destination: restoredPath, key: backupKey })
  const restored = await openDatabase({ path: restoredPath })
  assert.equal(restored.connection.prepare('SELECT count(*) AS count FROM site_state').get().count, 1)
  restored.close()
})
```

- [x] **Step 2: Run the backup test and verify it fails**

Run: `npm test --workspace @dsh-teams/core -- --test-name-pattern='authenticated encrypted backup'`

Expected: FAIL because backup functions do not exist.

- [x] **Step 3: Implement authenticated backup and atomic restore**

```js
const MAGIC = Buffer.from('DSHTBKP1')

export async function createEncryptedBackup(opened, { destination, key }) {
  assertBackupKey(key)
  const temporary = await createSecureTemporaryBackup(opened.backupDirectory)
  await backup(opened.connection, temporary)
  const plaintext = await readFile(temporary)
  await rm(temporary, { force: true })
  await writeNewSecureFile(destination, encrypt(plaintext, key))
}
```

Use a random 12-byte nonce and GCM authentication tag after the magic prefix. Restore must reject an invalid key, malformed header, altered ciphertext, unsafe source/destination, or failing `PRAGMA integrity_check`, and must leave no destination database on failure.

- [x] **Step 4: Run focused and complete verification**

Run: `npm test --workspace @dsh-teams/core && npm run check`

Expected: PASS with backup/restore, corruption rejection, key validation, secure artifact modes, migration, and all existing probe tests.

### Task 4: Operator Runbook and Completion Record

**Files:**
- Create: `docs/operations/backup-and-restore.md`
- Modify: `docs/superpowers/plans/2026-08-27-dsh-teams-implementation-tasking.md`

**Interfaces:**
- Consumes: encrypted backup/restore API and the caller-supplied 32-byte backup key contract.
- Produces: a secret-free operator procedure and an accurate task status record.

- [x] **Step 1: Write the backup and restore runbook**

Document secure directory/file permissions, key handling without literal secrets, backup creation, isolated restore verification, integrity validation, retained backup handling, and failure response. State that a plaintext SQLite copy must never remain after a backup operation.

- [x] **Step 2: Run the complete verification suite**

Run: `npm run check`

Expected: PASS with the database and existing probe suites.

- [x] **Step 3: Mark DT-1-02 complete and commit the implementation**

Update the status row only after the command in Step 2 passes. Stage the database modules, test, runbook, and task record, then create an English conventional commit describing secure persistent storage.

## Plan Self-Review

- Spec coverage: Tasks 1-3 implement the storage mode/owner/realpath/symlink, SQLite/WAL/foreign-key/busy/migration/integrity, and encrypted backup/restore requirements from sections 11 and 15.8. Task 4 implements the operator evidence requirement.
- Scope: Founder migration, identity, policy, and saga workflows remain explicitly deferred to their named DT tasks.
- Consistency: `openDatabase`, `applyMigrations`, `createEncryptedBackup`, and `restoreEncryptedBackup` are defined before later tasks consume them; all tests exercise live SQLite and filesystem behavior.
