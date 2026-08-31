// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import test from 'node:test'

import {
  CORE_DSH_CARRIERS,
  assertRuntimeCarrierDenial,
  probeRuntimeCarriers,
} from '../src/runtime-carrier-probe.ts'

async function startDeniedRuntime(): Promise<{ baseUrl: string; requests: string[]; close(): Promise<void> }> {
  const requests: string[] = []
  const server: Server = createServer((request, response) => {
    requests.push(`${request.method} ${new URL(request.url ?? '/', 'http://127.0.0.1').pathname}`)
    response.writeHead(401).end()
  })
  server.on('upgrade', (request, socket) => {
    requests.push(`UPGRADE ${new URL(request.url ?? '/', 'http://127.0.0.1').pathname}`)
    socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('test runtime did not bind a TCP port')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () => await new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

test('probes every standard DSH carrier without request payloads', async () => {
  const runtime = await startDeniedRuntime()

  try {
    const result = await probeRuntimeCarriers(runtime.baseUrl)

    assert.deepEqual(result, CORE_DSH_CARRIERS.map((carrier) => ({
      ...carrier,
      status: 401,
      exposure: 'denied',
    })))
    assert.doesNotThrow(() => assertRuntimeCarrierDenial(result))
    assert.deepEqual(runtime.requests, [
      'POST /api/session.list',
      'POST /api/session.search',
      'POST /api/workspace.create',
      'UPGRADE /api/events.mux',
      'UPGRADE /api/events.host',
    ])
  } finally {
    await runtime.close()
  }
})

test('reports a runtime carrier that releases a response as not denied', async () => {
  const server = createServer((_request, response) => response.writeHead(200).end())
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('test runtime did not bind a TCP port')
  }

  try {
    const result = await probeRuntimeCarriers(
      `http://127.0.0.1:${address.port}`,
      [CORE_DSH_CARRIERS[0]],
    )

    assert.deepEqual(result, [{
      ...CORE_DSH_CARRIERS[0],
      status: 200,
      exposure: 'not-denied',
    }])
    assert.throws(
      () => assertRuntimeCarrierDenial(result),
      /runtime carrier not denied: POST \/api\/session\.list: 200/,
    )
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('reports an HTTP carrier after headers from a streaming response', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200)
    const timer = setInterval(() => response.write('x'), 25)
    response.once('close', () => clearInterval(timer))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('test runtime did not bind a TCP port')
  }

  try {
    const result = await Promise.race([
      probeRuntimeCarriers(
        `http://127.0.0.1:${address.port}`,
        [CORE_DSH_CARRIERS[0]],
      ),
      new Promise<never>((_resolve, reject) => setTimeout(
        () => reject(new Error('streaming response did not yield a carrier status')),
        250,
      )),
    ])

    assert.deepEqual(result, [{
      ...CORE_DSH_CARRIERS[0],
      status: 200,
      exposure: 'not-denied',
    }])
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('fails a non-responding HTTP carrier within the probe timeout', async () => {
  const server = createServer(() => {})
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('test runtime did not bind a TCP port')
  }

  try {
    const outcome = await Promise.race([
      probeRuntimeCarriers(
        `http://127.0.0.1:${address.port}`,
        [CORE_DSH_CARRIERS[0]],
      ).then(
        () => 'resolved',
        (error: unknown) => error instanceof Error ? error.message : String(error),
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve('still pending'), 5_500)),
    ])

    assert.match(outcome, /timed out requesting \/api\/session\.list/)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('reports a standard WebSocket upgrade as not denied', async () => {
  let hasWebSocketKey = false
  const server = createServer((_request, response) => response.writeHead(404).end())
  server.on('upgrade', (request, socket) => {
    hasWebSocketKey = typeof request.headers['sec-websocket-key'] === 'string'
    socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('test runtime did not bind a TCP port')
  }

  try {
    const result = await probeRuntimeCarriers(
      `http://127.0.0.1:${address.port}`,
      [CORE_DSH_CARRIERS[3]],
    )

    assert.equal(hasWebSocketKey, true)
    assert.deepEqual(result, [{
      ...CORE_DSH_CARRIERS[3],
      status: 101,
      exposure: 'not-denied',
    }])
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
