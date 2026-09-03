import assert from 'node:assert/strict'
import { syncBuiltinESMExports } from 'node:module'
import fsPromises, { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import {
  StorageError,
  applyMigrations,
  createEncryptedBackup,
  openDatabase,
  restoreEncryptedBackup,
} from '../src/db/database.mjs'
import { loadConfig } from '../src/config.mjs'

async function createDatabasePath() {
  const root = await mkdtemp(path.join(await realpath(os.tmpdir()), 'dsh-teams-db-'))
  return {
    root,
    databasePath: path.join(root, 'state', 'teams', 'teams.sqlite3'),
    cleanup: () => rm(root, { force: true, recursive: true }),
  }
}

test('opens SQLite from the configured database path', async (t) => {
  const root = await mkdtemp(path.join(await realpath(os.tmpdir()), 'dsh-teams-configured-db-'))
  const config = loadConfig({
    DSH_TEAMS_MODE: 'development',
    DSH_TEAMS_CANONICAL_URL: 'http://localhost:3081',
    DSH_HOME: root,
    DSH_TEAMS_DSH_BIND: '127.0.0.1',
    DSH_TEAMS_DSH_PORT: '3080',
  })
  const database = await openDatabase(config.database)
  t.after(() => database.close())
  t.after(() => rm(root, { force: true, recursive: true }))

  assert.equal(database.path, config.database.path)
  assert.equal(database.connection.prepare('PRAGMA journal_mode').get().journal_mode, 'wal')
  assert.equal(database.connection.prepare('PRAGMA foreign_keys').get().foreign_keys, 1)
  assert.deepEqual(
    database.connection.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => row.version),
    ['001-initial', '002-identity'],
  )
  assert.equal((await lstat(config.database.path)).mode & 0o777, 0o600)
})

test('opens a secured SQLite database with WAL and foreign keys enabled', async (t) => {
  const { databasePath, cleanup } = await createDatabasePath()
  const database = await openDatabase({ path: databasePath, busyTimeoutMs: 25 })
  t.after(() => database.close())
  t.after(cleanup)

  assert.equal(database.connection.prepare('PRAGMA journal_mode').get().journal_mode, 'wal')
  assert.equal(database.connection.prepare('PRAGMA foreign_keys').get().foreign_keys, 1)
  assert.equal(database.connection.prepare('PRAGMA busy_timeout').get().timeout, 25)
  assert.equal((await lstat(path.dirname(databasePath))).mode & 0o777, 0o700)
  assert.equal((await lstat(databasePath)).mode & 0o777, 0o600)
})

test('rejects an existing teams directory with group-readable permissions', async (t) => {
  const { databasePath, cleanup } = await createDatabasePath()
  t.after(cleanup)
  const teamsDirectory = path.dirname(databasePath)
  await mkdir(teamsDirectory, { recursive: true, mode: 0o700 })
  await chmod(teamsDirectory, 0o750)

  await assert.rejects(
    () => openDatabase({ path: databasePath }),
    (error) => error instanceof StorageError && error.code === 'storage-directory-mode',
  )
})

test('rejects a teams directory symbolic link before opening SQLite', async (t) => {
  const { databasePath, cleanup } = await createDatabasePath()
  t.after(cleanup)
  const teamsDirectory = path.dirname(databasePath)
  const linkTarget = path.join(path.dirname(teamsDirectory), 'other-teams')
  await mkdir(linkTarget, { recursive: true, mode: 0o700 })
  await symlink(linkTarget, teamsDirectory)

  await assert.rejects(
    () => openDatabase({ path: databasePath }),
    (error) => error instanceof StorageError && error.code === 'storage-directory-realpath',
  )
})

test('rejects a symbolic-link path segment before creating the teams directory', async (t) => {
  const { root, cleanup } = await createDatabasePath()
  t.after(cleanup)
  const actualHome = path.join(root, 'actual-home')
  const linkedHome = path.join(root, 'linked-home')
  await mkdir(actualHome, { mode: 0o700 })
  await symlink(actualHome, linkedHome)

  await assert.rejects(
    () => openDatabase({ path: path.join(linkedHome, 'teams', 'teams.sqlite3') }),
    (error) => error instanceof StorageError && error.code === 'storage-directory-realpath',
  )
  await assert.rejects(() => lstat(path.join(actualHome, 'teams')), { code: 'ENOENT' })
})

test('rejects storage not owned by the expected runtime user', async (t) => {
  if (typeof process.getuid !== 'function') t.skip('UID checks are unavailable on this platform')

  const { databasePath, cleanup } = await createDatabasePath()
  t.after(cleanup)
  await assert.rejects(
    () => openDatabase({ path: databasePath, expectedUid: process.getuid() + 1 }),
    (error) => error instanceof StorageError && error.code === 'storage-directory-owner',
  )
})

test('applies the initial migration once and enforces its foreign keys', async (t) => {
  const { databasePath, cleanup } = await createDatabasePath()
  let database = await openDatabase({ path: databasePath })
  t.after(() => database.close())
  t.after(cleanup)

  assert.deepEqual(
    database.connection.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => row.version),
    ['001-initial', '002-identity'],
  )
  assert.throws(
    () => database.connection
      .prepare('INSERT INTO password_credentials (user_id, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('missing-user', 'hash', '2026-09-02T00:00:00.000Z', '2026-09-02T00:00:00.000Z'),
    /FOREIGN KEY constraint failed/,
  )

  database.close()
  database = await openDatabase({ path: databasePath })
  assert.deepEqual(
    database.connection.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => row.version),
    ['001-initial', '002-identity'],
  )
})

test('rolls back a failing migration without recording its version', (t) => {
  const connection = new DatabaseSync(':memory:')
  t.after(() => connection.close())

  assert.throws(
    () => applyMigrations(connection, [{
      version: '999-test-failure',
      up: (database) => {
        database.exec('CREATE TABLE should_not_exist (id INTEGER PRIMARY KEY)')
        throw new Error('intentional migration failure')
      },
    }]),
    (error) => error instanceof StorageError && error.code === 'storage-migration-failed',
  )
  assert.equal(
    connection.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'should_not_exist'").get(),
    undefined,
  )
  assert.deepEqual(connection.prepare('SELECT version FROM schema_migrations').all(), [])
})

test('bounds SQLite write contention by the configured busy timeout', async (t) => {
  const { databasePath, cleanup } = await createDatabasePath()
  const first = await openDatabase({ path: databasePath, busyTimeoutMs: 25 })
  const second = await openDatabase({ path: databasePath, busyTimeoutMs: 25 })
  t.after(() => first.close())
  t.after(() => second.close())
  t.after(cleanup)

  first.connection.exec('BEGIN IMMEDIATE')
  try {
    assert.throws(
      () => second.connection
        .prepare('INSERT INTO site_state (id, multi_user_enabled, created_at, updated_at) VALUES (1, 0, ?, ?)')
        .run('2026-09-02T00:00:00.000Z', '2026-09-02T00:00:00.000Z'),
      /database is locked/,
    )
  } finally {
    first.connection.exec('ROLLBACK')
  }
})

test('restores an authenticated encrypted backup without retaining a plaintext backup', async (t) => {
  const { databasePath, cleanup } = await createDatabasePath()
  const database = await openDatabase({ path: databasePath })
  t.after(() => database.close())
  const backupPath = path.join(database.backupDirectory, 'snapshot.dshb')
  const restoredPath = path.join(path.dirname(path.dirname(databasePath)), 'restored', 'teams', 'teams.sqlite3')
  const key = randomBytes(32)

  database.connection.prepare('INSERT INTO site_state (id, multi_user_enabled, created_at, updated_at) VALUES (1, 0, ?, ?)')
    .run('2026-09-02T00:00:00.000Z', '2026-09-02T00:00:00.000Z')
  await createEncryptedBackup(database, { destination: backupPath, key })

  const encrypted = await readFile(backupPath)
  assert.equal((await lstat(backupPath)).mode & 0o777, 0o600)
  assert.equal(encrypted.includes(Buffer.from('site_state')), false)
  await restoreEncryptedBackup({ source: backupPath, destination: restoredPath, key })

  const restored = await openDatabase({ path: restoredPath })
  t.after(() => restored.close())
  t.after(cleanup)
  assert.equal(restored.connection.prepare('SELECT count(*) AS count FROM site_state').get().count, 1)
})

test('rejects altered encrypted backups without creating a restore destination', async (t) => {
  const { databasePath, cleanup } = await createDatabasePath()
  const database = await openDatabase({ path: databasePath })
  t.after(() => database.close())
  t.after(cleanup)
  const backupPath = path.join(database.backupDirectory, 'altered.dshb')
  const restoredPath = path.join(path.dirname(path.dirname(databasePath)), 'restore-failure', 'teams', 'teams.sqlite3')
  const key = randomBytes(32)

  await createEncryptedBackup(database, { destination: backupPath, key })
  const altered = await readFile(backupPath)
  altered[altered.length - 1] ^= 1
  await writeFile(backupPath, altered)

  await assert.rejects(
    () => restoreEncryptedBackup({ source: backupPath, destination: restoredPath, key }),
    (error) => error instanceof StorageError && error.code === 'storage-backup-authentication',
  )
  await assert.rejects(() => lstat(restoredPath), { code: 'ENOENT' })
})

test('removes a restore destination when post-rename artifact validation fails', async (t) => {
  const { root, databasePath, cleanup } = await createDatabasePath()
  const source = await openDatabase({ path: databasePath })
  const backupPath = path.join(source.backupDirectory, 'post-rename-failure.dshb')
  const restoredPath = path.join(root, 'post-rename-failure', 'teams', 'teams.sqlite3')
  const key = randomBytes(32)

  await createEncryptedBackup(source, { destination: backupPath, key })
  source.close()
  await mkdir(path.dirname(restoredPath), { recursive: true, mode: 0o700 })

  const originalChmod = fsPromises.chmod
  fsPromises.chmod = async (target, mode) => {
    if (target === restoredPath) {
      const error = new Error('forced post-rename chmod failure')
      error.code = 'EIO'
      throw error
    }
    return originalChmod(target, mode)
  }
  syncBuiltinESMExports()
  t.after(() => {
    fsPromises.chmod = originalChmod
    syncBuiltinESMExports()
  })
  t.after(cleanup)

  await assert.rejects(
    () => restoreEncryptedBackup({ source: backupPath, destination: restoredPath, key }),
    (error) => error instanceof StorageError && error.code === 'storage-restore-failed',
  )
  await assert.rejects(() => lstat(restoredPath), { code: 'ENOENT' })
})

test('requires a 32-byte backup key', async (t) => {
  const { databasePath, cleanup } = await createDatabasePath()
  const database = await openDatabase({ path: databasePath })
  t.after(() => database.close())
  t.after(cleanup)

  await assert.rejects(
    () => createEncryptedBackup(database, {
      destination: path.join(database.backupDirectory, 'invalid-key.dshb'),
      key: Buffer.alloc(31),
    }),
    (error) => error instanceof StorageError && error.code === 'storage-backup-key',
  )
})
