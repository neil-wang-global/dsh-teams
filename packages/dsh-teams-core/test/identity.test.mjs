// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { openDatabase } from '../src/db/database.mjs'
import { hashOpaqueValue, hashPassword, verifyPassword } from '../src/identity/passwords.mjs'
import { IdentityService } from '../src/identity/service.mjs'
import { createSessionRecord } from '../src/identity/sessions.mjs'

async function createDatabasePath() {
  const directory = await mkdtemp(path.join(await realpath(os.tmpdir()), 'dsh-teams-identity-'))
  return { directory, databasePath: path.join(directory, 'teams', 'teams.sqlite3') }
}

test('identity storage contract records session authorization state without plaintext rate-limit keys', async (t) => {
  const { directory, databasePath } = await createDatabasePath()
  t.after(() => rm(directory, { force: true, recursive: true }))

  const opened = await openDatabase({ path: databasePath })
  t.after(() => opened.close())

  assert.deepEqual(
    opened.connection
      .prepare("SELECT name FROM pragma_table_info('auth_sessions') ORDER BY name")
      .all()
      .map(({ name }) => name),
    [
      'auth_version',
      'created_at',
      'expires_at',
      'id',
      'restricted',
      'revoked_at',
      'token_digest',
      'updated_at',
      'user_id',
    ],
  )
  assert.deepEqual(
    opened.connection
      .prepare("SELECT name FROM pragma_table_info('login_rate_limits') ORDER BY name")
      .all()
      .map(({ name }) => name),
    ['blocked_until', 'failure_count', 'key_digest', 'updated_at', 'window_started_at'],
  )
})

test('password primitives reject a wrong password without retaining it in the hash', async () => {
  const password = 'correct horse battery staple'
  const passwordHash = await hashPassword(password)

  assert.match(passwordHash, /^scrypt\$/)
  assert.equal(passwordHash.includes(password), false)
  assert.equal(await verifyPassword(password, passwordHash), true)
  assert.equal(await verifyPassword('incorrect horse battery staple', passwordHash), false)
})

test('opaque session primitive keeps a random token separate from its persisted digest', () => {
  const session = createSessionRecord({
    userId: 'user-1',
    authVersion: 4,
    restricted: true,
    expiresAt: '2026-09-04T00:00:00.000Z',
  })

  assert.match(session.token, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(session.token.includes('user-1'), false)
  assert.equal(session.tokenDigest.equals(hashOpaqueValue(session.token)), true)
  assert.equal(session.authVersion, 4)
  assert.equal(session.restricted, true)
})

test('bootstrap creates one protected founder without storing its plaintext password', async (t) => {
  const { directory, databasePath } = await createDatabasePath()
  t.after(() => rm(directory, { force: true, recursive: true }))

  const opened = await openDatabase({ path: databasePath })
  t.after(() => opened.close())
  const service = new IdentityService(opened, { now: () => new Date('2026-09-03T12:00:00.000Z') })

  const founder = await service.bootstrapFounder({
    email: 'Founder@Example.test',
    password: 'correct horse battery staple',
  })
  const stored = opened.connection.prepare('SELECT * FROM users WHERE id = ?').get(founder.id)
  const credential = opened.connection.prepare('SELECT password_hash FROM password_credentials WHERE user_id = ?').get(founder.id)

  assert.deepEqual(founder, {
    id: founder.id,
    email: 'Founder@Example.test',
    systemRole: 'admin',
    status: 'active',
    isFounder: true,
    mustChangePassword: false,
    authVersion: 0,
  })
  assert.equal(stored.email_normalized, 'founder@example.test')
  assert.equal(credential.password_hash.includes('correct horse battery staple'), false)
  assert.equal(opened.connection.prepare('SELECT epoch FROM principal_epochs WHERE user_id = ?').get(founder.id).epoch, 0)
  await assert.rejects(
    () => service.bootstrapFounder({ email: 'other@example.test', password: 'another correct password' }),
    { code: 'founder-already-exists' },
  )
  assert.throws(
    () => service.setUserStatus({ actorUserId: founder.id, userId: founder.id, status: 'disabled' }),
    { code: 'founder-protected' },
  )
})

test('active admins create temporary users whose restricted opaque sessions rotate safely', async (t) => {
  const { directory, databasePath } = await createDatabasePath()
  t.after(() => rm(directory, { force: true, recursive: true }))
  const opened = await openDatabase({ path: databasePath })
  t.after(() => opened.close())
  const service = new IdentityService(opened, { now: () => new Date('2026-09-03T12:00:00.000Z') })
  const founder = await service.bootstrapFounder({ email: 'founder@example.test', password: 'founder password' })
  const member = await service.createTemporaryUser({
    actorUserId: founder.id,
    email: 'member@example.test',
    password: 'temporary password',
  })

  assert.equal(member.mustChangePassword, true)
  const login = await service.authenticate({ email: 'member@example.test', password: 'temporary password' })
  const stored = opened.connection.prepare('SELECT token_digest, restricted FROM auth_sessions WHERE id = ?').get(login.session.id)

  assert.equal(login.session.restricted, true)
  assert.equal(Buffer.from(stored.token_digest).equals(Buffer.from(login.session.token)), false)
  assert.equal(stored.restricted, 1)
  await assert.rejects(
    () => service.assertSession(login.session.token, { requireUnrestricted: true }),
    { code: 'session-restricted', status: 403 },
  )
  const rotated = await service.rotateSession(login.session.token)
  await assert.rejects(() => service.assertSession(login.session.token), { code: 'session-invalid', status: 401 })
  assert.equal((await service.assertSession(rotated.token)).user.id, member.id)
})

test('password reset and account lifecycle changes revoke stale sessions while preserving founder protection', async (t) => {
  const { directory, databasePath } = await createDatabasePath()
  t.after(() => rm(directory, { force: true, recursive: true }))
  const opened = await openDatabase({ path: databasePath })
  t.after(() => opened.close())
  const service = new IdentityService(opened, { now: () => new Date('2026-09-03T12:00:00.000Z') })
  const founder = await service.bootstrapFounder({ email: 'founder@example.test', password: 'founder password' })
  const member = await service.createTemporaryUser({
    actorUserId: founder.id,
    email: 'member@example.test',
    password: 'temporary password',
  })
  const firstLogin = await service.authenticate({ email: member.email, password: 'temporary password' })

  await service.changePassword({
    userId: member.id,
    currentPassword: 'temporary password',
    newPassword: 'changed password',
  })
  await assert.rejects(() => service.assertSession(firstLogin.session.token), { code: 'session-invalid', status: 401 })
  const changedLogin = await service.authenticate({ email: member.email, password: 'changed password' })
  const reset = await service.beginPasswordReset({ email: member.email })
  assert.equal(reset.token.includes(member.email), false)
  await service.resetPassword({ token: reset.token, newPassword: 'reset password' })
  await assert.rejects(() => service.assertSession(changedLogin.session.token), { code: 'session-invalid', status: 401 })
  await assert.rejects(() => service.resetPassword({ token: reset.token, newPassword: 'reused reset password' }), { code: 'reset-token-invalid' })

  service.setUserStatus({ actorUserId: founder.id, userId: member.id, status: 'disabled' })
  await assert.rejects(() => service.authenticate({ email: member.email, password: 'reset password' }), { code: 'authentication-invalid', status: 401 })
  service.setUserStatus({ actorUserId: founder.id, userId: member.id, status: 'active' })
  const changedRole = service.setSystemRole({ actorUserId: founder.id, userId: member.id, systemRole: 'admin' })
  assert.equal(changedRole.systemRole, 'admin')
  assert.throws(
    () => service.setSystemRole({ actorUserId: founder.id, userId: founder.id, systemRole: 'user' }),
    { code: 'founder-protected', status: 403 },
  )
})

test('failed login rate limits survive service reconstruction without revealing account state', async (t) => {
  const { directory, databasePath } = await createDatabasePath()
  t.after(() => rm(directory, { force: true, recursive: true }))
  const opened = await openDatabase({ path: databasePath })
  t.after(() => opened.close())
  let now = new Date('2026-09-03T12:00:00.000Z')
  const service = new IdentityService(opened, { now: () => now })
  await service.bootstrapFounder({ email: 'founder@example.test', password: 'founder password' })

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(
      () => service.authenticate({ email: 'missing@example.test', password: 'wrong password' }),
      { code: 'authentication-invalid', status: 401 },
    )
  }
  const restartedService = new IdentityService(opened, { now: () => now })
  await assert.rejects(
    () => restartedService.authenticate({ email: 'missing@example.test', password: 'another wrong password' }),
    { code: 'authentication-invalid', status: 401 },
  )
  const rateLimit = opened.connection.prepare('SELECT key_digest, failure_count, blocked_until FROM login_rate_limits').get()
  assert.equal(Buffer.from(rateLimit.key_digest).length, 32)
  assert.equal(rateLimit.failure_count, 5)
  assert.notEqual(rateLimit.blocked_until, null)

  now = new Date('2026-09-03T12:16:00.000Z')
  const login = await restartedService.authenticate({ email: 'founder@example.test', password: 'founder password' })
  assert.equal(login.user.email, 'founder@example.test')
})
