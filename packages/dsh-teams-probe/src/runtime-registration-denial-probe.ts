// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { randomBytes } from 'node:crypto'
import { createServer, request, type IncomingMessage, type Server } from 'node:http'
import { connect } from 'node:net'

import type { ProbeTranscript } from './in-process-probe.ts'
import type { RuntimeRegistration, RuntimeRegistrationInventory } from './runtime-registration-capture.ts'

function registrationPath(registration: RuntimeRegistration): string {
  const separator = registration.id.indexOf(' ')
  if (separator === -1) {
    throw new Error(`invalid HTTP runtime registration identifier: ${registration.id}`)
  }
  return registration.id.slice(separator + 1)
}

function httpRegistrationFor(
  registrations: readonly RuntimeRegistration[],
  path: string,
): RuntimeRegistration | undefined {
  const candidates = registrations.filter((registration) => {
    const [kind, registeredPath] = registration.id.split(' ', 2)
    return (kind === 'exact' && registeredPath === path)
      || (kind === 'prefix' && path.startsWith(registeredPath))
  })
  return candidates.sort((left, right) => {
    const [leftKind, leftPath] = left.id.split(' ', 2)
    const [rightKind, rightPath] = right.id.split(' ', 2)
    if (leftKind !== rightKind) {
      return leftKind === 'exact' ? -1 : 1
    }
    return rightPath.length - leftPath.length
  })[0]
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('runtime registration probe did not bind a TCP address')
  }
  return address.port
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

async function requestStatus(port: number, path: string, rpc = false): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const probe = request({
      host: '127.0.0.1',
      port,
      method: 'GET',
      path,
      headers: rpc ? { 'x-dsh-teams-probe-rpc': '1' } : undefined,
    }, (response) => {
      response.resume()
      response.once('end', () => resolve(response.statusCode ?? 0))
    })
    probe.once('error', reject)
    probe.end()
  })
}

async function upgradeStatus(port: number, path: string): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port })
    let buffer = ''
    let done = false
    const finish = (status: number): void => {
      if (done) return
      done = true
      socket.destroy()
      resolve(status)
    }

    socket.once('connect', () => {
      socket.write(
        `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      )
    })
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const lineEnd = buffer.indexOf('\r\n')
      if (lineEnd !== -1) finish(Number(buffer.slice(0, lineEnd).split(' ')[1]))
    })
    socket.once('error', (error) => {
      if (!done) reject(error)
    })
  })
}

function assertDenied(status: number, registration: RuntimeRegistration): void {
  if (status !== 403) {
    throw new Error(`captured registration was not denied: ${registration.carrier} ${registration.id}: ${status}`)
  }
}

export async function runRuntimeRegistrationDenialProbe(
  inventory: RuntimeRegistrationInventory,
): Promise<ProbeTranscript[]> {
  const transcripts: ProbeTranscript[] = []
  const httpRegistrations = inventory.registrations.filter((registration) => registration.kind === 'http')
  const upgrades = new Map(inventory.registrations
    .filter((registration) => registration.kind === 'websocket')
    .map((registration) => [registration.id, registration]))
  const rpcRegistrations = new Map(inventory.registrations
    .filter((registration) => registration.kind === 'rpc')
    .map((registration) => [registration.id, registration]))

  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    const rpc = request.headers['x-dsh-teams-probe-rpc'] === '1'
    const registration = rpc ? rpcRegistrations.get('/api') : httpRegistrationFor(httpRegistrations, path)
    if (registration === undefined) {
      response.writeHead(404).end()
      return
    }
    transcripts.push({ kind: registration.kind, id: registration.id, observation: 'intercepted-denied' })
    response.writeHead(403).end()
  })
  server.on('upgrade', (request: IncomingMessage, socket) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    const registration = upgrades.get(path)
    if (registration === undefined) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
      return
    }
    transcripts.push({ kind: 'websocket', id: registration.id, observation: 'intercepted-denied' })
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
  })

  const port = await listen(server)
  try {
    for (const registration of inventory.registrations) {
      if (registration.kind === 'http') {
        assertDenied(await requestStatus(port, registrationPath(registration)), registration)
      } else if (registration.kind === 'websocket') {
        assertDenied(await upgradeStatus(port, registration.id), registration)
      } else {
        assertDenied(await requestStatus(port, '/api/dsh-teams-probe', true), registration)
      }
    }
  } finally {
    await close(server)
  }

  return transcripts.sort((left, right) => {
    const leftKey = `${left.kind}\u0000${left.id}`
    const rightKey = `${right.kind}\u0000${right.id}`
    return leftKey.localeCompare(rightKey, 'en')
  })
}
