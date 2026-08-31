// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  assertCoreRuntimeRegistrations,
  createRuntimeObserverPatch,
  createRuntimeObserverPluginSource,
  normalizeRuntimeRegistrationInventory,
} from './runtime-registration-capture.ts'

const CAPTURE_TIMEOUT_MS = 20_000
const POLL_INTERVAL_MS = 100

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function exitOutcome(process: ChildProcess): Promise<{ code: number | null, signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => process.once('exit', (code, signal) => resolve({ code, signal })))
}

async function readCaptureRecords(capturePath: string): Promise<unknown[]> {
  try {
    const content = await readFile(capturePath, 'utf8')
    return content.split('\n').filter((line) => line.length > 0).map((line) => JSON.parse(line) as unknown)
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return []
    }
    throw error
  }
}

function hasAllCoreRecords(records: readonly unknown[]): boolean {
  try {
    assertCoreRuntimeRegistrations(normalizeRuntimeRegistrationInventory(records))
    return true
  } catch {
    return false
  }
}

async function waitForCoreCapture(
  capturePath: string,
  process: ChildProcess,
): Promise<unknown[]> {
  const exited = exitOutcome(process)
  const deadline = Date.now() + CAPTURE_TIMEOUT_MS

  while (Date.now() < deadline) {
    const records = await readCaptureRecords(capturePath)
    if (hasAllCoreRecords(records)) {
      return records
    }
    const outcome = await Promise.race([
      exited.then((result) => ({ type: 'exit' as const, result })),
      wait(POLL_INTERVAL_MS).then(() => ({ type: 'poll' as const })),
    ])
    if (outcome.type === 'exit') {
      throw new Error(`disposable DSH exited before capture: code=${String(outcome.result.code)} signal=${String(outcome.result.signal)}`)
    }
  }

  throw new Error('timed out waiting for core runtime registrations')
}

async function stop(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null || process.signalCode !== null) {
    return
  }
  const exited = exitOutcome(process)
  process.kill('SIGTERM')
  await Promise.race([exited.then(() => undefined), wait(5_000)])
  if (process.exitCode === null && process.signalCode === null) {
    process.kill('SIGKILL')
    await exited
  }
}

const profile = process.env.DSH_RUNTIME_PROFILE?.trim() || 'web'
const profileSource = process.env.DSH_RUNTIME_PROFILE_DIR?.trim()
  || join(homedir(), '.dsh', 'profiles', profile)
const reportPath = process.env.DSH_RUNTIME_CAPTURE_REPORT?.trim()
const debug = process.env.DSH_RUNTIME_CAPTURE_DEBUG === '1'
const directory = await mkdtemp(join(tmpdir(), 'dsh-teams-runtime-capture-'))
const isolatedHome = join(directory, 'dsh-home')
const pluginPath = join(directory, 'observer.mjs')
const patchPath = join(directory, 'observer.patch.yml')
const capturePath = join(directory, 'registrations.ndjson')

let runtime: ChildProcess | undefined
try {
  await mkdir(join(isolatedHome, 'profiles'), { recursive: true })
  await symlink(profileSource, join(isolatedHome, 'profiles', profile))
  await writeFile(pluginPath, createRuntimeObserverPluginSource(capturePath), 'utf8')
  await writeFile(patchPath, createRuntimeObserverPatch(pluginPath, capturePath), 'utf8')

  runtime = spawn('dsh', [
    '--profile', profile,
    '--patch', patchPath,
    '--no-open',
    '--host', '127.0.0.1',
    '--port', '0',
  ], {
    env: { ...process.env, DSH_HOME: isolatedHome },
    stdio: debug ? 'inherit' : ['ignore', 'ignore', 'ignore'],
  })
  const records = await waitForCoreCapture(capturePath, runtime)
  const inventory = normalizeRuntimeRegistrationInventory(records)
  assertCoreRuntimeRegistrations(inventory)

  const serialized = `${JSON.stringify(inventory, null, 2)}\n`
  if (reportPath !== undefined && reportPath.length > 0) {
    await writeFile(resolve(process.env.INIT_CWD ?? process.cwd(), reportPath), serialized, 'utf8')
  }
  process.stdout.write(serialized)
} finally {
  if (runtime !== undefined) {
    await stop(runtime)
  }
  await rm(directory, { recursive: true, force: true })
}
