// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { ActionClassification } from './manifest.ts'

export const SURFACE_STATUSES = [
  'covered',
  'blocked',
  'requires-upstream-clarification',
] as const

export type SurfaceStatus = (typeof SURFACE_STATUSES)[number]

export interface DshBundle {
  packageName: string
  version: string
  usedByDshTeams: boolean
}

export interface DshService {
  name: string
  signature: string
}

export interface DshSurface {
  kind: 'http' | 'rpc' | 'websocket'
  id: string
  mode?: 'baseline' | 'incremental'
  status: SurfaceStatus
  classification: ActionClassification
}

export interface DshSlot {
  id: string
  status: SurfaceStatus
}

export interface ResourceCreatingOperation {
  id: string
  resource: string
  status: SurfaceStatus
}

export interface IntrospectionEntry {
  id: string
  status: 'blocked'
  upstreamContractCandidate: string
}

export interface DshProfile {
  schemaVersion: 1
  dshWeb: {
    packageName: string
    version: string
  }
  bundles: DshBundle[]
  services: DshService[]
  surfaces: DshSurface[]
  slots: DshSlot[]
  resourceCreatingOperations: ResourceCreatingOperation[]
  introspection?: IntrospectionEntry[]
}

export interface DshSurfaceSnapshot extends Required<DshProfile> {}

const DEFAULT_INTROSPECTION: IntrospectionEntry = {
  id: 'dsh.route-stream-introspection',
  status: 'blocked',
  upstreamContractCandidate: 'DSH-ROUTE-STREAM-INTROSPECTION',
}

function compareBy<T>(key: (value: T) => string): (left: T, right: T) => number {
  return (left, right) => key(left).localeCompare(key(right), 'en')
}

function copyAndSort<T>(values: readonly T[], key: (value: T) => string): T[] {
  return values.map((value) => ({ ...value })).sort(compareBy(key))
}

function surfaceKey(surface: DshSurface): string {
  return `${surface.kind} ${surface.id}${surface.mode === undefined ? '' : ` ${surface.mode}`}`
}

function snapshotSurfaceKey(surface: DshSurfaceSnapshot['surfaces'][number]): string {
  return surfaceKey(surface)
}

export function normalizeSnapshot(profile: DshProfile): DshSurfaceSnapshot {
  if (profile.schemaVersion !== 1) {
    throw new Error('DSH profile schema version 1 is required')
  }

  return {
    schemaVersion: 1,
    dshWeb: { ...profile.dshWeb },
    bundles: copyAndSort(profile.bundles, (bundle) => bundle.packageName),
    services: copyAndSort(profile.services, (service) => service.name),
    surfaces: copyAndSort(profile.surfaces, surfaceKey),
    slots: copyAndSort(profile.slots, (slot) => slot.id),
    resourceCreatingOperations: copyAndSort(
      profile.resourceCreatingOperations,
      (operation) => operation.id,
    ),
    introspection: copyAndSort(
      profile.introspection === undefined || profile.introspection.length === 0
        ? [DEFAULT_INTROSPECTION]
        : profile.introspection,
      (entry) => entry.id,
    ),
  }
}

export function canonicalSnapshotJson(profile: DshProfile): string {
  return `${JSON.stringify(normalizeSnapshot(profile), null, 2)}\n`
}

export function assertCompatibleSnapshot(
  expected: DshSurfaceSnapshot,
  discovered: DshSurfaceSnapshot,
): void {
  if (expected.dshWeb.packageName !== discovered.dshWeb.packageName) {
    throw new Error(`changed DSH Web package: ${expected.dshWeb.packageName} -> ${discovered.dshWeb.packageName}`)
  }
  if (expected.dshWeb.version !== discovered.dshWeb.version) {
    throw new Error(`changed DSH Web version: ${expected.dshWeb.version} -> ${discovered.dshWeb.version}`)
  }

  const expectedSurfaces = new Map(expected.surfaces.map((surface) => [snapshotSurfaceKey(surface), surface]))
  const discoveredSurfaceKeys = new Set(discovered.surfaces.map(snapshotSurfaceKey))
  for (const key of expectedSurfaces.keys()) {
    if (!discoveredSurfaceKeys.has(key)) {
      throw new Error(`missing discovered surface: ${key}`)
    }
  }
  for (const surface of discovered.surfaces) {
    const key = snapshotSurfaceKey(surface)
    const existing = expectedSurfaces.get(key)
    if (existing === undefined) {
      throw new Error(`new discovered surface: ${key}`)
    }
    if (existing.status !== surface.status || existing.classification !== surface.classification) {
      throw new Error(`changed discovered surface: ${key}`)
    }
  }

  const expectedServices = new Map(expected.services.map((service) => [service.name, service.signature]))
  const discoveredServiceNames = new Set(discovered.services.map((service) => service.name))
  for (const name of expectedServices.keys()) {
    if (!discoveredServiceNames.has(name)) {
      throw new Error(`missing discovered service: ${name}`)
    }
  }
  for (const service of discovered.services) {
    const signature = expectedServices.get(service.name)
    if (signature === undefined) {
      throw new Error(`new discovered service: ${service.name}`)
    }
    if (signature !== service.signature) {
      throw new Error(`changed service signature: ${service.name}`)
    }
  }
}
