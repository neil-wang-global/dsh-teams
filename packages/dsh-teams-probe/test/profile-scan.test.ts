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
  canonicalSnapshotJson,
  normalizeSnapshot,
  type DshProfile,
} from '../src/snapshot.ts'
import { createSurfaceInventoryReport } from '../src/report.ts'

const profile: DshProfile = {
  schemaVersion: 1,
  dshWeb: { packageName: '@deepseek-ai/dsh-web-app', version: '0.1.1-rc.2' },
  bundles: [
    { packageName: '@deepseek-ai/dsh-base', version: '0.1.1-rc.2', usedByDshTeams: false },
    { packageName: '@deepseek-ai/dsh-web-app', version: '0.1.1-rc.2', usedByDshTeams: true },
    { packageName: '@linxin666/dsh-web-ui-all', version: '0.2.8', usedByDshTeams: false },
    { packageName: 'dsh-auth-gate', version: '0.7.2', usedByDshTeams: false },
    { packageName: 'dsh-deeptutor', version: '0.1.9', usedByDshTeams: false },
    { packageName: 'dsh-notification', version: '0.1.3', usedByDshTeams: false },
    { packageName: 'dsh-plugin-sandbox-escalation-fix', version: '0.1.1', usedByDshTeams: false },
    { packageName: 'dsh-pocket', version: '2.10.0', usedByDshTeams: false },
    { packageName: 'pomasa-studio', version: '0.1.0', usedByDshTeams: false },
  ],
  services: [
    { name: 'webServer', signature: 'register(route)|registerUpgrade(route)' },
    { name: 'apiProxy', signature: 'POST /api/:method|upgrade /api/events.mux|upgrade /api/events.host' },
  ],
  surfaces: [
    { kind: 'http', id: 'GET /api/session.export', status: 'blocked', classification: 'blocked' },
    { kind: 'http', id: 'HEAD /api/session.export', status: 'blocked', classification: 'blocked' },
    { kind: 'http', id: 'POST /api/:method', status: 'blocked', classification: 'blocked' },
    { kind: 'http', id: 'POST /sidebar/api/:method', status: 'blocked', classification: 'blocked' },
    { kind: 'http', id: 'GET /sidebar/file', status: 'blocked', classification: 'blocked' },
    { kind: 'http', id: 'GET /sidebar/html', status: 'blocked', classification: 'blocked' },
    { kind: 'http', id: 'GET /sidebar/bundle', status: 'blocked', classification: 'blocked' },
    { kind: 'websocket', id: '/api/events.mux', status: 'blocked', classification: 'blocked' },
    { kind: 'websocket', id: '/api/events.host', status: 'blocked', classification: 'blocked' },
    { kind: 'websocket', id: '/sidebar/ws/terminal', status: 'blocked', classification: 'blocked' },
    { kind: 'websocket', id: '/sidebar/ws/agent-terminals', status: 'blocked', classification: 'blocked' },
  ],
  slots: [
    { id: 'conversation.session.header.utilities', status: 'covered' },
  ],
  resourceCreatingOperations: [
    { id: 'session.create', resource: 'session', status: 'blocked' },
    { id: 'workspace.create', resource: 'workspace', status: 'blocked' },
  ],
  introspection: [
    {
      id: 'dsh.runtime-registration-inventory',
      status: 'blocked',
      upstreamContractCandidate: 'DSH-RUNTIME-REGISTRATION-INVENTORY',
    },
  ],
  evidence: [
    {
      source: 'browser live page',
      observation: 'Session export triggers a browser download; the current loopback runtime serves the root without an authentication challenge.',
      reproduction: 'Open an authenticated session and export its log; request the loopback root without credentials.',
    },
    {
      source: 'installed package inventory',
      observation: 'Installed DSH packages match the versioned bundle inventory.',
      reproduction: 'Read the installed package inventory from the configured DSH profile.',
    },
    {
      source: 'source inspection',
      observation: 'apiProxy uses POST /api/:method and event upgrades at /api/events.mux and /api/events.host.',
      reproduction: 'Inspect dsh-client-connection and dsh-host-apiproxy carrier registrations.',
    },
  ],
}

async function writeProfile(input: unknown): Promise<string> {
  const profileDir = await mkdtemp(join(tmpdir(), 'dsh-profile-'))
  await writeFile(join(profileDir, 'dsh-web-profile.json'), JSON.stringify(input), 'utf8')
  return profileDir
}

function reverseObjectMemberOrder(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(reverseObjectMemberOrder)
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).reverse().map(([key, entry]) => [key, reverseObjectMemberOrder(entry)]),
    )
  }
  return value
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
    id: 'dsh.runtime-registration-inventory',
    status: 'blocked',
    upstreamContractCandidate: 'DSH-RUNTIME-REGISTRATION-INVENTORY',
  }])
})

test('makes canonical JSON and compatibility independent of recorded member order', () => {
  const reorderedProfile = reverseObjectMemberOrder(profile) as DshProfile
  const baseline = normalizeSnapshot(profile)
  const reordered = normalizeSnapshot(reorderedProfile)

  assert.equal(canonicalSnapshotJson(profile), canonicalSnapshotJson(reorderedProfile))
  assert.doesNotThrow(() => assertCompatibleSnapshot(baseline, reordered))
})

test('keeps changed recorded values incompatible after member canonicalization', () => {
  const baseline = normalizeSnapshot(profile)
  const changedProfile = reverseObjectMemberOrder({
    ...profile,
    bundles: profile.bundles.map((bundle) =>
      bundle.packageName === 'dsh-auth-gate' ? { ...bundle, version: '0.7.3' } : bundle,
    ),
  }) as DshProfile

  assert.throws(
    () => assertCompatibleSnapshot(baseline, normalizeSnapshot(changedProfile)),
    /changed discovered bundle: dsh-auth-gate/,
  )
})

test('normalizes evidence into deterministic source order', () => {
  const evidence = [
    {
      source: 'source-z',
      observation: 'later observation',
      reproduction: 'later reproduction',
    },
    {
      source: 'source-a',
      observation: 'earlier observation',
      reproduction: 'earlier reproduction',
    },
  ]

  const first = normalizeSnapshot({ ...profile, evidence })
  const second = normalizeSnapshot({ ...profile, evidence: [...evidence].reverse() })

  assert.deepEqual(first, second)
  assert.deepEqual(
    first.evidence,
    [...evidence].reverse(),
  )
})

test('retains live export, API, and event carrier evidence', () => {
  const surfaces = normalizeSnapshot(profile).surfaces

  assert.deepEqual(
    surfaces.map((surface) => `${surface.kind} ${surface.id}${surface.mode === undefined ? '' : ` ${surface.mode}`}`),
    [
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
    ],
  )
})

test('scans only the profile named by DSH_PROFILE_DIR', async () => {
  const profileDir = await writeProfile(profile)
  const snapshot = await scanProfile({ DSH_PROFILE_DIR: profileDir })

  assert.equal(snapshot.dshWeb.version, '0.1.1-rc.2')
  assert.equal(snapshot.bundles[0].packageName, '@deepseek-ai/dsh-base')
  assert.equal(snapshot.bundles[0].usedByDshTeams, false)
  await assert.rejects(
    () => scanProfile({}),
    /DSH_PROFILE_DIR must name the DSH profile directory/,
  )
})

test('rejects a profile that declares an unsupported schema version', async () => {
  const profileDir = await writeProfile({ ...profile, schemaVersion: 2 })

  await assert.rejects(
    () => scanProfile({ DSH_PROFILE_DIR: profileDir }),
    /DSH profile schema version 1 is required/,
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
      dshWeb: { ...profile.dshWeb, version: '0.1.1-rc.7' },
    })),
    /changed DSH Web version: 0\.1\.1-rc\.2 -> 0\.1\.1-rc\.7/,
  )
  assert.throws(
    () => assertCompatibleSnapshot(baseline, normalizeSnapshot({
      ...profile,
      surfaces: profile.surfaces.filter((surface) => surface.id !== 'HEAD /api/session.export'),
    })),
    /missing discovered surface: http HEAD \/api\/session\.export/,
  )
})

test('fails compatibility when an expected service signature is absent from discovery', () => {
  const expected = normalizeSnapshot(profile)
  const discovered = normalizeSnapshot({
    ...profile,
    services: profile.services.filter((service) => service.name !== 'apiProxy'),
  })

  assert.throws(
    () => assertCompatibleSnapshot(expected, discovered),
    /missing discovered service: apiProxy/,
  )
})

test('fails compatibility when discovery duplicates a known surface', () => {
  const baseline = normalizeSnapshot(profile)
  const discovered = normalizeSnapshot({
    ...profile,
    surfaces: [...profile.surfaces, profile.surfaces[0]],
  })

  assert.throws(
    () => assertCompatibleSnapshot(baseline, discovered),
    /changed discovered surface inventory/,
  )
})

test('fails compatibility when discovery duplicates a known service', () => {
  const baseline = normalizeSnapshot(profile)
  const discovered = normalizeSnapshot({
    ...profile,
    services: [...profile.services, profile.services[0]],
  })

  assert.throws(
    () => assertCompatibleSnapshot(baseline, discovered),
    /changed discovered service inventory/,
  )
})

test('fails compatibility when every remaining inventoried section drifts', () => {
  const baseline = normalizeSnapshot(profile)
  const cases: Array<[string, DshProfile]> = [
    ['changed bundle', {
      ...profile,
      bundles: profile.bundles.map((bundle) =>
        bundle.packageName === 'dsh-auth-gate' ? { ...bundle, version: '0.7.3' } : bundle,
      ),
    }],
    ['added bundle', {
      ...profile,
      bundles: [...profile.bundles, { packageName: 'dsh-new-bundle', version: '1.0.0', usedByDshTeams: false }],
    }],
    ['removed bundle', {
      ...profile,
      bundles: profile.bundles.filter((bundle) => bundle.packageName !== 'dsh-auth-gate'),
    }],
    ['changed slot', {
      ...profile,
      slots: profile.slots.map((slot) => ({ ...slot, status: 'blocked' })),
    }],
    ['added slot', {
      ...profile,
      slots: [...profile.slots, { id: 'conversation.session.footer.actions', status: 'covered' }],
    }],
    ['removed slot', {
      ...profile,
      slots: [],
    }],
    ['changed resource-creating operation', {
      ...profile,
      resourceCreatingOperations: profile.resourceCreatingOperations.map((operation) =>
        operation.id === 'session.create' ? { ...operation, resource: 'conversation' } : operation,
      ),
    }],
    ['added resource-creating operation', {
      ...profile,
      resourceCreatingOperations: [
        ...profile.resourceCreatingOperations,
        { id: 'session.clone', resource: 'session', status: 'requires-upstream-clarification' },
      ],
    }],
    ['removed resource-creating operation', {
      ...profile,
      resourceCreatingOperations: profile.resourceCreatingOperations.filter((operation) => operation.id !== 'session.create'),
    }],
    ['changed blocked introspection', {
      ...profile,
      introspection: [{
        id: 'dsh.stream-carrier-introspection',
        status: 'blocked',
        upstreamContractCandidate: 'DSH-STREAM-CARRIER-V2-CONTRACT',
      }],
    }],
    ['added blocked introspection', {
      ...profile,
      introspection: [{
        id: 'dsh.stream-carrier-introspection',
        status: 'blocked',
        upstreamContractCandidate: 'DSH-STREAM-CARRIER-CONTRACT',
      }, {
        id: 'dsh.another-introspection',
        status: 'blocked',
        upstreamContractCandidate: 'DSH-ANOTHER-CONTRACT',
      }],
    }],
    ['changed evidence', {
      ...profile,
      evidence: profile.evidence?.map((evidence) =>
        evidence.source === 'source inspection' ? { ...evidence, observation: 'changed observation' } : evidence,
      ),
    }],
    ['added evidence', {
      ...profile,
      evidence: [...(profile.evidence ?? []), {
        source: 'new source',
        observation: 'new observation',
        reproduction: 'new reproduction',
      }],
    }],
    ['removed evidence', {
      ...profile,
      evidence: profile.evidence?.filter((evidence) => evidence.source !== 'source inspection'),
    }],
  ]

  for (const [name, discoveredProfile] of cases) {
    assert.throws(
      () => assertCompatibleSnapshot(baseline, normalizeSnapshot(discoveredProfile)),
      Error,
      name,
    )
  }
})

test('fails compatibility when an explicitly recorded blocked introspection entry is removed', () => {
  const expected = normalizeSnapshot({
    ...profile,
    introspection: [{
      id: 'dsh.stream-carrier-introspection',
      status: 'blocked',
      upstreamContractCandidate: 'DSH-STREAM-CARRIER-CONTRACT',
    }, {
      id: 'dsh.another-introspection',
      status: 'blocked',
      upstreamContractCandidate: 'DSH-ANOTHER-CONTRACT',
    }],
  })
  const discovered = normalizeSnapshot({
    ...profile,
    introspection: [{
      id: 'dsh.stream-carrier-introspection',
      status: 'blocked',
      upstreamContractCandidate: 'DSH-STREAM-CARRIER-CONTRACT',
    }],
  })

  assert.throws(() => assertCompatibleSnapshot(expected, discovered))
})

test('reports every inventoried item under a fail-closed status', () => {
  const report = createSurfaceInventoryReport(normalizeSnapshot(profile))

  assert.deepEqual(report, {
    covered: [
      'slot conversation.session.header.utilities',
    ],
    blocked: [
      'http GET /api/session.export',
      'http GET /sidebar/bundle',
      'http GET /sidebar/file',
      'http GET /sidebar/html',
      'http HEAD /api/session.export',
      'http POST /api/:method',
      'http POST /sidebar/api/:method',
      'introspection dsh.runtime-registration-inventory',
      'operation session.create',
      'operation workspace.create',
      'websocket /api/events.host',
      'websocket /api/events.mux',
      'websocket /sidebar/ws/agent-terminals',
      'websocket /sidebar/ws/terminal',
    ],
    requiresUpstreamClarification: [],
    upstreamContractCandidates: ['DSH-RUNTIME-REGISTRATION-INVENTORY'],
  })
})
