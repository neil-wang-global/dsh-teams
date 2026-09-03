// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)
const SCRYPT_PARAMETERS = Object.freeze({ cost: 16_384, blockSize: 8, parallelization: 1, maxmem: 32 * 1024 * 1024 })
const DERIVED_KEY_BYTES = 64
const SALT_BYTES = 16

function requireOpaqueValue(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('opaque value must be a non-empty string')
  }
}

function parsePasswordHash(passwordHash) {
  if (typeof passwordHash !== 'string') return undefined
  const parts = passwordHash.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return undefined

  const [cost, blockSize, parallelization] = parts.slice(1, 4).map(Number)
  if (
    cost !== SCRYPT_PARAMETERS.cost
    || blockSize !== SCRYPT_PARAMETERS.blockSize
    || parallelization !== SCRYPT_PARAMETERS.parallelization
  ) return undefined

  const salt = Buffer.from(parts[4], 'base64url')
  const derivedKey = Buffer.from(parts[5], 'base64url')
  if (salt.length !== SALT_BYTES || derivedKey.length !== DERIVED_KEY_BYTES) return undefined
  return Object.freeze({ salt, derivedKey })
}

export function hashOpaqueValue(value) {
  requireOpaqueValue(value)
  return createHash('sha256').update(value).digest()
}

export async function hashPassword(password) {
  requireOpaqueValue(password)
  const salt = randomBytes(SALT_BYTES)
  const derivedKey = await scrypt(password, salt, DERIVED_KEY_BYTES, SCRYPT_PARAMETERS)
  return `scrypt$${SCRYPT_PARAMETERS.cost}$${SCRYPT_PARAMETERS.blockSize}$${SCRYPT_PARAMETERS.parallelization}$${salt.toString('base64url')}$${derivedKey.toString('base64url')}`
}

export async function verifyPassword(password, passwordHash) {
  if (typeof password !== 'string') return false
  const parsed = parsePasswordHash(passwordHash)
  if (parsed === undefined) return false

  const candidate = await scrypt(password, parsed.salt, DERIVED_KEY_BYTES, SCRYPT_PARAMETERS)
  return timingSafeEqual(candidate, parsed.derivedKey)
}
