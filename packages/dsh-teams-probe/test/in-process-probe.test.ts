// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  assessInProcessCoverage,
  runInProcessCoverageProbe,
  type ProbeTranscript,
} from '../src/in-process-probe.ts'
import { DisposableProbeServer, FiberProbeAdapter } from '../src/probe-server.ts'
import { normalizeSnapshot, type DshProfile } from '../src/snapshot.ts'

function createProfile(surfaces: DshProfile['surfaces']): DshProfile {
  return {
    schemaVersion: 1,
    dshWeb: { packageName: '@deepseek-ai/dsh-web-app', version: '0.1.1-rc.2' },
    bundles: [],
    services: [],
    surfaces,
    slots: [],
    resourceCreatingOperations: [],
  }
}

async function readCurrentProfile(): Promise<DshProfile> {
  const source = new URL('../../../tests/fixtures/dsh-profile/current.json', import.meta.url)
  return JSON.parse(await readFile(source, 'utf8')) as DshProfile
}

test('coverage assessor requires a transcript for every interceptable inventory surface', () => {
  const snapshot = normalizeSnapshot(createProfile([
    { kind: 'http', id: 'GET /sidebar/file', status: 'blocked', classification: 'blocked' },
    { kind: 'http', id: 'GET /sidebar/html', status: 'blocked', classification: 'blocked' },
    { kind: 'rpc', id: 'session.list', status: 'requires-upstream-clarification', classification: 'blocked' },
  ]))
  const transcripts: ProbeTranscript[] = [{
    kind: 'http',
    id: 'GET /sidebar/file',
    observation: 'intercepted-denied',
  }]

  const report = assessInProcessCoverage(snapshot, transcripts)

  assert.equal(report.decision, 'sidecar-required')
  assert.deepEqual(report.interceptedDenied, ['http GET /sidebar/file'])
  assert.deepEqual(report.missing, ['http GET /sidebar/html'])
  assert.deepEqual(report.unresolved, ['rpc session.list'])
  assert.deepEqual(report.failures, [
    'missing transcript: http GET /sidebar/html',
    'unresolved carrier: rpc session.list',
  ])
})

test('coverage assessor rejects bypassed and duplicate route transcripts', () => {
  const snapshot = normalizeSnapshot(createProfile([
    { kind: 'http', id: 'GET /sidebar/file', status: 'blocked', classification: 'blocked' },
  ]))
  const transcripts: ProbeTranscript[] = [{
    kind: 'http',
    id: 'GET /sidebar/file',
    observation: 'intercepted-denied',
  }, {
    kind: 'http',
    id: 'GET /sidebar/file',
    observation: 'bypassed',
  }]

  const report = assessInProcessCoverage(snapshot, transcripts)

  assert.equal(report.decision, 'sidecar-required')
  assert.deepEqual(report.bypassed, ['http GET /sidebar/file'])
  assert.deepEqual(report.duplicates, ['http GET /sidebar/file'])
  assert.deepEqual(report.failures, [
    'bypassed route: http GET /sidebar/file',
    'duplicate transcript: http GET /sidebar/file',
  ])
})

test('coverage assessor keeps a proven carrier pending registration inventory', () => {
  const snapshot = normalizeSnapshot(createProfile([
    { kind: 'http', id: 'POST /api/:method', status: 'blocked', classification: 'blocked' },
  ]))

  const report = assessInProcessCoverage(snapshot, [{
    kind: 'http',
    id: 'POST /api/:method',
    observation: 'intercepted-denied',
  }], { runtimeRegistrationInventory: 'incomplete' })

  assert.equal(report.decision, 'runtime-inventory-required')
  assert.deepEqual(report.failures, [])
})

test('Fiber adapter denies a registered HTTP route before a response is released', async () => {
  const adapter = new FiberProbeAdapter()
  const server = await DisposableProbeServer.start({ adapter })

  try {
    const response = await server.request('GET', '/sidebar/file')

    assert.equal(response.status, 403)
    assert.deepEqual(adapter.transcripts(), [{
      kind: 'http',
      id: 'GET /sidebar/file',
      observation: 'intercepted-denied',
    }])
  } finally {
    await server.close()
  }
})

test('raw route bypass is observable as an architecture failure', async () => {
  const adapter = new FiberProbeAdapter()
  const server = await DisposableProbeServer.start({
    adapter,
    rawRoutes: [{ kind: 'http', id: 'GET /sidebar/file' }],
  })

  try {
    const response = await server.request('GET', '/sidebar/file')

    assert.equal(response.status, 200)
    assert.deepEqual(adapter.transcripts(), [{
      kind: 'http',
      id: 'GET /sidebar/file',
      observation: 'bypassed',
    }])
  } finally {
    await server.close()
  }
})

test('unregistered raw route is observable as an architecture failure', async () => {
  const adapter = new FiberProbeAdapter()
  const server = await DisposableProbeServer.start({ adapter })

  try {
    const response = await server.request('GET', '/unmapped')

    assert.equal(response.status, 200)
    assert.deepEqual(adapter.transcripts(), [{
      kind: 'http',
      id: 'GET /unmapped',
      observation: 'bypassed',
    }])
  } finally {
    await server.close()
  }
})

test('Fiber adapter denies a registered WebSocket upgrade', async () => {
  const adapter = new FiberProbeAdapter()
  const server = await DisposableProbeServer.start({ adapter })

  try {
    const response = await server.upgrade('/sidebar/ws/terminal')

    assert.equal(response.status, 403)
    assert.deepEqual(adapter.transcripts(), [{
      kind: 'websocket',
      id: '/sidebar/ws/terminal',
      observation: 'intercepted-denied',
    }])
  } finally {
    await server.close()
  }
})

test('incremental frame is withheld after the adapter is revoked', async () => {
  const adapter = new FiberProbeAdapter()
  adapter.allow()
  const server = await DisposableProbeServer.start({ adapter })

  try {
    const response = await server.upgrade('/sidebar/ws/terminal')
    assert.equal(response.status, 101)

    adapter.deny()
    server.emitIncrementalFrame('/sidebar/ws/terminal', 'frame after revocation')
    await new Promise<void>((resolve) => setImmediate(resolve))

    assert.deepEqual(response.frames, [])
    assert.deepEqual(adapter.transcripts(), [{
      kind: 'websocket',
      id: '/sidebar/ws/terminal',
      mode: 'incremental',
      observation: 'intercepted-denied',
    }])
  } finally {
    await server.close()
  }
})

test('disposable profile keeps runtime registration inventory pending after known carriers', async () => {
  const snapshot = normalizeSnapshot(await readCurrentProfile())
  const adapter = new FiberProbeAdapter()
  const server = await DisposableProbeServer.start({ adapter })

  try {
    const report = await runInProcessCoverageProbe(snapshot, {
      request: server.request.bind(server),
      upgrade: server.upgrade.bind(server),
      transcripts: adapter.transcripts.bind(adapter),
    })

    assert.equal(report.decision, 'runtime-inventory-required')
    assert.deepEqual(report.interceptedDenied, [
      'http GET /api/session.export',
      'http GET /sidebar/bundle',
      'http GET /sidebar/file',
      'http GET /sidebar/html',
      'http HEAD /api/session.export',
      'http POST /api/:method',
      'http POST /sidebar/api/:method',
      'websocket /api/events.host',
      'websocket /api/events.mux',
      'websocket /sidebar/ws/agent-terminals',
      'websocket /sidebar/ws/terminal',
    ])
    assert.deepEqual(report.missing, [])
    assert.deepEqual(report.unresolved, [])
  } finally {
    await server.close()
  }
})

test('disposable runner rejects a response released without adapter denial', async () => {
  const snapshot = normalizeSnapshot(createProfile([
    { kind: 'http', id: 'GET /sidebar/file', status: 'blocked', classification: 'blocked' },
  ]))

  await assert.rejects(
    () => runInProcessCoverageProbe(snapshot, {
      request: async () => ({ status: 200 }),
      upgrade: async () => ({ status: 403 }),
      transcripts: () => [{
        kind: 'http',
        id: 'GET /sidebar/file',
        observation: 'intercepted-denied',
      }],
    }),
    /expected denial for http GET \/sidebar\/file: 200/,
  )
})
