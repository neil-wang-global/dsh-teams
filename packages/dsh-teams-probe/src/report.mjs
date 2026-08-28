// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { ACTION_CLASSIFICATIONS, parseManifest } from './manifest.mjs'

export function createCompatibilityReport(input) {
  const manifest = parseManifest(input)
  const classifications = Object.fromEntries(
    ACTION_CLASSIFICATIONS.map((classification) => [classification, []]),
  )

  for (const entry of manifest.entries) {
    classifications[entry.classification].push(entry.id)
  }

  return {
    version: manifest.version,
    totalEntries: manifest.entries.length,
    classifications,
  }
}
