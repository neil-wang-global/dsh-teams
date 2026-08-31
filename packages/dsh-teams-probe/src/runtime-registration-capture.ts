// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

export type RuntimeRegistrationCarrier =
  | 'webServer.register'
  | 'webServer.registerUpgrade'
  | 'connection.rpc.handle'
  | 'connection.rpc.intercept'

export interface RuntimeRegistration {
  carrier: RuntimeRegistrationCarrier
  kind: 'http' | 'websocket' | 'rpc'
  id: string
}

export interface RuntimeRegistrationInventory {
  version: 1
  registrations: RuntimeRegistration[]
}

const REQUIRED_CORE_REGISTRATIONS: readonly RuntimeRegistration[] = [
  { carrier: 'webServer.register', kind: 'http', id: 'prefix /api' },
  { carrier: 'webServer.registerUpgrade', kind: 'websocket', id: '/api/events.mux' },
  { carrier: 'webServer.registerUpgrade', kind: 'websocket', id: '/api/events.host' },
  { carrier: 'connection.rpc.intercept', kind: 'rpc', id: '/api' },
]

const CARRIER_KINDS: Record<RuntimeRegistrationCarrier, RuntimeRegistration['kind']> = {
  'webServer.register': 'http',
  'webServer.registerUpgrade': 'websocket',
  'connection.rpc.handle': 'rpc',
  'connection.rpc.intercept': 'rpc',
}

const OBSERVER_DEPENDENTS = [
  'typert-gateway',
  'client-hmr',
  'modules',
  'connection',
  'dsh-pocket',
  'dsh-deeptutor',
  'web-ui-plugin-manager',
  'web-ui-dsh-aionui-panel',
  'web-ui-task-board',
  'web-ui-git-graph',
  'web-ui-remote-web-ui',
  'web-ui-pet',
  'web-ui-ssh',
  'web-ui-skill-explorer',
  'web-ui-desktop-launcher',
  'web-ui-doctor',
  'web-ui-skin-center',
  'web-ui-better-sidebar',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function runtimeRegistration(value: unknown): RuntimeRegistration {
  if (!isRecord(value)
    || typeof value.carrier !== 'string'
    || !(value.carrier in CARRIER_KINDS)
    || typeof value.kind !== 'string'
    || typeof value.id !== 'string'
    || value.id.length === 0
  ) {
    throw new Error('invalid runtime registration record')
  }

  const carrier = value.carrier as RuntimeRegistrationCarrier
  if (value.kind !== CARRIER_KINDS[carrier]) {
    throw new Error('invalid runtime registration record')
  }
  return { carrier, kind: CARRIER_KINDS[carrier], id: value.id }
}

export function normalizeRuntimeRegistrationInventory(
  records: readonly unknown[],
): RuntimeRegistrationInventory {
  const registrations = new Map<string, RuntimeRegistration>()
  for (const value of records) {
    const record = runtimeRegistration(value)
    registrations.set(`${record.carrier}\u0000${record.id}`, record)
  }

  return {
    version: 1,
    registrations: [...registrations.values()].sort((left, right) => {
      const leftKey = `${left.carrier}\u0000${left.id}`
      const rightKey = `${right.carrier}\u0000${right.id}`
      return leftKey.localeCompare(rightKey, 'en')
    }),
  }
}

export function assertCoreRuntimeRegistrations(inventory: RuntimeRegistrationInventory): void {
  const observed = new Set(inventory.registrations.map(
    (registration) => `${registration.carrier}\u0000${registration.id}`,
  ))
  for (const registration of REQUIRED_CORE_REGISTRATIONS) {
    const key = `${registration.carrier}\u0000${registration.id}`
    if (!observed.has(key)) {
      throw new Error(`missing core runtime registration: ${registration.carrier} ${registration.id}`)
    }
  }
}

function yamlScalar(value: string): string {
  return JSON.stringify(value)
}

export function createRuntimeObserverPatch(pluginPath: string, outputPath: string): string {
  const dependentPatches = OBSERVER_DEPENDENTS.map((id) => {
    if (id === 'connection') {
      return `- id: ${id}\n  inject: [webRuntime, dshTeamsRegistrationObserver]`
    }
    return `- id: ${id}\n  inject: [dshTeamsRegistrationObserver]`
  }).join('\n')

  return [
    '- insert:',
    '    - id: dsh-teams-registration-observer',
    `      name: ${yamlScalar(new URL(`file://${pluginPath}`).href)}`,
    '      inject: [webServer]',
    '      config:',
    `        outputPath: ${yamlScalar(outputPath)}`,
    dependentPatches,
    '',
  ].join('\n')
}

export function createRuntimeObserverPluginSource(outputPath: string): string {
  return `import { appendFileSync } from 'node:fs'

export const name = 'dsh-teams-registration-observer'
export const inject = ['webServer']

function capture(outputPath, carrier, kind, id) {
  appendFileSync(outputPath, JSON.stringify({ carrier, kind, id }) + '\\n', 'utf8')
}

function routeId(route) {
  return String(route?.kind ?? 'unknown') + ' ' + String(route?.path ?? 'unknown')
}

function replace(target, method, callback) {
  const original = target[method]
  if (typeof original !== 'function') throw new Error('runtime registration method missing: ' + method)
  target[method] = function (...args) {
    callback(args)
    return Reflect.apply(original, this, args)
  }
  return () => { target[method] = original }
}

export function apply(ctx, config) {
  const outputPath = String(config?.outputPath ?? ${JSON.stringify(outputPath)})
  const restores = [
    replace(ctx.webServer, 'register', (args) => capture(outputPath, 'webServer.register', 'http', routeId(args[0]))),
    replace(ctx.webServer, 'registerUpgrade', (args) => capture(outputPath, 'webServer.registerUpgrade', 'websocket', String(args[0]?.path ?? 'unknown'))),
  ]
  ctx.provide('dshTeamsRegistrationObserver', {})
  ctx.inject(['connection'], (connectionCtx) => {
    const connection = connectionCtx.connection
    restores.push(
      replace(connection, 'register', (args) => capture(outputPath, 'connection.rpc.handle', 'rpc', String(args[1] ?? 'unknown'))),
      replace(connection, 'registerInterceptor', (args) => capture(outputPath, 'connection.rpc.intercept', 'rpc', String(args[1] ?? 'unknown'))),
    )
  })
  ctx.effect(() => () => restores.splice(0).reverse().forEach((restore) => restore()))
}
`
}
