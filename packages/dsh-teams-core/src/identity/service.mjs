// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { randomUUID } from 'node:crypto'

import { IdentityError } from '../errors.mjs'
import { hashOpaqueValue, hashPassword, verifyPassword } from './passwords.mjs'
import { createOpaqueToken, createSessionRecord } from './sessions.mjs'

export { IdentityError } from '../errors.mjs'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const LOGIN_FAILURE_LIMIT = 5
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const LOGIN_BLOCK_MS = 15 * 60 * 1000
const RESET_TOKEN_LIFETIME_MS = 60 * 60 * 1000
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000
const DUMMY_PASSWORD_HASH = await hashPassword('dsh-teams-invalid-login-dummy')

function fail(code, message, status = 400) {
  throw new IdentityError(code, message, status)
}

function normalizeEmail(email) {
  if (typeof email !== 'string') fail('email-invalid', 'email must be valid')
  const display = email.trim()
  if (!EMAIL_PATTERN.test(display)) fail('email-invalid', 'email must be valid')
  return Object.freeze({ display, normalized: display.toLowerCase() })
}

function timestamp(clock) {
  const value = clock()
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    throw new TypeError('identity clock must return a valid Date')
  }
  return value.toISOString()
}

function toUser(row) {
  return Object.freeze({
    id: row.id,
    email: row.email_display,
    systemRole: row.system_role,
    status: row.status,
    isFounder: row.is_founder === 1,
    mustChangePassword: row.must_change_password === 1,
    authVersion: row.auth_version,
  })
}

function transaction(connection, action) {
  connection.exec('BEGIN IMMEDIATE')
  try {
    const result = action()
    connection.exec('COMMIT')
    return result
  } catch (error) {
    connection.exec('ROLLBACK')
    throw error
  }
}

function readUser(connection, userId) {
  const user = connection.prepare('SELECT * FROM users WHERE id = ?').get(userId)
  if (user === undefined) fail('user-not-found', 'user does not exist', 404)
  return user
}

function requireActiveAdmin(connection, userId) {
  const user = readUser(connection, userId)
  if (user.status !== 'active' || user.system_role !== 'admin') {
    fail('identity-forbidden', 'administrator access is required', 403)
  }
  return user
}

function invalidateSessions(connection, userId, now) {
  connection.prepare(`
    UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?), updated_at = ?
    WHERE user_id = ?
  `).run(now, now, userId)
}

function changeAuthorizationVersion(connection, userId, now) {
  connection.prepare('UPDATE users SET auth_version = auth_version + 1, updated_at = ? WHERE id = ?').run(now, userId)
  invalidateSessions(connection, userId, now)
}

function toSessionResult(record) {
  return Object.freeze({
    id: record.id,
    token: record.token,
    expiresAt: record.expiresAt,
    restricted: record.restricted,
  })
}

function sessionRow(connection, tokenDigest) {
  return connection.prepare(`
    SELECT
      auth_sessions.id AS session_id, auth_sessions.user_id AS session_user_id,
      auth_sessions.auth_version AS session_auth_version, auth_sessions.restricted,
      auth_sessions.expires_at, auth_sessions.revoked_at,
      users.id, users.email_normalized, users.email_display, users.system_role,
      users.status, users.is_founder, users.must_change_password, users.auth_version
    FROM auth_sessions
    JOIN users ON users.id = auth_sessions.user_id
    WHERE auth_sessions.token_digest = ?
  `).get(tokenDigest)
}

function assertSessionRow(row, now, requireUnrestricted) {
  if (
    row === undefined
    || row.revoked_at !== null
    || row.status !== 'active'
    || row.session_auth_version !== row.auth_version
    || Date.parse(row.expires_at) <= now.valueOf()
  ) {
    fail('session-invalid', 'session is invalid', 401)
  }
  if (requireUnrestricted && row.restricted === 1) {
    fail('session-restricted', 'session must complete a password change', 403)
  }
  return Object.freeze({
    id: row.session_id,
    user: toUser(row),
    restricted: row.restricted === 1,
    expiresAt: row.expires_at,
  })
}

export class IdentityService {
  constructor(opened, { now = () => new Date() } = {}) {
    if (!opened?.connection) throw new TypeError('opened database is required')
    this.connection = opened.connection
    this.now = now
  }

  async bootstrapFounder({ email, password } = {}) {
    const normalizedEmail = normalizeEmail(email)
    const passwordHash = await hashPassword(password)
    const now = timestamp(this.now)

    return transaction(this.connection, () => {
      if (this.connection.prepare('SELECT 1 FROM users LIMIT 1').get() !== undefined) {
        fail('founder-already-exists', 'founder bootstrap has already completed', 409)
      }

      const id = randomUUID()
      this.connection.prepare(`
        INSERT INTO users (
          id, email_normalized, email_display, system_role, status, is_founder,
          must_change_password, auth_version, created_at, updated_at
        ) VALUES (?, ?, ?, 'admin', 'active', 1, 0, 0, ?, ?)
      `).run(id, normalizedEmail.normalized, normalizedEmail.display, now, now)
      this.connection.prepare(`
        INSERT INTO password_credentials (user_id, password_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(id, passwordHash, now, now)
      this.connection.prepare('INSERT INTO principal_epochs (user_id, epoch, updated_at) VALUES (?, 0, ?)').run(id, now)
      return toUser(this.connection.prepare('SELECT * FROM users WHERE id = ?').get(id))
    })
  }

  async createTemporaryUser({ actorUserId, email, password } = {}) {
    const normalizedEmail = normalizeEmail(email)
    const passwordHash = await hashPassword(password)
    const now = timestamp(this.now)

    return transaction(this.connection, () => {
      requireActiveAdmin(this.connection, actorUserId)
      if (this.connection.prepare('SELECT 1 FROM users WHERE email_normalized = ?').get(normalizedEmail.normalized) !== undefined) {
        fail('email-already-exists', 'email is already in use', 409)
      }
      const id = randomUUID()
      this.connection.prepare(`
        INSERT INTO users (
          id, email_normalized, email_display, system_role, status, is_founder,
          must_change_password, auth_version, created_at, updated_at
        ) VALUES (?, ?, ?, 'user', 'active', 0, 1, 0, ?, ?)
      `).run(id, normalizedEmail.normalized, normalizedEmail.display, now, now)
      this.connection.prepare(`
        INSERT INTO password_credentials (user_id, password_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(id, passwordHash, now, now)
      this.connection.prepare('INSERT INTO principal_epochs (user_id, epoch, updated_at) VALUES (?, 0, ?)').run(id, now)
      return toUser(readUser(this.connection, id))
    })
  }

  async authenticate({ email, password } = {}) {
    const normalizedEmail = normalizeEmail(email)
    const nowDate = this.now()
    const now = timestamp(() => nowDate)
    const rateLimitKey = hashOpaqueValue(normalizedEmail.normalized)
    const candidate = this.connection.prepare(`
      SELECT users.*, password_credentials.password_hash
      FROM users LEFT JOIN password_credentials ON password_credentials.user_id = users.id
      WHERE users.email_normalized = ?
    `).get(normalizedEmail.normalized)
    const passwordValid = await verifyPassword(password, candidate?.password_hash ?? DUMMY_PASSWORD_HASH)
    const currentLimit = this.connection.prepare('SELECT * FROM login_rate_limits WHERE key_digest = ?').get(rateLimitKey)
    const isBlocked = currentLimit?.blocked_until !== null && currentLimit !== undefined && Date.parse(currentLimit.blocked_until) > nowDate.valueOf()

    if (candidate === undefined || candidate.status !== 'active' || !passwordValid || isBlocked) {
      if (!isBlocked) this.#recordFailedLogin(rateLimitKey, nowDate, now)
      fail('authentication-invalid', 'authentication failed', 401)
    }

    return transaction(this.connection, () => {
      const user = readUser(this.connection, candidate.id)
      if (user.status !== 'active') fail('authentication-invalid', 'authentication failed', 401)
      this.connection.prepare('DELETE FROM login_rate_limits WHERE key_digest = ?').run(rateLimitKey)
      const record = createSessionRecord({
        userId: user.id,
        authVersion: user.auth_version,
        restricted: user.must_change_password === 1,
        expiresAt: new Date(nowDate.valueOf() + SESSION_LIFETIME_MS).toISOString(),
      })
      this.connection.prepare(`
        INSERT INTO auth_sessions (
          id, user_id, token_digest, expires_at, auth_version, restricted, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.id,
        record.userId,
        record.tokenDigest,
        record.expiresAt,
        record.authVersion,
        record.restricted ? 1 : 0,
        now,
        now,
      )
      return Object.freeze({ user: toUser(user), session: toSessionResult(record) })
    })
  }

  async assertSession(token, { requireUnrestricted = false } = {}) {
    const nowDate = this.now()
    if (typeof token !== 'string' || token.length === 0) fail('session-invalid', 'session is invalid', 401)
    return assertSessionRow(sessionRow(this.connection, hashOpaqueValue(token)), nowDate, requireUnrestricted)
  }

  async rotateSession(token) {
    const nowDate = this.now()
    const now = timestamp(() => nowDate)
    if (typeof token !== 'string' || token.length === 0) fail('session-invalid', 'session is invalid', 401)
    const tokenDigest = hashOpaqueValue(token)
    return transaction(this.connection, () => {
      const current = assertSessionRow(sessionRow(this.connection, tokenDigest), nowDate, false)
      const record = createSessionRecord({
        userId: current.user.id,
        authVersion: current.user.authVersion,
        restricted: current.restricted,
        expiresAt: new Date(nowDate.valueOf() + SESSION_LIFETIME_MS).toISOString(),
      })
      this.connection.prepare('UPDATE auth_sessions SET revoked_at = ?, updated_at = ? WHERE id = ?').run(now, now, current.id)
      this.connection.prepare(`
        INSERT INTO auth_sessions (
          id, user_id, token_digest, expires_at, auth_version, restricted, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(record.id, record.userId, record.tokenDigest, record.expiresAt, record.authVersion, record.restricted ? 1 : 0, now, now)
      return toSessionResult(record)
    })
  }

  async changePassword({ userId, currentPassword, newPassword } = {}) {
    const user = readUser(this.connection, userId)
    const credential = this.connection.prepare('SELECT password_hash FROM password_credentials WHERE user_id = ?').get(user.id)
    if (!await verifyPassword(currentPassword, credential?.password_hash ?? DUMMY_PASSWORD_HASH)) {
      fail('authentication-invalid', 'authentication failed', 401)
    }
    const passwordHash = await hashPassword(newPassword)
    const now = timestamp(this.now)
    return transaction(this.connection, () => {
      this.connection.prepare('UPDATE password_credentials SET password_hash = ?, updated_at = ? WHERE user_id = ?').run(passwordHash, now, user.id)
      this.connection.prepare('UPDATE users SET must_change_password = 0, updated_at = ? WHERE id = ?').run(now, user.id)
      changeAuthorizationVersion(this.connection, user.id, now)
      return toUser(readUser(this.connection, user.id))
    })
  }

  async beginPasswordReset({ email } = {}) {
    const normalizedEmail = normalizeEmail(email)
    const user = this.connection.prepare('SELECT * FROM users WHERE email_normalized = ? AND status = \'active\'').get(normalizedEmail.normalized)
    if (user === undefined) return undefined
    const nowDate = this.now()
    const now = timestamp(() => nowDate)
    const token = createOpaqueToken()
    const expiresAt = new Date(nowDate.valueOf() + RESET_TOKEN_LIFETIME_MS).toISOString()
    transaction(this.connection, () => {
      this.connection.prepare(`
        UPDATE one_time_tokens SET consumed_at = ?
        WHERE user_id = ? AND purpose = 'password-reset' AND consumed_at IS NULL
      `).run(now, user.id)
      this.connection.prepare(`
        INSERT INTO one_time_tokens (id, user_id, purpose, token_digest, expires_at, created_at)
        VALUES (?, ?, 'password-reset', ?, ?, ?)
      `).run(randomUUID(), user.id, hashOpaqueValue(token), expiresAt, now)
    })
    return Object.freeze({ token, expiresAt })
  }

  async resetPassword({ token, newPassword } = {}) {
    if (typeof token !== 'string' || token.length === 0) fail('reset-token-invalid', 'reset token is invalid', 401)
    const passwordHash = await hashPassword(newPassword)
    const nowDate = this.now()
    const now = timestamp(() => nowDate)
    return transaction(this.connection, () => {
      const reset = this.connection.prepare(`
        SELECT * FROM one_time_tokens
        WHERE purpose = 'password-reset' AND token_digest = ? AND consumed_at IS NULL
      `).get(hashOpaqueValue(token))
      if (reset === undefined || Date.parse(reset.expires_at) <= nowDate.valueOf()) {
        fail('reset-token-invalid', 'reset token is invalid', 401)
      }
      this.connection.prepare('UPDATE one_time_tokens SET consumed_at = ? WHERE id = ?').run(now, reset.id)
      this.connection.prepare('UPDATE password_credentials SET password_hash = ?, updated_at = ? WHERE user_id = ?').run(passwordHash, now, reset.user_id)
      this.connection.prepare('UPDATE users SET must_change_password = 0, updated_at = ? WHERE id = ?').run(now, reset.user_id)
      changeAuthorizationVersion(this.connection, reset.user_id, now)
      return toUser(readUser(this.connection, reset.user_id))
    })
  }

  setUserStatus({ actorUserId, userId, status } = {}) {
    if (status !== 'active' && status !== 'disabled') fail('user-status-invalid', 'user status is invalid')
    return transaction(this.connection, () => {
      const target = readUser(this.connection, userId)
      if (target.is_founder === 1 && status !== 'active') fail('founder-protected', 'founder status cannot be changed', 403)
      requireActiveAdmin(this.connection, actorUserId)
      if (target.status === status) return toUser(target)

      const now = timestamp(this.now)
      this.connection.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').run(status, now, userId)
      changeAuthorizationVersion(this.connection, userId, now)
      return toUser(readUser(this.connection, userId))
    })
  }

  setSystemRole({ actorUserId, userId, systemRole } = {}) {
    if (systemRole !== 'admin' && systemRole !== 'user') fail('system-role-invalid', 'system role is invalid')
    return transaction(this.connection, () => {
      const target = readUser(this.connection, userId)
      if (target.is_founder === 1 && systemRole !== 'admin') fail('founder-protected', 'founder role cannot be changed', 403)
      requireActiveAdmin(this.connection, actorUserId)
      if (target.system_role === systemRole) return toUser(target)
      const now = timestamp(this.now)
      this.connection.prepare('UPDATE users SET system_role = ?, updated_at = ? WHERE id = ?').run(systemRole, now, userId)
      changeAuthorizationVersion(this.connection, userId, now)
      return toUser(readUser(this.connection, userId))
    })
  }

  #recordFailedLogin(keyDigest, nowDate, now) {
    transaction(this.connection, () => {
      const existing = this.connection.prepare('SELECT * FROM login_rate_limits WHERE key_digest = ?').get(keyDigest)
      const windowExpired = existing === undefined || Date.parse(existing.window_started_at) <= nowDate.valueOf() - LOGIN_WINDOW_MS
      const failureCount = (windowExpired ? 0 : existing.failure_count) + 1
      const windowStartedAt = windowExpired ? now : existing.window_started_at
      const blockedUntil = failureCount >= LOGIN_FAILURE_LIMIT
        ? new Date(nowDate.valueOf() + LOGIN_BLOCK_MS).toISOString()
        : null
      this.connection.prepare(`
        INSERT INTO login_rate_limits (key_digest, failure_count, window_started_at, blocked_until, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(key_digest) DO UPDATE SET
          failure_count = excluded.failure_count,
          window_started_at = excluded.window_started_at,
          blocked_until = excluded.blocked_until,
          updated_at = excluded.updated_at
      `).run(keyDigest, failureCount, windowStartedAt, blockedUntil, now)
    })
  }
}
