// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import assert from 'node:assert/strict'
import test from 'node:test'

import { runRuntimeRegistrationDenialProbe } from '../src/runtime-registration-denial-probe.ts'
import { normalizeRuntimeRegistrationInventory } from '../src/runtime-registration-capture.ts'

test('denies every HTTP, WebSocket, and RPC registration in a captured inventory', async () => {
  const inventory = normalizeRuntimeRegistrationInventory([
    { carrier: 'webServer.register', kind: 'http', id: 'prefix /api' },
    { carrier: 'webServer.register', kind: 'http', id: 'exact /api/health' },
    { carrier: 'webServer.registerUpgrade', kind: 'websocket', id: '/api/events.mux' },
    { carrier: 'connection.rpc.intercept', kind: 'rpc', id: '/api' },
  ])

  const transcripts = await runRuntimeRegistrationDenialProbe(inventory)

  assert.deepEqual(transcripts, [
    { kind: 'http', id: 'exact /api/health', observation: 'intercepted-denied' },
    { kind: 'http', id: 'prefix /api', observation: 'intercepted-denied' },
    { kind: 'rpc', id: '/api', observation: 'intercepted-denied' },
    { kind: 'websocket', id: '/api/events.mux', observation: 'intercepted-denied' },
  ])
})
