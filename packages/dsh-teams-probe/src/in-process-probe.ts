// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { DshSurfaceSnapshot } from './snapshot.ts'

export type ProbeObservation = 'intercepted-denied' | 'bypassed' | 'unresolved'

export interface ProbeTranscript {
  kind: 'http' | 'rpc' | 'websocket'
  id: string
  mode?: 'baseline' | 'incremental'
  observation: ProbeObservation
}

export interface InProcessCoverageReport {
  decision: 'in-process-covered' | 'sidecar-required'
  interceptedDenied: string[]
  bypassed: string[]
  duplicates: string[]
  missing: string[]
  unresolved: string[]
  failures: string[]
}

export interface InProcessProbeTransport {
  request(method: string, path: string): Promise<{ status: number }>
  upgrade(path: string): Promise<{ status: number }>
  transcripts(): readonly ProbeTranscript[]
}

function surfaceKey(surface: Pick<ProbeTranscript, 'kind' | 'id' | 'mode'>): string {
  return `${surface.kind} ${surface.id}${surface.mode === undefined ? '' : ` ${surface.mode}`}`
}

function sort(values: string[]): string[] {
  return values.sort((left, right) => left.localeCompare(right, 'en'))
}

export function assessInProcessCoverage(
  snapshot: DshSurfaceSnapshot,
  transcripts: readonly ProbeTranscript[],
): InProcessCoverageReport {
  const expected = new Map(snapshot.surfaces.map((surface) => [surfaceKey(surface), surface]))
  const bySurface = new Map<string, ProbeTranscript[]>()

  for (const transcript of transcripts) {
    const key = surfaceKey(transcript)
    const entries = bySurface.get(key) ?? []
    entries.push(transcript)
    bySurface.set(key, entries)
  }

  const interceptedDenied: string[] = []
  const bypassed: string[] = []
  const duplicates: string[] = []
  const missing: string[] = []
  const unresolved: string[] = []
  const failures: string[] = []

  for (const [key, surface] of expected) {
    const entries = bySurface.get(key) ?? []

    if (surface.status === 'requires-upstream-clarification') {
      unresolved.push(key)
      failures.push(`unresolved carrier: ${key}`)
      continue
    }

    if (entries.length === 0) {
      missing.push(key)
      failures.push(`missing transcript: ${key}`)
      continue
    }

    if (entries.length > 1) {
      duplicates.push(key)
      failures.push(`duplicate transcript: ${key}`)
    }

    if (entries.some((entry) => entry.observation === 'bypassed')) {
      bypassed.push(key)
      failures.push(`bypassed route: ${key}`)
      continue
    }

    if (entries.some((entry) => entry.observation === 'intercepted-denied')) {
      interceptedDenied.push(key)
      continue
    }

    unresolved.push(key)
    failures.push(`unresolved carrier: ${key}`)
  }

  for (const [key, entries] of bySurface) {
    if (expected.has(key)) {
      continue
    }
    if (entries.length > 1) {
      duplicates.push(key)
      failures.push(`duplicate transcript: ${key}`)
    }
    if (entries.some((entry) => entry.observation === 'bypassed')) {
      bypassed.push(key)
      failures.push(`bypassed route: ${key}`)
    } else {
      unresolved.push(key)
      failures.push(`unresolved carrier: ${key}`)
    }
  }

  sort(interceptedDenied)
  sort(bypassed)
  sort(duplicates)
  sort(missing)
  sort(unresolved)
  sort(failures)

  return {
    decision: failures.length === 0 ? 'in-process-covered' : 'sidecar-required',
    interceptedDenied,
    bypassed,
    duplicates,
    missing,
    unresolved,
    failures,
  }
}

function httpRequestFor(surfaceId: string): { method: string; path: string } {
  const separator = surfaceId.indexOf(' ')
  if (separator === -1) {
    throw new Error(`invalid HTTP surface identifier: ${surfaceId}`)
  }
  const method = surfaceId.slice(0, separator)
  const path = surfaceId.slice(separator + 1).replace(':method', 'session.list')
  return { method, path }
}

function assertDenied(surface: Pick<ProbeTranscript, 'kind' | 'id' | 'mode'>, status: number): void {
  if (status !== 403) {
    throw new Error(`expected denial for ${surfaceKey(surface)}: ${status}`)
  }
}

export async function runInProcessCoverageProbe(
  snapshot: DshSurfaceSnapshot,
  transport: InProcessProbeTransport,
): Promise<InProcessCoverageReport> {
  for (const surface of snapshot.surfaces) {
    if (surface.status === 'requires-upstream-clarification') {
      continue
    }
    if (surface.kind === 'http') {
      const request = httpRequestFor(surface.id)
      const response = await transport.request(request.method, request.path)
      assertDenied(surface, response.status)
    }
    if (surface.kind === 'websocket') {
      const response = await transport.upgrade(surface.id)
      assertDenied(surface, response.status)
    }
  }
  return assessInProcessCoverage(snapshot, transport.transcripts())
}
