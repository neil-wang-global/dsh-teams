// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'

import { StorageError } from '../errors.mjs'
import {
  assertDatabaseArtifacts,
  assertSecureFileIfPresent,
  prepareDatabaseStorage,
  secureNewFile,
} from './permissions.mjs'
import { migrations } from './migrations/index.mjs'

export { StorageError } from '../errors.mjs'

const DEFAULT_BUSY_TIMEOUT_MS = 5_000
const BACKUP_MAGIC = Buffer.from('DSHTBKP1')
const BACKUP_NONCE_BYTES = 12
const BACKUP_TAG_BYTES = 16

function readBusyTimeout(value) {
  if (value === undefined) return DEFAULT_BUSY_TIMEOUT_MS
  if (!Number.isSafeInteger(value) || value < 0 || value > 60_000) {
    throw new StorageError('storage-busy-timeout', 'busy timeout must be an integer between 0 and 60000 ms')
  }
  return value
}

function closeQuietly(connection) {
  try {
    connection.close()
  } catch {
    // Keep the original initialization failure for operators.
  }
}

function yieldEventLoop() {
  return new Promise((resolve) => setImmediate(resolve))
}

function assertMigrationHistory(connection, registeredMigrations) {
  const recorded = connection.prepare('SELECT version FROM schema_migrations ORDER BY version').all()
  const expected = registeredMigrations.slice(0, recorded.length).map((migration) => migration.version)
  if (recorded.length > registeredMigrations.length || recorded.some((row, index) => row.version !== expected[index])) {
    throw new StorageError('storage-migration-history', 'database migration history is incompatible with this service')
  }
}

export function applyMigrations(connection, registeredMigrations = migrations) {
  const versions = registeredMigrations.map((migration) => migration.version)
  if (
    versions.some((version, index) => typeof version !== 'string' || index > 0 && version <= versions[index - 1])
    || new Set(versions).size !== versions.length
    || registeredMigrations.some((migration) => typeof migration.up !== 'function')
  ) {
    throw new StorageError('storage-migration-registry', 'database migration registry is invalid')
  }

  connection.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
  assertMigrationHistory(connection, registeredMigrations)

  const applied = new Set(connection.prepare('SELECT version FROM schema_migrations').all().map((row) => row.version))
  for (const migration of registeredMigrations) {
    if (applied.has(migration.version)) continue
    connection.exec('BEGIN IMMEDIATE')
    try {
      migration.up(connection)
      connection.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        migration.version,
        new Date().toISOString(),
      )
      connection.exec('COMMIT')
    } catch (error) {
      connection.exec('ROLLBACK')
      throw new StorageError('storage-migration-failed', 'database migration failed')
    }
  }
}

export function assertDatabaseIntegrity(connection) {
  const integrity = connection.prepare('PRAGMA integrity_check').get()
  if (integrity?.integrity_check !== 'ok') {
    throw new StorageError('storage-integrity-check', 'database integrity check failed')
  }
  if (connection.prepare('PRAGMA foreign_key_check').all().length !== 0) {
    throw new StorageError('storage-foreign-key-check', 'database foreign-key check failed')
  }
}

function assertBackupKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new StorageError('storage-backup-key', 'backup key must be a 32-byte Buffer')
  }
}

function assertBackupDestination(destination, backupDirectory) {
  if (typeof destination !== 'string' || !path.isAbsolute(destination)) {
    throw new StorageError('storage-backup-destination', 'backup destination must be an absolute path')
  }
  if (path.resolve(path.dirname(destination)) !== path.resolve(backupDirectory)) {
    throw new StorageError('storage-backup-destination', 'backup destination must be inside the managed backup directory')
  }
}

function encryptBackup(plaintext, key) {
  const nonce = randomBytes(BACKUP_NONCE_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([BACKUP_MAGIC, nonce, cipher.getAuthTag(), ciphertext])
}

function decryptBackup(encrypted, key) {
  const headerBytes = BACKUP_MAGIC.length + BACKUP_NONCE_BYTES + BACKUP_TAG_BYTES
  if (encrypted.length <= headerBytes || !encrypted.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) {
    throw new StorageError('storage-backup-format', 'backup format is invalid')
  }

  const nonceStart = BACKUP_MAGIC.length
  const tagStart = nonceStart + BACKUP_NONCE_BYTES
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, encrypted.subarray(nonceStart, tagStart))
    decipher.setAuthTag(encrypted.subarray(tagStart, headerBytes))
    return Buffer.concat([decipher.update(encrypted.subarray(headerBytes)), decipher.final()])
  } catch {
    throw new StorageError('storage-backup-authentication', 'backup authentication failed')
  }
}

async function writeNewPrivateFile(destination, content, expectedUid) {
  try {
    await writeFile(destination, content, { flag: 'wx', mode: 0o600 })
    await secureNewFile(destination)
    await assertSecureFileIfPresent(destination, { expectedUid })
  } catch (error) {
    if (error instanceof StorageError) throw error
    if (error?.code === 'EEXIST') {
      throw new StorageError('storage-backup-exists', 'backup destination already exists')
    }
    throw new StorageError('storage-backup-write', 'unable to write encrypted backup')
  }
}

async function verifyRestorableSqlite(temporaryPath) {
  let restored
  try {
    restored = new DatabaseSync(temporaryPath, { enableForeignKeyConstraints: true, readOnly: true })
    assertDatabaseIntegrity(restored)
  } catch (error) {
    if (error instanceof StorageError) throw error
    throw new StorageError('storage-restore-integrity', 'restored database integrity check failed')
  } finally {
    if (restored !== undefined) closeQuietly(restored)
  }
}

export async function createEncryptedBackup(opened, { destination, key } = {}) {
  if (!opened?.connection || typeof opened.backupDirectory !== 'string') {
    throw new StorageError('storage-backup-source', 'opened database is required for backup')
  }
  assertBackupKey(key)
  assertBackupDestination(destination, opened.backupDirectory)
  const temporaryPath = path.join(opened.backupDirectory, `.${randomUUID()}.sqlite3`)

  try {
    // node:sqlite schedules online backup work asynchronously after prior backups finish.
    await yieldEventLoop()
    await backup(opened.connection, temporaryPath)
    await secureNewFile(temporaryPath)
    await assertSecureFileIfPresent(temporaryPath, { expectedUid: opened.expectedUid })
    const plaintext = await readFile(temporaryPath)
    await writeNewPrivateFile(destination, encryptBackup(plaintext, key), opened.expectedUid)
    return Object.freeze({ destination })
  } catch (error) {
    if (error instanceof StorageError) throw error
    throw new StorageError('storage-backup-create', 'unable to create encrypted backup')
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

export async function restoreEncryptedBackup({ source, destination, key, expectedUid } = {}) {
  assertBackupKey(key)
  let temporaryPath
  let destinationCreated = false
  try {
    const sourceIsPresent = await assertSecureFileIfPresent(source, { expectedUid })
    if (!sourceIsPresent) {
      throw new StorageError('storage-backup-source', 'encrypted backup does not exist')
    }

    let plaintext
    try {
      plaintext = decryptBackup(await readFile(source), key)
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('storage-backup-read', 'unable to read encrypted backup')
    }

    const storage = await prepareDatabaseStorage(destination, { expectedUid })
    if (await assertSecureFileIfPresent(destination, { expectedUid })) {
      throw new StorageError('storage-restore-exists', 'restore destination already exists')
    }

    temporaryPath = path.join(storage.databaseDirectory, `.${randomUUID()}.restore.sqlite3`)
    await writeNewPrivateFile(temporaryPath, plaintext, expectedUid)
    await verifyRestorableSqlite(temporaryPath)
    await rename(temporaryPath, destination)
    destinationCreated = true
    await secureNewFile(destination)
    await assertDatabaseArtifacts(destination, { expectedUid })
    return Object.freeze({ destination })
  } catch (error) {
    if (destinationCreated) {
      try {
        await rm(destination, { force: true })
      } catch {
        throw new StorageError('storage-restore-cleanup', 'unable to remove failed restore destination')
      }
    }
    if (error instanceof StorageError) throw error
    throw new StorageError('storage-restore-failed', 'unable to restore encrypted backup')
  } finally {
    if (temporaryPath !== undefined) await rm(temporaryPath, { force: true })
  }
}

export async function openDatabase({ path: databasePath, busyTimeoutMs, expectedUid } = {}) {
  const timeout = readBusyTimeout(busyTimeoutMs)
  let storage
  let connection

  try {
    storage = await prepareDatabaseStorage(databasePath, { expectedUid })
    connection = new DatabaseSync(databasePath, { enableForeignKeyConstraints: true })
    await secureNewFile(databasePath)
    connection.exec(`PRAGMA busy_timeout = ${timeout}`)
    connection.exec('PRAGMA journal_mode = WAL')
    connection.exec('PRAGMA foreign_keys = ON')
    applyMigrations(connection)
    assertDatabaseIntegrity(connection)
    await secureNewFile(databasePath)
    await assertDatabaseArtifacts(databasePath, { expectedUid })
  } catch (error) {
    if (connection !== undefined) closeQuietly(connection)
    if (error instanceof StorageError) throw error
    throw new StorageError('storage-open-failed', 'unable to initialize SQLite storage')
  }

  return Object.freeze({
    connection,
    path: databasePath,
    backupDirectory: storage.backupDirectory,
    expectedUid,
    close: () => connection.close(),
  })
}
