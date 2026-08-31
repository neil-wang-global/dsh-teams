// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { request } from 'node:http'
import { connect } from 'node:net'

export interface RuntimeCarrier {
  kind: 'http' | 'websocket'
  method: 'POST' | 'UPGRADE'
  path: string
}

export interface RuntimeCarrierResult extends RuntimeCarrier {
  status: number
}

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
      response.resume()
      response.once('end', () => resolve(response.statusCode ?? 0))
    })
    probe.once('error', reject)
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
        `GET ${url.pathname} HTTP/1.1\r\nHost: ${url.host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
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

function assertDenied(carrier: RuntimeCarrier, status: number): void {
  if (status !== 401 && status !== 403) {
    throw new Error(`expected denial for ${carrier.method} ${carrier.path}: ${status}`)
  }
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
    assertDenied(carrier, status)
    results.push({ ...carrier, status })
  }

  return results
}
