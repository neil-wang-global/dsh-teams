// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'

type WorkspaceId = 'alpha' | 'bravo'
type Control =
  | 'cross-workspace-file-read'
  | 'cross-workspace-credential-read'
  | 'unapproved-host-tool'
  | 'subagent-fork-inheritance'
  | 'custom-remote-creation'

type SessionId = string

interface ExecutionFixture {
  readonly credentials: ReadonlyMap<WorkspaceId, ReadonlyMap<string, string>>
  readonly roots: ReadonlyMap<WorkspaceId, string>
}

interface ExecutionCandidate {
  readonly kind: 'in-process' | 'isolated-worker'
  openSession(workspace: WorkspaceId): SessionId
  readFile(session: SessionId, workspace: WorkspaceId, path: string): Promise<string>
  readCredential(session: SessionId, name: string): string
  useHostTool(session: SessionId, name: string): void
  fork(session: SessionId): SessionId
  createCustomRemote(session: SessionId, name: string): string
}

export interface ExecutionIsolationReport {
  readonly blocked: Control[]
  readonly candidate: ExecutionCandidate['kind']
  readonly decision: 'blocked' | 'isolated-worker'
  readonly violations: Control[]
}

class ExecutionBoundaryError extends Error {
}

const CONTROLS: readonly Control[] = [
  'cross-workspace-file-read',
  'cross-workspace-credential-read',
  'unapproved-host-tool',
  'subagent-fork-inheritance',
  'custom-remote-creation',
]

function workspaceForSession(sessions: ReadonlyMap<SessionId, WorkspaceId>, session: SessionId): WorkspaceId {
  const workspace = sessions.get(session)
  if (workspace === undefined) {
    throw new Error(`unknown execution session: ${session}`)
  }
  return workspace
}

function createSessionRegistry(): {
  fork(session: SessionId): SessionId
  open(workspace: WorkspaceId): SessionId
  workspace(session: SessionId): WorkspaceId
} {
  const sessions = new Map<SessionId, WorkspaceId>()
  let next = 1

  const open = (workspace: WorkspaceId): SessionId => {
    const session = `session-${next++}`
    sessions.set(session, workspace)
    return session
  }

  return {
    open,
    fork(session) {
      return open(workspaceForSession(sessions, session))
    },
    workspace(session) {
      return workspaceForSession(sessions, session)
    },
  }
}

function isWithinRoot(root: string, target: string): boolean {
  const path = relative(root, target)
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

async function createFixture(root: string): Promise<ExecutionFixture> {
  const roots = new Map<WorkspaceId, string>()
  for (const workspace of ['alpha', 'bravo'] as const) {
    const workspaceRoot = join(root, workspace)
    await mkdir(workspaceRoot, { recursive: true })
    await writeFile(join(workspaceRoot, 'private.txt'), `${workspace}-private`, 'utf8')
    roots.set(workspace, await realpath(workspaceRoot))
  }

  return {
    credentials: new Map([
      ['alpha', new Map([['ALPHA_API_KEY', 'alpha-credential']])],
      ['bravo', new Map([['BRAVO_API_KEY', 'bravo-credential']])],
    ]),
    roots,
  }
}

export async function createInProcessExecutionPreset(root: string): Promise<ExecutionCandidate> {
  const fixture = await createFixture(root)
  const sessions = createSessionRegistry()
  const credentials = new Map<string, string>()
  for (const workspaceCredentials of fixture.credentials.values()) {
    for (const [name, value] of workspaceCredentials) {
      credentials.set(name, value)
    }
  }

  return {
    kind: 'in-process',
    openSession: sessions.open,
    async readFile(_session, workspace, path) {
      const workspaceRoot = fixture.roots.get(workspace)
      if (workspaceRoot === undefined) {
        throw new Error(`unknown workspace: ${workspace}`)
      }
      return await readFile(join(workspaceRoot, path), 'utf8')
    },
    readCredential(_session, name) {
      const credential = credentials.get(name)
      if (credential === undefined) {
        throw new Error(`unknown credential: ${name}`)
      }
      return credential
    },
    useHostTool(_session, _name) {
    },
    fork: sessions.fork,
    createCustomRemote(_session, name) {
      return `remote:${name}`
    },
  }
}

export async function createWorkspaceWorkerFixture(root: string): Promise<ExecutionCandidate> {
  const fixture = await createFixture(root)
  const sessions = createSessionRegistry()

  const assertWorkspace = (session: SessionId, workspace: WorkspaceId): void => {
    if (sessions.workspace(session) !== workspace) {
      throw new ExecutionBoundaryError(`worker session cannot access workspace: ${workspace}`)
    }
  }

  return {
    kind: 'isolated-worker',
    openSession: sessions.open,
    async readFile(session, workspace, path) {
      assertWorkspace(session, workspace)
      const workspaceRoot = fixture.roots.get(workspace)
      if (workspaceRoot === undefined) {
        throw new Error(`unknown workspace: ${workspace}`)
      }
      const target = await realpath(join(workspaceRoot, path))
      if (!isWithinRoot(workspaceRoot, target)) {
        throw new ExecutionBoundaryError(`worker session cannot access file path: ${path}`)
      }
      return await readFile(target, 'utf8')
    },
    readCredential(session, name) {
      const credential = fixture.credentials.get(sessions.workspace(session))?.get(name)
      if (credential === undefined) {
        throw new ExecutionBoundaryError(`worker session cannot read credential: ${name}`)
      }
      return credential
    },
    useHostTool(session, name) {
      sessions.workspace(session)
      if (name !== 'workspace.read') {
        throw new ExecutionBoundaryError(`worker session cannot use Host tool: ${name}`)
      }
    },
    fork: sessions.fork,
    createCustomRemote(session, name) {
      sessions.workspace(session)
      throw new ExecutionBoundaryError(`worker session cannot create custom Remote: ${name}`)
    },
  }
}

async function observe(control: Control, operation: () => void | Promise<void>): Promise<{ control: Control; result: 'blocked' | 'violated' }> {
  try {
    await operation()
    return { control, result: 'violated' }
  } catch (error) {
    if (error instanceof ExecutionBoundaryError) {
      return { control, result: 'blocked' }
    }
    throw error
  }
}

export async function runExecutionIsolationProbe(candidate: ExecutionCandidate): Promise<ExecutionIsolationReport> {
  const alpha = candidate.openSession('alpha')
  const results = [
    await observe('cross-workspace-file-read', async () => {
      const content = await candidate.readFile(alpha, 'bravo', 'private.txt')
      if (content !== 'bravo-private') {
        throw new Error(`unexpected cross-workspace file content: ${content}`)
      }
    }),
    await observe('cross-workspace-credential-read', () => {
      if (candidate.readCredential(alpha, 'BRAVO_API_KEY') !== 'bravo-credential') {
        throw new Error('unexpected cross-workspace credential value')
      }
    }),
    await observe('unapproved-host-tool', () => candidate.useHostTool(alpha, 'host.process')),
    await observe('subagent-fork-inheritance', async () => {
      const child = candidate.fork(alpha)
      const content = await candidate.readFile(child, 'bravo', 'private.txt')
      if (content !== 'bravo-private') {
        throw new Error(`unexpected inherited cross-workspace file content: ${content}`)
      }
    }),
    await observe('custom-remote-creation', () => {
      if (candidate.createCustomRemote(alpha, 'unapproved-remote') !== 'remote:unapproved-remote') {
        throw new Error('unexpected custom Remote identifier')
      }
    }),
  ]

  const blocked = results.filter((result) => result.result === 'blocked').map((result) => result.control)
  const violations = results.filter((result) => result.result === 'violated').map((result) => result.control)

  return {
    blocked,
    candidate: candidate.kind,
    decision: candidate.kind === 'isolated-worker' && violations.length === 0
      ? 'isolated-worker'
      : 'blocked',
    violations,
  }
}

export { CONTROLS }
