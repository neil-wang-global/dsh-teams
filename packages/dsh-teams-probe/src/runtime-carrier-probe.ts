// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { request } from 'node:http'
import { connect } from 'node:net'
import { randomBytes } from 'node:crypto'

export interface RuntimeCarrier {
  kind: 'http' | 'websocket'
  method: 'POST' | 'UPGRADE'
  path: string
}

export interface RuntimeCarrierResult extends RuntimeCarrier {
  status: number
  exposure: RuntimeCarrierExposure
}

export type RuntimeCarrierExposure = 'denied' | 'not-denied'

export const CORE_DSH_CARRIERS: readonly RuntimeCarrier[] = [
  { kind: 'http', method: 'POST', path: '/api/session.list' },
  { kind: 'http', method: 'POST', path: '/api/session.search' },
  { kind: 'http', method: 'POST', path: '/api/workspace.create' },
  { kind: 'websocket', method: 'UPGRADE', path: '/api/events.mux' },
  { kind: 'websocket', method: 'UPGRADE', path: '/api/events.host' },
]

function runtimeUrl(baseUrl: string, path: string): URL {
  const url = new URL(path, baseUrl)
  if (url.protocol !== 'http:') {
    throw new Error(`DSH runtime URL must use http: ${url.protocol}`)
  }
  return url
}

async function requestStatus(url: URL): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const probe = request(url, { method: 'POST' }, (response) => {
      const status = response.statusCode ?? 0
      resolve(status)
      response.destroy()
    })
    probe.once('error', reject)
    probe.setTimeout(5_000, () => {
      probe.destroy(new Error(`timed out requesting ${url.pathname}`))
    })
    probe.end()
  })
}

async function upgradeStatus(url: URL): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const socket = connect({
      host: url.hostname,
      port: Number(url.port || '80'),
    })
    let buffer = ''
    let complete = false

    const finish = (status: number): void => {
      if (complete) {
        return
      }
      complete = true
      socket.destroy()
      resolve(status)
    }

    socket.once('connect', () => {
      socket.write(
        `GET ${url.pathname} HTTP/1.1\r\nHost: ${url.host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      )
    })
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const lineEnd = buffer.indexOf('\r\n')
      if (lineEnd === -1) {
        return
      }
      const status = Number(buffer.slice(0, lineEnd).split(' ')[1])
      finish(status)
    })
    socket.once('error', (error) => {
      if (!complete) {
        complete = true
        reject(error)
      }
    })
    socket.setTimeout(5_000, () => {
      if (!complete) {
        complete = true
        socket.destroy()
        reject(new Error(`timed out upgrading ${url.pathname}`))
      }
    })
  })
}

function exposureFor(status: number): RuntimeCarrierExposure {
  return status === 401 || status === 403
    ? 'denied'
    : 'not-denied'
}

export function assertRuntimeCarrierDenial(results: readonly RuntimeCarrierResult[]): void {
  const notDenied = results.filter((result) => result.exposure === 'not-denied')
  if (notDenied.length === 0) {
    return
  }
  const result = notDenied[0]
  throw new Error(`runtime carrier not denied: ${result.method} ${result.path}: ${result.status}`)
}

export async function probeRuntimeCarriers(
  baseUrl: string,
  carriers: readonly RuntimeCarrier[] = CORE_DSH_CARRIERS,
): Promise<RuntimeCarrierResult[]> {
  const results: RuntimeCarrierResult[] = []

  for (const carrier of carriers) {
    const url = runtimeUrl(baseUrl, carrier.path)
    const status = carrier.kind === 'http'
      ? await requestStatus(url)
      : await upgradeStatus(url)
    results.push({ ...carrier, status, exposure: exposureFor(status) })
  }

  return results
}
