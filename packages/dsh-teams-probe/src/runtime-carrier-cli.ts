// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { probeRuntimeCarriers } from './runtime-carrier-probe.ts'

const baseUrl = process.env.DSH_RUNTIME_URL?.trim()
if (baseUrl === undefined || baseUrl.length === 0) {
  throw new Error('DSH_RUNTIME_URL must name the DSH runtime base URL')
}

console.log(JSON.stringify(await probeRuntimeCarriers(baseUrl), null, 2))
