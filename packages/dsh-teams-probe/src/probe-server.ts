// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { createServer, request as requestHttp, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { connect, type Socket } from 'node:net'
import type { Duplex } from 'node:stream'

import type { ProbeTranscript } from './in-process-probe.ts'

export interface ProbeSurface {
  kind: 'http' | 'websocket'
  id: string
  mode?: 'baseline' | 'incremental'
}

export interface ProbeRoute {
  kind: 'http' | 'websocket'
  id: string
}

export interface ProbeServerOptions {
  adapter: FiberProbeAdapter
  rawRoutes?: readonly ProbeRoute[]
}

export interface ProbeHttpResponse {
  status: number
}

export interface ProbeUpgradeResponse {
  status: number
  frames: string[]
}

const REGISTERED_HTTP_ROUTES: readonly ProbeRoute[] = [
  { kind: 'http', id: 'GET /api/session.export' },
  { kind: 'http', id: 'HEAD /api/session.export' },
  { kind: 'http', id: 'POST /api/:method' },
  { kind: 'http', id: 'POST /sidebar/api/:method' },
  { kind: 'http', id: 'GET /sidebar/file' },
  { kind: 'http', id: 'GET /sidebar/html' },
  { kind: 'http', id: 'GET /sidebar/bundle' },
]

const REGISTERED_WEBSOCKET_ROUTES: readonly ProbeRoute[] = [
  { kind: 'websocket', id: '/api/events.mux' },
  { kind: 'websocket', id: '/api/events.host' },
  { kind: 'websocket', id: '/sidebar/ws/terminal' },
  { kind: 'websocket', id: '/sidebar/ws/agent-terminals' },
]

function matchesHttpRoute(route: ProbeRoute, method: string, path: string): boolean {
  const [routeMethod, routePath] = route.id.split(' ', 2)
  return routeMethod === method
    && (routePath === path
      || (routePath === '/api/:method' && path.startsWith('/api/'))
      || (routePath === '/sidebar/api/:method' && path.startsWith('/sidebar/api/')))
}

function routeForHttp(routes: readonly ProbeRoute[], method: string, path: string): ProbeRoute | undefined {
  return routes.find((route) => route.kind === 'http' && matchesHttpRoute(route, method, path))
}

function routeForWebSocket(routes: readonly ProbeRoute[], path: string): ProbeRoute | undefined {
  return routes.find((route) => route.kind === 'websocket' && route.id === path)
}

export class FiberProbeAdapter {
  private permitted = false
  private readonly recorded: ProbeTranscript[] = []

  allow(): void {
    this.permitted = true
  }

  deny(): void {
    this.permitted = false
  }

  inspect(surface: ProbeSurface): boolean {
    if (!this.permitted) {
      this.recorded.push({ ...surface, observation: 'intercepted-denied' })
    }
    return this.permitted
  }

  recordBypass(surface: ProbeSurface): void {
    this.recorded.push({ ...surface, observation: 'bypassed' })
  }

  transcripts(): readonly ProbeTranscript[] {
    return this.recorded.map((transcript) => ({ ...transcript }))
  }
}

export class DisposableProbeServer {
  private readonly connections = new Set<Socket>()
  private readonly webSocketConnections = new Map<string, Set<Duplex>>()
  private readonly server: Server
  private readonly adapter: FiberProbeAdapter
  private readonly port: number
  private readonly rawRoutes: readonly ProbeRoute[]

  private constructor(
    server: Server,
    adapter: FiberProbeAdapter,
    port: number,
    rawRoutes: readonly ProbeRoute[],
  ) {
    this.server = server
    this.adapter = adapter
    this.port = port
    this.rawRoutes = rawRoutes
  }

  static async start(options: ProbeServerOptions): Promise<DisposableProbeServer> {
    let probe: DisposableProbeServer | undefined
    const server = createServer((request, response) => probe?.handleHttp(request, response))
    server.on('upgrade', (request, socket) => probe?.handleUpgrade(request, socket))

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen({ host: '127.0.0.1', port: 0 }, () => {
        server.off('error', reject)
        resolve()
      })
    })

    const address = server.address()
    if (address === null || typeof address === 'string') {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      throw new Error('probe server did not bind a TCP address')
    }

    probe = new DisposableProbeServer(server, options.adapter, address.port, options.rawRoutes ?? [])
    server.on('connection', (socket) => {
      probe?.connections.add(socket)
      socket.once('close', () => probe?.connections.delete(socket))
    })
    return probe
  }

  async request(method: string, path: string): Promise<ProbeHttpResponse> {
    return await new Promise<ProbeHttpResponse>((resolve, reject) => {
      const request = requestHttp({ host: '127.0.0.1', port: this.port, method, path }, (response) => {
        response.resume()
        response.once('end', () => resolve({ status: response.statusCode ?? 0 }))
      })
      request.once('error', reject)
      request.end()
    })
  }

  async upgrade(path: string): Promise<ProbeUpgradeResponse> {
    return await new Promise<ProbeUpgradeResponse>((resolve, reject) => {
      const socket = connect({ host: '127.0.0.1', port: this.port })
      const response: ProbeUpgradeResponse = { status: 0, frames: [] }
      let buffer = ''
      let resolved = false

      const complete = (): void => {
        if (!resolved) {
          resolved = true
          resolve(response)
        }
      }

      socket.once('connect', () => {
        socket.write(
          `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
        )
      })
      socket.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8')
        const separator = buffer.indexOf('\r\n\r\n')
        if (!resolved && separator !== -1) {
          const [statusLine] = buffer.slice(0, separator).split('\r\n')
          response.status = Number(statusLine.split(' ')[1])
          const remainder = buffer.slice(separator + 4)
          if (remainder.length > 0) {
            response.frames.push(...remainder.split('\n').filter(Boolean))
          }
          buffer = ''
          complete()
        } else if (resolved && buffer.length > 0) {
          response.frames.push(...buffer.split('\n').filter(Boolean))
          buffer = ''
        }
      })
      socket.once('error', (error) => {
        if (!resolved) {
          reject(error)
        }
      })
      socket.once('end', complete)
    })
  }

  emitIncrementalFrame(id: string, frame: string): void {
    for (const socket of this.webSocketConnections.get(id) ?? []) {
      if (this.adapter.inspect({ kind: 'websocket', id, mode: 'incremental' })) {
        socket.write(`${frame}\n`)
      }
    }
  }

  async close(): Promise<void> {
    for (const socket of this.connections) {
      socket.destroy()
    }
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
  }

  private handleHttp(request: IncomingMessage, response: ServerResponse): void {
    const method = request.method ?? 'GET'
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    const rawRoute = routeForHttp(this.rawRoutes, method, path)
    if (rawRoute !== undefined) {
      this.adapter.recordBypass({ kind: 'http', id: rawRoute.id })
      response.writeHead(200).end()
      return
    }

    const route = routeForHttp(REGISTERED_HTTP_ROUTES, method, path)
    if (route === undefined) {
      this.adapter.recordBypass({ kind: 'http', id: `${method} ${path}` })
      response.writeHead(200).end()
      return
    }

    if (!this.adapter.inspect({ kind: 'http', id: route.id })) {
      response.writeHead(403).end()
      return
    }
    response.writeHead(204).end()
  }

  private handleUpgrade(request: IncomingMessage, socket: Duplex): void {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    const rawRoute = routeForWebSocket(this.rawRoutes, path)
    if (rawRoute !== undefined) {
      this.adapter.recordBypass({ kind: 'websocket', id: rawRoute.id })
      socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
      return
    }

    const route = routeForWebSocket(REGISTERED_WEBSOCKET_ROUTES, path)
    if (route === undefined) {
      this.adapter.recordBypass({ kind: 'websocket', id: path })
      socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
      return
    }

    if (!this.adapter.inspect({ kind: 'websocket', id: route.id })) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }

    const sockets = this.webSocketConnections.get(route.id) ?? new Set<Duplex>()
    sockets.add(socket)
    this.webSocketConnections.set(route.id, sockets)
    socket.once('close', () => sockets.delete(socket))
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
  }
}
