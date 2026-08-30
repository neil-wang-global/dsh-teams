// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { ACTION_CLASSIFICATIONS, parseManifest, type ActionClassification } from './manifest.ts'
import type { DshSurfaceSnapshot, SurfaceStatus } from './snapshot.ts'

export type ClassificationGroups = Record<ActionClassification, string[]>

export interface CompatibilityReport {
  version: 1
  totalEntries: number
  classifications: ClassificationGroups
}

export function createCompatibilityReport(input: unknown): CompatibilityReport {
  const manifest = parseManifest(input)
  const classifications = Object.fromEntries(
    ACTION_CLASSIFICATIONS.map((classification) => [classification, [] as string[]]),
  ) as ClassificationGroups

  for (const entry of manifest.entries) {
    classifications[entry.classification].push(entry.id)
  }

  return {
    version: manifest.version,
    totalEntries: manifest.entries.length,
    classifications,
  }
}

export interface SurfaceInventoryReport {
  covered: string[]
  blocked: string[]
  requiresUpstreamClarification: string[]
  upstreamContractCandidates: string[]
}

function reportStatus(status: SurfaceStatus): keyof Omit<SurfaceInventoryReport, 'upstreamContractCandidates'> {
  return status === 'requires-upstream-clarification'
    ? 'requiresUpstreamClarification'
    : status
}

export function createSurfaceInventoryReport(snapshot: DshSurfaceSnapshot): SurfaceInventoryReport {
  const report: SurfaceInventoryReport = {
    covered: [],
    blocked: [],
    requiresUpstreamClarification: [],
    upstreamContractCandidates: [],
  }

  for (const surface of snapshot.surfaces) {
    report[reportStatus(surface.status)].push(
      `${surface.kind} ${surface.id}${surface.mode === undefined ? '' : ` ${surface.mode}`}`,
    )
  }
  for (const slot of snapshot.slots) {
    report[reportStatus(slot.status)].push(`slot ${slot.id}`)
  }
  for (const operation of snapshot.resourceCreatingOperations) {
    report[reportStatus(operation.status)].push(`operation ${operation.id}`)
  }
  for (const introspection of snapshot.introspection) {
    report.blocked.push(`introspection ${introspection.id}`)
    report.upstreamContractCandidates.push(introspection.upstreamContractCandidate)
  }

  for (const entries of [
    report.covered,
    report.blocked,
    report.requiresUpstreamClarification,
    report.upstreamContractCandidates,
  ]) {
    entries.sort((left, right) => left.localeCompare(right, 'en'))
  }

  return report
}
