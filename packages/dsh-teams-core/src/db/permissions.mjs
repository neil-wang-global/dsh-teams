// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { chmod, lstat, mkdir, realpath } from 'node:fs/promises'
import path from 'node:path'

import { StorageError } from '../errors.mjs'

const DIRECTORY_MODE = 0o700
const FILE_MODE = 0o600

function fail(code, message) {
  throw new StorageError(code, message)
}

function expectedRuntimeUid() {
  return typeof process.getuid === 'function' ? process.getuid() : undefined
}

function isMissing(error) {
  return error?.code === 'ENOENT'
}

async function existingLstat(target) {
  try {
    return await lstat(target)
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
}

function assertOwner(stats, expectedUid, code) {
  if (expectedUid !== undefined && stats.uid !== expectedUid) {
    fail(code, 'storage artifact is not owned by the runtime user')
  }
}

function assertPrivateMode(stats, code) {
  if ((stats.mode & 0o077) !== 0) {
    fail(code, 'storage artifact must not be accessible by group or other users')
  }
}

async function assertCanonicalPath(target, code) {
  try {
    await realpath(target)
  } catch {
    fail(code, 'storage path must resolve to an existing filesystem entry')
  }
}

async function assertNoSymbolicLinkSegments(target, code) {
  const absolute = path.resolve(target)
  const root = path.parse(absolute).root
  let current = root
  const segments = absolute.slice(root.length).split(path.sep).filter(Boolean)

  for (const segment of segments) {
    current = path.join(current, segment)
    const stats = await existingLstat(current)
    if (stats === undefined) return
    if (stats.isSymbolicLink()) {
      fail(code, 'storage path must not contain a symbolic-link segment')
    }
  }
}

export async function ensureSecureDirectory(directory, { expectedUid = expectedRuntimeUid() } = {}) {
  if (!path.isAbsolute(directory)) {
    fail('storage-path-invalid', 'storage directory must be absolute')
  }

  await assertNoSymbolicLinkSegments(directory, 'storage-directory-realpath')
  let stats = await existingLstat(directory)
  if (stats === undefined) {
    await mkdir(directory, { recursive: true, mode: DIRECTORY_MODE })
    await chmod(directory, DIRECTORY_MODE)
    stats = await lstat(directory)
  }

  if (stats.isSymbolicLink()) {
    fail('storage-directory-symlink', 'storage directory must not be a symbolic link')
  }
  if (!stats.isDirectory()) {
    fail('storage-directory-type', 'storage directory must be a directory')
  }
  assertOwner(stats, expectedUid, 'storage-directory-owner')
  assertPrivateMode(stats, 'storage-directory-mode')
  await assertCanonicalPath(directory, 'storage-directory-realpath')
}

export async function assertSecureFileIfPresent(file, { expectedUid = expectedRuntimeUid() } = {}) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) {
    fail('storage-path-invalid', 'storage file path must be absolute')
  }
  await assertNoSymbolicLinkSegments(file, 'storage-file-realpath')
  const stats = await existingLstat(file)
  if (stats === undefined) return false
  if (stats.isSymbolicLink()) {
    fail('storage-file-symlink', 'storage file must not be a symbolic link')
  }
  if (!stats.isFile()) {
    fail('storage-file-type', 'storage file must be a regular file')
  }
  assertOwner(stats, expectedUid, 'storage-file-owner')
  assertPrivateMode(stats, 'storage-file-mode')
  await assertCanonicalPath(file, 'storage-file-realpath')
  return true
}

export async function secureNewFile(file) {
  await chmod(file, FILE_MODE)
}

export async function prepareDatabaseStorage(databasePath, options = {}) {
  if (typeof databasePath !== 'string' || !path.isAbsolute(databasePath)) {
    fail('storage-path-invalid', 'database path must be an absolute path')
  }

  const databaseDirectory = path.dirname(databasePath)
  const backupDirectory = path.join(databaseDirectory, 'backups')
  await ensureSecureDirectory(databaseDirectory, options)
  await ensureSecureDirectory(backupDirectory, options)
  await assertSecureFileIfPresent(databasePath, options)
  await assertSecureFileIfPresent(`${databasePath}-wal`, options)
  await assertSecureFileIfPresent(`${databasePath}-shm`, options)

  return Object.freeze({ databaseDirectory, backupDirectory })
}

export async function assertDatabaseArtifacts(databasePath, options = {}) {
  await assertSecureFileIfPresent(databasePath, options)
  await assertSecureFileIfPresent(`${databasePath}-wal`, options)
  await assertSecureFileIfPresent(`${databasePath}-shm`, options)
}
