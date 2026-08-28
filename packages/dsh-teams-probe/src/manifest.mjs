export const ACTION_CATEGORIES = new Set([
  'public-authenticated',
  'workspace-visible-read',
  'holder-write',
  'owner-write',
  'system-admin',
  'blocked',
])

export function parseManifest(input) {
  if (!input || input.version !== 1 || !Array.isArray(input.entries)) {
    throw new Error('manifest must contain version 1 and entries')
  }

  const ids = new Set()
  for (const entry of input.entries) {
    if (!entry || typeof entry.id !== 'string' || entry.id.length === 0) {
      throw new Error('entry id is required')
    }
    if (ids.has(entry.id)) {
      throw new Error(`duplicate manifest id: ${entry.id}`)
    }
    ids.add(entry.id)
    if (!ACTION_CATEGORIES.has(entry.category)) {
      throw new Error(`invalid category for ${entry.id}`)
    }
    if (entry.category !== 'blocked' && typeof entry.resourceScope !== 'string') {
      throw new Error(`resourceScope is required for ${entry.id}`)
    }
  }

  return {
    version: 1,
    entries: input.entries.map((entry) => ({ ...entry })),
  }
}
