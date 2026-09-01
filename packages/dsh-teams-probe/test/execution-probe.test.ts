// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  createInProcessExecutionPreset,
  createWorkspaceWorkerFixture,
  runExecutionIsolationProbe,
} from '../src/execution-probe.ts'

async function withFixture(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-teams-execution-probe-'))
  try {
    await run(root)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
}

test('execution isolation rejects the in-process preset after every required escape', async () => {
  await withFixture(async (root) => {
    const report = await runExecutionIsolationProbe(await createInProcessExecutionPreset(root))

    assert.equal(report.candidate, 'in-process')
    assert.equal(report.decision, 'blocked')
    assert.deepEqual(report.violations, [
      'cross-workspace-file-read',
      'cross-workspace-credential-read',
      'unapproved-host-tool',
      'subagent-fork-inheritance',
      'custom-remote-creation',
    ])
    assert.deepEqual(report.blocked, [])
  })
})

test('execution isolation keeps every required escape outside its workspace worker', async () => {
  await withFixture(async (root) => {
    const report = await runExecutionIsolationProbe(await createWorkspaceWorkerFixture(root))

    assert.equal(report.candidate, 'isolated-worker')
    assert.equal(report.decision, 'isolated-worker')
    assert.deepEqual(report.violations, [])
    assert.deepEqual(report.blocked, [
      'cross-workspace-file-read',
      'cross-workspace-credential-read',
      'unapproved-host-tool',
      'subagent-fork-inheritance',
      'custom-remote-creation',
    ])
  })
})

test('workspace worker rejects a path that resolves outside its canonical root', async () => {
  await withFixture(async (root) => {
    const worker = await createWorkspaceWorkerFixture(root)
    const session = worker.openSession('alpha')

    await assert.rejects(
      worker.readFile(session, 'alpha', '../bravo/private.txt'),
      /worker session cannot access file path/,
    )
  })
})

test('workspace worker rejects a forged session before allowing a Host tool', async () => {
  await withFixture(async (root) => {
    const worker = await createWorkspaceWorkerFixture(root)

    assert.throws(
      () => worker.useHostTool('forged-session', 'workspace.read'),
      /unknown execution session/,
    )
  })
})
