// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import path from 'node:path'

import { ConfigurationError } from './errors.mjs'

export { ConfigurationError } from './errors.mjs'

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1'])
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const SECRET_REFERENCE = /^env:[A-Z][A-Z0-9_]*$/

function fail(code, message) {
  throw new ConfigurationError(code, message)
}

function readRequiredString(environment, name, code = 'required-setting') {
  const value = environment[name]
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(code, `${name} must be configured`)
  }
  return value.trim()
}

function readOptionalString(environment, name) {
  const value = environment[name]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail('invalid-setting', `${name} must be a non-empty string when configured`)
  }
  return value.trim()
}

function readBoolean(environment, name, defaultValue) {
  const value = environment[name]
  if (value === undefined) return defaultValue
  if (value === 'true') return true
  if (value === 'false') return false
  fail('invalid-boolean', `${name} must be true or false`)
}

function readPort(environment, name) {
  const value = readRequiredString(environment, name)
  if (!/^[0-9]+$/.test(value)) {
    fail('invalid-port', `${name} must be an integer between 1 and 65535`)
  }
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    fail('invalid-port', `${name} must be an integer between 1 and 65535`)
  }
  return port
}

function readMode(environment) {
  const mode = readRequiredString(environment, 'DSH_TEAMS_MODE')
  if (mode !== 'development' && mode !== 'production') {
    fail('invalid-mode', 'DSH_TEAMS_MODE must be development or production')
  }
  return mode
}

function readCanonicalUrl(environment, mode) {
  const value = readRequiredString(environment, 'DSH_TEAMS_CANONICAL_URL')
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    fail('invalid-canonical-url', 'DSH_TEAMS_CANONICAL_URL must be an absolute URL')
  }

  if (
    parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || parsed.href !== `${parsed.origin}/`
  ) {
    fail('invalid-canonical-url', 'DSH_TEAMS_CANONICAL_URL must be an origin URL without credentials')
  }
  if (mode === 'production' && parsed.protocol !== 'https:') {
    fail('canonical-url-insecure', 'production requires an HTTPS DSH_TEAMS_CANONICAL_URL')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    fail('invalid-canonical-url', 'DSH_TEAMS_CANONICAL_URL must use HTTP or HTTPS')
  }
  if (parsed.protocol === 'http:' && !LOOPBACK_HOSTS.has(parsed.hostname)) {
    fail('canonical-url-insecure', 'an HTTP DSH_TEAMS_CANONICAL_URL must use a loopback host')
  }

  return Object.freeze({ href: parsed.href, origin: parsed.origin })
}

function readDsh(environment) {
  const bindAddress = readRequiredString(environment, 'DSH_TEAMS_DSH_BIND')
  if (!LOOPBACK_ADDRESSES.has(bindAddress)) {
    fail('dsh-bind-not-loopback', 'DSH_TEAMS_DSH_BIND must be 127.0.0.1 or ::1')
  }
  return Object.freeze({ bindAddress, port: readPort(environment, 'DSH_TEAMS_DSH_PORT') })
}

function readDatabase(environment) {
  const dshHome = readRequiredString(environment, 'DSH_HOME')
  if (!path.isAbsolute(dshHome)) {
    fail('dsh-home-not-absolute', 'DSH_HOME must be an absolute path')
  }
  return Object.freeze({ path: path.join(dshHome, 'teams', 'teams.sqlite3') })
}

function readCookie(environment, mode) {
  const secure = readBoolean(environment, 'DSH_TEAMS_COOKIE_SECURE', true)
  if (mode === 'production' && !secure) {
    fail('secure-cookie-required', 'production requires DSH_TEAMS_COOKIE_SECURE=true')
  }
  if (!secure && !readBoolean(environment, 'DSH_TEAMS_ALLOW_INSECURE_COOKIE', false)) {
    fail('insecure-cookie-not-explicit', 'insecure Cookies require DSH_TEAMS_ALLOW_INSECURE_COOKIE=true')
  }
  return Object.freeze({
    name: secure ? '__Host-dsh-teams' : 'dsh-teams',
    secure,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  })
}

function readSmtp(environment) {
  const enabled = readBoolean(environment, 'DSH_TEAMS_SMTP_ENABLED', false)
  if (!enabled) return Object.freeze({ enabled: false })

  const passwordRef = readRequiredString(
    environment,
    'DSH_TEAMS_SMTP_PASSWORD_REF',
    'smtp-password-ref-required',
  )
  if (!SECRET_REFERENCE.test(passwordRef)) {
    fail('invalid-secret-reference', 'DSH_TEAMS_SMTP_PASSWORD_REF must use env:VARIABLE_NAME')
  }

  return Object.freeze({
    enabled: true,
    host: readRequiredString(environment, 'DSH_TEAMS_SMTP_HOST'),
    port: readPort(environment, 'DSH_TEAMS_SMTP_PORT'),
    username: readRequiredString(environment, 'DSH_TEAMS_SMTP_USERNAME'),
    passwordRef,
    from: readRequiredString(environment, 'DSH_TEAMS_SMTP_FROM'),
  })
}

function readFeatures(environment) {
  return Object.freeze({
    totp: readBoolean(environment, 'DSH_TEAMS_FEATURE_TOTP', false),
    passkey: readBoolean(environment, 'DSH_TEAMS_FEATURE_PASSKEY', false),
  })
}

export function loadConfig(environment) {
  if (environment === null || typeof environment !== 'object') {
    fail('invalid-environment', 'configuration must be loaded from an environment object')
  }

  const mode = readMode(environment)
  return Object.freeze({
    mode,
    canonicalUrl: readCanonicalUrl(environment, mode),
    dsh: readDsh(environment),
    database: readDatabase(environment),
    cookie: readCookie(environment, mode),
    smtp: readSmtp(environment),
    features: readFeatures(environment),
  })
}
