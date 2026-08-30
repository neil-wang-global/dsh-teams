// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { ACTION_CLASSIFICATIONS, parseManifest, type ActionClassification } from './manifest.ts'

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
