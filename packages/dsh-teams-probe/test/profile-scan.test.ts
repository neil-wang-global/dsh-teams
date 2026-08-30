// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { scanProfile } from '../src/profile-scan.ts'
import {
  assertCompatibleSnapshot,
  normalizeSnapshot,
  type DshProfile,
} from '../src/snapshot.ts'
import { createSurfaceInventoryReport } from '../src/report.ts'

const profile: DshProfile = {
  schemaVersion: 1,
  dshWeb: { packageName: '@deepseek-ai/dsh-web-app', version: '0.1.0-rc.6' },
  bundles: [
    { packageName: '@deepseek-ai/dsh-auth-gate', version: '0.1.0-rc.6', usedByDshTeams: false },
    { packageName: '@deepseek-ai/dsh-web-app', version: '0.1.0-rc.6', usedByDshTeams: true },
  ],
  services: [
    { name: 'webServer', signature: 'register(route)|registerUpgrade(route)' },
    { name: 'typertGateway', signature: 'invoke(request)' },
  ],
  surfaces: [
    { kind: 'rpc', id: 'session.list', status: 'covered', classification: 'workspace-visible-read' },
    { kind: 'rpc', id: 'session.search', status: 'blocked', classification: 'blocked' },
    { kind: 'rpc', id: 'session.export', status: 'blocked', classification: 'blocked' },
    { kind: 'rpc', id: 'workspace.create', status: 'covered', classification: 'owner-write' },
    { kind: 'rpc', id: 'workspace.members.list', status: 'covered', classification: 'workspace-visible-read' },
    { kind: 'http', id: 'GET /attachments/:attachmentId', status: 'blocked', classification: 'blocked' },
    { kind: 'http', id: 'GET /sessions/:sessionId/export', status: 'blocked', classification: 'blocked' },
    { kind: 'http', id: 'POST /api', status: 'covered', classification: 'public-authenticated' },
    { kind: 'websocket', id: '/events', mode: 'baseline', status: 'requires-upstream-clarification', classification: 'blocked' },
    { kind: 'websocket', id: '/events', mode: 'incremental', status: 'requires-upstream-clarification', classification: 'blocked' },
  ],
  slots: [
    { id: 'app.sidebar.footer', status: 'covered' },
    { id: 'session.toolbar', status: 'requires-upstream-clarification' },
  ],
  resourceCreatingOperations: [
    { id: 'attachment.attach', resource: 'attachment', status: 'blocked' },
    { id: 'session.create', resource: 'session', status: 'covered' },
    { id: 'session.fork', resource: 'session', status: 'requires-upstream-clarification' },
    { id: 'workspace.create', resource: 'workspace', status: 'covered' },
  ],
}

async function writeProfile(input: DshProfile): Promise<string> {
  const profileDir = await mkdtemp(join(tmpdir(), 'dsh-profile-'))
  await writeFile(join(profileDir, 'dsh-web-profile.json'), JSON.stringify(input), 'utf8')
  return profileDir
}

test('normalizes a DSH profile into stable canonical JSON', () => {
  const first = normalizeSnapshot(profile)
  const second = normalizeSnapshot({
    ...profile,
    bundles: [...profile.bundles].reverse(),
    services: [...profile.services].reverse(),
    surfaces: [...profile.surfaces].reverse(),
  })

  assert.deepEqual(first, second)
  assert.equal(JSON.stringify(first), JSON.stringify(second))
  assert.deepEqual(first.introspection, [{
    id: 'dsh.route-stream-introspection',
    status: 'blocked',
    upstreamContractCandidate: 'DSH-ROUTE-STREAM-INTROSPECTION',
  }])
})

test('scans only the profile named by DSH_PROFILE_DIR', async () => {
  const profileDir = await writeProfile(profile)
  const snapshot = await scanProfile({ DSH_PROFILE_DIR: profileDir })

  assert.equal(snapshot.dshWeb.version, '0.1.0-rc.6')
  assert.equal(snapshot.bundles[0].packageName, '@deepseek-ai/dsh-auth-gate')
  assert.equal(snapshot.bundles[0].usedByDshTeams, false)
  await assert.rejects(
    () => scanProfile({}),
    /DSH_PROFILE_DIR must name the DSH profile directory/,
  )
})

test('matches the committed current snapshot', async () => {
  const committed = JSON.parse(await readFile(
    new URL('../../../tests/fixtures/dsh-profile/current.json', import.meta.url),
    'utf8',
  ))
  const snapshot = normalizeSnapshot(profile)

  assert.deepEqual(committed, snapshot)
})

test('fails compatibility when discovery finds a new endpoint', () => {
  const discovered = normalizeSnapshot({
    ...profile,
    surfaces: [
      ...profile.surfaces,
      { kind: 'http', id: 'DELETE /session/:id', status: 'blocked', classification: 'blocked' },
    ],
  })

  assert.throws(
    () => assertCompatibleSnapshot(normalizeSnapshot(profile), discovered),
    /new discovered surface: http DELETE \/session\/:id/,
  )
})

test('fails compatibility when the DSH Web version or an inventoried surface changes', () => {
  const baseline = normalizeSnapshot(profile)

  assert.throws(
    () => assertCompatibleSnapshot(baseline, normalizeSnapshot({
      ...profile,
      dshWeb: { ...profile.dshWeb, version: '0.1.0-rc.7' },
    })),
    /changed DSH Web version: 0\.1\.0-rc\.6 -> 0\.1\.0-rc\.7/,
  )
  assert.throws(
    () => assertCompatibleSnapshot(baseline, normalizeSnapshot({
      ...profile,
      surfaces: profile.surfaces.filter((surface) => surface.id !== 'session.list'),
    })),
    /missing discovered surface: rpc session\.list/,
  )
})

test('reports every inventoried item under a fail-closed status', () => {
  const report = createSurfaceInventoryReport(normalizeSnapshot(profile))

  assert.deepEqual(report, {
    covered: [
      'http POST /api',
      'operation session.create',
      'operation workspace.create',
      'rpc session.list',
      'rpc workspace.create',
      'rpc workspace.members.list',
      'slot app.sidebar.footer',
    ],
    blocked: [
      'http GET /attachments/:attachmentId',
      'http GET /sessions/:sessionId/export',
      'introspection dsh.route-stream-introspection',
      'operation attachment.attach',
      'rpc session.export',
      'rpc session.search',
    ],
    requiresUpstreamClarification: [
      'operation session.fork',
      'slot session.toolbar',
      'websocket /events baseline',
      'websocket /events incremental',
    ],
    upstreamContractCandidates: ['DSH-ROUTE-STREAM-INTROSPECTION'],
  })
})
