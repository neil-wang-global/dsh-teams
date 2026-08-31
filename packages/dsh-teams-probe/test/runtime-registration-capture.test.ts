// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertCoreRuntimeRegistrations,
  createRuntimeObserverPatch,
  createRuntimeObserverPluginSource,
  normalizeRuntimeRegistrationInventory,
} from '../src/runtime-registration-capture.ts'

test('normalizes and deduplicates only supported runtime registration records', () => {
  const inventory = normalizeRuntimeRegistrationInventory([
    { carrier: 'webServer.register', kind: 'http', id: 'prefix /api' },
    { carrier: 'connection.rpc.intercept', kind: 'rpc', id: '/api' },
    { carrier: 'webServer.registerUpgrade', kind: 'websocket', id: '/api/events.mux' },
    { carrier: 'webServer.registerUpgrade', kind: 'websocket', id: '/api/events.mux' },
  ])

  assert.deepEqual(inventory, {
    version: 1,
    registrations: [
      { carrier: 'connection.rpc.intercept', kind: 'rpc', id: '/api' },
      { carrier: 'webServer.register', kind: 'http', id: 'prefix /api' },
      { carrier: 'webServer.registerUpgrade', kind: 'websocket', id: '/api/events.mux' },
    ],
  })
})

test('rejects malformed runtime registration records instead of silently losing a carrier', () => {
  assert.throws(
    () => normalizeRuntimeRegistrationInventory([
      { carrier: 'webServer.register', kind: 'websocket', id: '/api/events.mux' },
    ]),
    /invalid runtime registration record/,
  )
})

test('requires every core carrier to appear in the composed runtime inventory', () => {
  assert.throws(
    () => assertCoreRuntimeRegistrations(normalizeRuntimeRegistrationInventory([
      { carrier: 'webServer.register', kind: 'http', id: 'prefix /api' },
      { carrier: 'webServer.registerUpgrade', kind: 'websocket', id: '/api/events.mux' },
    ])),
    /missing core runtime registration: webServer\.registerUpgrade \/api\/events\.host/,
  )
})

test('generated observer patch gates every discovered registration carrier before load', () => {
  const patch = createRuntimeObserverPatch('/tmp/observer.mjs', '/tmp/capture.ndjson')

  assert.match(patch, /dsh-teams-registration-observer/)
  assert.match(patch, /file:\/\/\/tmp\/observer\.mjs/)
  assert.match(patch, /id: connection\n  inject: \[webRuntime, dshTeamsRegistrationObserver\]/)
  assert.match(patch, /id: typert-gateway\n  inject: \[dshTeamsRegistrationObserver\]/)
  assert.match(patch, /id: web-ui-better-sidebar\n  inject: \[dshTeamsRegistrationObserver\]/)
})

test('generated observer source captures web registrations and both generic RPC registration methods', () => {
  const source = createRuntimeObserverPluginSource('/tmp/capture.ndjson')

  assert.match(source, /webServer\.register/)
  assert.match(source, /webServer\.registerUpgrade/)
  assert.match(source, /connection\.rpc\.handle/)
  assert.match(source, /connection\.rpc\.intercept/)
  assert.doesNotMatch(source, /request\.headers|request\.body|response\.body/)
})
