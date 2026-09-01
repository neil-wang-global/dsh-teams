// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import assert from 'node:assert/strict'
import test from 'node:test'

import { ConfigurationError, loadConfig } from '../src/config.mjs'

function productionEnvironment(overrides = {}) {
  return {
    DSH_TEAMS_MODE: 'production',
    DSH_TEAMS_CANONICAL_URL: 'https://teams.example.test',
    DSH_HOME: '/var/lib/dsh',
    DSH_TEAMS_DSH_BIND: '127.0.0.1',
    DSH_TEAMS_DSH_PORT: '3080',
    DSH_TEAMS_COOKIE_SECURE: 'true',
    DSH_TEAMS_SMTP_ENABLED: 'true',
    DSH_TEAMS_SMTP_HOST: 'smtp.example.test',
    DSH_TEAMS_SMTP_PORT: '587',
    DSH_TEAMS_SMTP_USERNAME: 'dsh-teams',
    DSH_TEAMS_SMTP_PASSWORD_REF: 'env:DSH_TEAMS_SMTP_PASSWORD',
    DSH_TEAMS_SMTP_FROM: 'DSH Teams <noreply@example.test>',
    ...overrides,
  }
}

function developmentEnvironment(overrides = {}) {
  return {
    ...productionEnvironment(),
    DSH_TEAMS_MODE: 'development',
    DSH_TEAMS_CANONICAL_URL: 'http://localhost:3081',
    DSH_TEAMS_SMTP_ENABLED: 'false',
    DSH_TEAMS_SMTP_HOST: undefined,
    DSH_TEAMS_SMTP_PORT: undefined,
    DSH_TEAMS_SMTP_USERNAME: undefined,
    DSH_TEAMS_SMTP_PASSWORD_REF: undefined,
    DSH_TEAMS_SMTP_FROM: undefined,
    ...overrides,
  }
}

function assertConfigurationError(action, code) {
  assert.throws(action, (error) => error instanceof ConfigurationError && error.code === code)
}

test('loads an immutable production configuration with safe secret references', () => {
  const config = loadConfig(productionEnvironment())

  assert.equal(config.mode, 'production')
  assert.equal(config.canonicalUrl.href, 'https://teams.example.test/')
  assert.deepEqual(config.dsh, { bindAddress: '127.0.0.1', port: 3080 })
  assert.equal(config.database.path, '/var/lib/dsh/teams/teams.sqlite3')
  assert.deepEqual(config.cookie, {
    name: '__Host-dsh-teams',
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  })
  assert.deepEqual(config.smtp, {
    enabled: true,
    host: 'smtp.example.test',
    port: 587,
    username: 'dsh-teams',
    passwordRef: 'env:DSH_TEAMS_SMTP_PASSWORD',
    from: 'DSH Teams <noreply@example.test>',
  })
  assert.deepEqual(config.features, { totp: false, passkey: false })
  assert.equal(Object.isFrozen(config), true)
})

test('uses a non-prefixed Cookie name for explicitly insecure development Cookies', () => {
  const config = loadConfig(developmentEnvironment({
    DSH_TEAMS_COOKIE_SECURE: 'false',
    DSH_TEAMS_ALLOW_INSECURE_COOKIE: 'true',
  }))

  assert.equal(config.cookie.secure, false)
  assert.equal(config.cookie.name, 'dsh-teams')
  assert.equal(config.canonicalUrl.href, 'http://localhost:3081/')
})

test('rejects a production canonical URL that is not HTTPS', () => {
  assertConfigurationError(
    () => loadConfig(productionEnvironment({ DSH_TEAMS_CANONICAL_URL: 'http://teams.example.test' })),
    'canonical-url-insecure',
  )
})

test('rejects canonical URLs with empty query or fragment markers', () => {
  for (const canonicalUrl of ['https://teams.example.test?', 'https://teams.example.test#']) {
    assertConfigurationError(
      () => loadConfig(productionEnvironment({ DSH_TEAMS_CANONICAL_URL: canonicalUrl })),
      'invalid-canonical-url',
    )
  }
})

test('rejects a non-loopback raw DSH bind address', () => {
  assertConfigurationError(
    () => loadConfig(developmentEnvironment({ DSH_TEAMS_DSH_BIND: '0.0.0.0' })),
    'dsh-bind-not-loopback',
  )
})

test('rejects a missing SMTP secret reference without exposing a supplied secret', () => {
  const secret = 'must-not-appear-in-diagnostics'

  assert.throws(
    () => loadConfig(productionEnvironment({
      DSH_TEAMS_SMTP_PASSWORD: secret,
      DSH_TEAMS_SMTP_PASSWORD_REF: undefined,
    })),
    (error) => error instanceof ConfigurationError
      && error.code === 'smtp-password-ref-required'
      && !error.message.includes(secret),
  )
})

test('rejects an insecure production Cookie configuration', () => {
  assertConfigurationError(
    () => loadConfig(productionEnvironment({ DSH_TEAMS_COOKIE_SECURE: 'false' })),
    'secure-cookie-required',
  )
})

test('rejects insecure development Cookies without an explicit opt-in', () => {
  assertConfigurationError(
    () => loadConfig(developmentEnvironment({ DSH_TEAMS_COOKIE_SECURE: 'false' })),
    'insecure-cookie-not-explicit',
  )
})

test('rejects malformed deployment values instead of silently defaulting', () => {
  assertConfigurationError(
    () => loadConfig(developmentEnvironment({ DSH_TEAMS_FEATURE_TOTP: 'enabled' })),
    'invalid-boolean',
  )
  assertConfigurationError(
    () => loadConfig(developmentEnvironment({ DSH_TEAMS_DSH_PORT: '65536' })),
    'invalid-port',
  )
  assertConfigurationError(
    () => loadConfig(developmentEnvironment({ DSH_HOME: 'relative/dsh' })),
    'dsh-home-not-absolute',
  )
  assertConfigurationError(
    () => loadConfig(productionEnvironment({ DSH_TEAMS_SMTP_PASSWORD_REF: 'plaintext-password' })),
    'invalid-secret-reference',
  )
})
