// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import { createMcpHandler, withMcpAuth } from 'mcp-handler'

vi.mock('@/lib/data/projects', () => ({ verifyProjectOwnership: vi.fn(async () => null) }))

import { ToolHost } from '../[transport]/tool-host'
import { ConfirmGate } from '../[transport]/confirm'
import { getUserId, ok, type RegisterFn } from '../[transport]/tools/types'

const OWNER = 'owner-1'
const ran = vi.fn()

const register: RegisterFn = (server) => {
  server.tool('open_tool', 'PM-core', async () => ok({ open: true }))
  server.tool('secret_tool', 'Vorath', { q: z.string() }, async ({ q }, extra) => {
    ran(q, getUserId(extra))
    return ok({ secret: q })
  })
}

function hostHandler(ownerTier: boolean) {
  const guard = { vorathTools: new Set(['secret_tool']), ownerTier }
  return withMcpAuth(
    createMcpHandler((mcp) => register(new ToolHost(mcp, new ConfirmGate(async () => null), guard)), {
      serverInfo: { name: 'aeon', version: 'test' },
    }),
    async (_req, token) => (token ? { token, clientId: token, scopes: ['user'], extra: { userId: token } } : undefined),
    { required: true }
  )
}

async function rpc(handler: (r: Request) => Promise<Response>, userId: string, body: Record<string, unknown>) {
  const res = await handler(
    new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${userId}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...body }),
    })
  )
  const text = await res.text()
  const json = text.startsWith('{') ? text : text.split('\n').find((l) => l.startsWith('data:'))!.slice(5)
  return JSON.parse(json) as { result: { tools?: { name: string }[]; isError?: boolean; content?: { text: string }[] } }
}

const callSecret = { method: 'tools/call', params: { name: 'secret_tool', arguments: { q: 'x' } } }

describe('ToolHost — Vorath guard', () => {
  beforeEach(() => {
    vi.stubEnv('VORATH_USER_IDS', OWNER)
    ran.mockClear()
  })
  afterEach(() => vi.unstubAllEnvs())

  it('refuses a registered Vorath tool to a non-owner at call time', async () => {
    const reply = await rpc(hostHandler(true), 'beta-user', callSecret)
    expect(reply.result.isError).toBe(true)
    expect(reply.result.content?.[0].text).toBe('Tool secret_tool not found')
    expect(ran).not.toHaveBeenCalled()
  })

  it('runs the same tool for the owner', async () => {
    const reply = await rpc(hostHandler(true), OWNER, callSecret)
    expect(reply.result.isError).toBeFalsy()
    expect(ran).toHaveBeenCalledWith('x', OWNER)
  })

  it('leaves non-Vorath tools callable by anyone', async () => {
    const reply = await rpc(hostHandler(true), 'beta-user', { method: 'tools/call', params: { name: 'open_tool', arguments: {} } })
    expect(reply.result.isError).toBeFalsy()
  })

  it('does not register Vorath tools on the core tier', async () => {
    const reply = await rpc(hostHandler(false), 'beta-user', { method: 'tools/list', params: {} })
    expect(reply.result.tools?.map((t) => t.name)).toEqual(['open_tool'])
  })
})
