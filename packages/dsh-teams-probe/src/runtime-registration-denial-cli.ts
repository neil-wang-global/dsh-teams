// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { runRuntimeRegistrationDenialProbe } from './runtime-registration-denial-probe.ts'
import type { RuntimeRegistrationInventory } from './runtime-registration-capture.ts'

const inventoryPath = process.env.DSH_RUNTIME_INVENTORY?.trim()
  || resolve(process.env.INIT_CWD ?? process.cwd(), 'docs/compatibility/runtime-registration-inventory.json')
const reportPath = process.env.DSH_RUNTIME_DENIAL_REPORT?.trim()
  || 'docs/compatibility/runtime-registration-denial-transcript.json'

const inventory = JSON.parse(await readFile(inventoryPath, 'utf8')) as RuntimeRegistrationInventory
const transcripts = await runRuntimeRegistrationDenialProbe(inventory)
const serialized = `${JSON.stringify({ version: 1, transcripts }, null, 2)}\n`
await writeFile(resolve(process.env.INIT_CWD ?? process.cwd(), reportPath), serialized, 'utf8')
process.stdout.write(serialized)
