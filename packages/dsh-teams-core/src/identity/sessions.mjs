// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { randomBytes, randomUUID } from 'node:crypto'

import { hashOpaqueValue } from './passwords.mjs'

const TOKEN_BYTES = 32

export function createOpaqueToken() {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

export function createSessionRecord({ userId, authVersion, restricted, expiresAt } = {}) {
  if (typeof userId !== 'string' || userId.length === 0) throw new TypeError('session user ID is required')
  if (!Number.isSafeInteger(authVersion) || authVersion < 0) throw new TypeError('session authorization version is invalid')
  if (typeof restricted !== 'boolean') throw new TypeError('session restriction state is invalid')
  if (typeof expiresAt !== 'string' || Number.isNaN(Date.parse(expiresAt))) throw new TypeError('session expiry is invalid')

  const token = createOpaqueToken()
  return Object.freeze({
    id: randomUUID(),
    userId,
    token,
    tokenDigest: hashOpaqueValue(token),
    authVersion,
    restricted,
    expiresAt,
  })
}
