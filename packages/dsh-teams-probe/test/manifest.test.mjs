import test from 'node:test'
import assert from 'node:assert/strict'
import { parseManifest } from '../src/manifest.mjs'

test('rejects an entry without an authorization category', () => {
  assert.throws(
    () => parseManifest({ version: 1, entries: [{ id: 'session.list', transport: 'rpc' }] }),
    /category/,
  )
})
