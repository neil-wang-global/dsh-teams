// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

export const ACTION_CLASSIFICATIONS = [
  'public-authenticated',
  'workspace-visible-read',
  'holder-write',
  'owner-write',
  'system-admin',
  'blocked',
] as const

export type ActionClassification = (typeof ACTION_CLASSIFICATIONS)[number]

export interface ManifestEntry {
  id: string
  kind: string
  classification: ActionClassification
  resourceScope?: string
}

export interface SurfaceManifest {
  version: 1
  entries: ManifestEntry[]
}

export type ParsedManifest = SurfaceManifest

const supportedClassifications = new Set<string>(ACTION_CLASSIFICATIONS)

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function isActionClassification(value: string): value is ActionClassification {
  return supportedClassifications.has(value)
}

export function parseManifest(input: unknown): ParsedManifest {
  if (!isRecord(input) || input.version !== 1 || !Array.isArray(input.entries)) {
    throw new Error('manifest must contain version 1 and entries')
  }

  const identifiers = new Set<string>()
  const entries = input.entries.map((entry): ManifestEntry => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || entry.id.length === 0) {
      throw new Error('manifest entry identifier is required')
    }

    if (identifiers.has(entry.id)) {
      throw new Error(`duplicate manifest identifier: ${entry.id}`)
    }
    identifiers.add(entry.id)

    if (typeof entry.classification !== 'string' || entry.classification.length === 0) {
      throw new Error(`classification is required for ${entry.id}`)
    }

    if (!isActionClassification(entry.classification)) {
      throw new Error(`unknown classification for ${entry.id}: ${entry.classification}`)
    }

    if (entry.classification !== 'blocked'
      && (typeof entry.resourceScope !== 'string' || entry.resourceScope.trim().length === 0)) {
      throw new Error(`resource scope is required for ${entry.id}`)
    }

    return {
      ...entry,
      id: entry.id,
      kind: typeof entry.kind === 'string' ? entry.kind : '',
      classification: entry.classification,
      ...(typeof entry.resourceScope === 'string' ? { resourceScope: entry.resourceScope } : {}),
    }
  })

  return { version: 1, entries }
}
