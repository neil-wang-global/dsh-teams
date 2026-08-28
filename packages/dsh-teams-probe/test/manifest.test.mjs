// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import assert from 'node:assert/strict'
import test from 'node:test'

import { ACTION_CLASSIFICATIONS, parseManifest } from '../src/manifest.mjs'
import { createCompatibilityReport } from '../src/report.mjs'

const classifications = [
  'public-authenticated',
  'workspace-visible-read',
  'holder-write',
  'owner-write',
  'system-admin',
  'blocked',
]

function manifestEntry(id, classification, resourceScope = 'workspace') {
  return classification === 'blocked'
    ? { id, kind: 'route', classification }
    : { id, kind: 'route', classification, resourceScope }
}

test('accepts every supported action classification', () => {
  const manifest = parseManifest({
    version: 1,
    entries: classifications.map((classification, index) =>
      manifestEntry(`route.${index}`, classification),
    ),
  })

  assert.deepEqual([...ACTION_CLASSIFICATIONS], classifications)
  assert.deepEqual(
    manifest.entries.map((entry) => entry.classification),
    classifications,
  )
})

test('returns a copy that cannot change the parsed manifest', () => {
  const input = { version: 1, entries: [manifestEntry('session.list', 'workspace-visible-read')] }
  const manifest = parseManifest(input)

  input.entries[0].id = 'changed'

  assert.equal(manifest.entries[0].id, 'session.list')
})

test('rejects duplicate identifiers', () => {
  assert.throws(
    () => parseManifest({
      version: 1,
      entries: [
        manifestEntry('session.list', 'workspace-visible-read'),
        manifestEntry('session.list', 'holder-write'),
      ],
    }),
    /duplicate manifest identifier: session\.list/,
  )
})

test('rejects an omitted classification with its route name', () => {
  assert.throws(
    () => parseManifest({ version: 1, entries: [{ id: 'workspace.members', kind: 'route' }] }),
    /classification is required for workspace\.members/,
  )
})

test('rejects an unclassified stream fixture with its stream name', () => {
  assert.throws(
    () => parseManifest({ version: 1, entries: [{ id: 'session.events', kind: 'stream' }] }),
    /classification is required for session\.events/,
  )
})

test('rejects non-blocked actions without a resource scope', () => {
  assert.throws(
    () => parseManifest({
      version: 1,
      entries: [{ id: 'session.send', kind: 'route', classification: 'holder-write' }],
    }),
    /resource scope is required for session\.send/,
  )
})

test('rejects whitespace-only resource scopes', () => {
  assert.throws(
    () => parseManifest({
      version: 1,
      entries: [{
        id: 'session.send',
        kind: 'route',
        classification: 'holder-write',
        resourceScope: '   ',
      }],
    }),
    /resource scope is required for session\.send/,
  )
})

test('rejects malformed manifests and unknown classifications', () => {
  assert.throws(() => parseManifest(null), /version 1 and entries/)
  assert.throws(() => parseManifest({ version: 2, entries: [] }), /version 1 and entries/)
  assert.throws(
    () => parseManifest({
      version: 1,
      entries: [manifestEntry('session.delete', 'allow')],
    }),
    /unknown classification for session\.delete: allow/,
  )
})

test('creates a report that groups parsed entries by classification', () => {
  const report = createCompatibilityReport({
    version: 1,
    entries: [
      manifestEntry('auth.status', 'public-authenticated', 'system'),
      manifestEntry('session.events', 'blocked'),
    ],
  })

  assert.deepEqual(report, {
    version: 1,
    totalEntries: 2,
    classifications: {
      'public-authenticated': ['auth.status'],
      'workspace-visible-read': [],
      'holder-write': [],
      'owner-write': [],
      'system-admin': [],
      blocked: ['session.events'],
    },
  })
})
