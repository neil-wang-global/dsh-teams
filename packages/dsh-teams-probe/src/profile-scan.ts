// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { normalizeSnapshot, type DshProfile, type DshSurfaceSnapshot } from './snapshot.ts'

const PROFILE_FILE = 'dsh-web-profile.json'

export async function scanProfile(environment: NodeJS.ProcessEnv = process.env): Promise<DshSurfaceSnapshot> {
  const profileDir = environment.DSH_PROFILE_DIR?.trim()
  if (profileDir === undefined || profileDir.length === 0) {
    throw new Error('DSH_PROFILE_DIR must name the DSH profile directory')
  }

  const profilePath = resolve(profileDir, PROFILE_FILE)
  const text = await readFile(profilePath, 'utf8')
  return normalizeSnapshot(JSON.parse(text) as DshProfile)
}
