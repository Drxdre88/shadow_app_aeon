// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { createMcpHandler, withMcpAuth } from 'mcp-handler'

vi.mock('@/lib/data/projects', () => ({ verifyProjectOwnership: vi.fn(async () => ({ name: 'Aeon Board' })) }))

import { ToolHost, parseToolArgs } from '../[transport]/tool-host'
import { ConfirmGate } from '../[transport]/confirm'
import { getUserId, ok, type RegisterFn } from '../[transport]/tools/types'

const ran = vi.fn()

const register: RegisterFn = (server) => {
  server.tool('whoami', 'Echo the caller', async (extra) => ok({ uid: getUserId(extra) }))
  server.tool(
    'delete_task',
    'Delete a task',
    { projectId: z.string(), taskId: z.string().describe('Task id') },
    { title: 'Delete Task', destructiveHint: true },
    async ({ taskId }, extra) => {
      ran(taskId, getUserId(extra))
      return ok({ deleted: taskId })
    }
  )
  server.tool('rename_task', 'Rename', { taskId: z.string() }, { title: 'Rename', destructiveHint: false }, async () => ok({ renamed: true }))
}

const handler = withMcpAuth(
  createMcpHandler((mcp) => register(new ToolHost(mcp, new ConfirmGate(async () => 'Aeon Board'))), {
    serverInfo: { name: 'aeon', version: 'test' },
  }),
  async (_req, token) => (token ? { token, clientId: 'u1', scopes: ['user'], extra: { userId: 'u1' } } : undefined),
  { required: true }
)

const MODERN = '2026-07-28'

function envelope(caps: Record<string, unknown>) {
  return {
    'io.modelcontextprotocol/protocolVersion': MODERN,
    'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' },
    'io.modelcontextprotocol/clientCapabilities': caps,
  }
}

async function rpc(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const res = await handler(
    new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...body }),
    })
  )
  const text = await res.text()
  const json = text.startsWith('{') ? text : text.split('\n').find((l) => l.startsWith('data:'))!.slice(5)
  return { status: res.status, body: JSON.parse(json) as { result?: Record<string, unknown>; error?: { message: string } } }
}

function modernCall(name: string, args: Record<string, unknown>, caps: Record<string, unknown>, inputResponses?: Record<string, unknown>) {
  return rpc(
    { method: 'tools/call', params: { name, arguments: args, ...(inputResponses ? { inputResponses } : {}), _meta: envelope(caps) } },
    { 'mcp-protocol-version': MODERN, 'mcp-method': 'tools/call', 'mcp-name': name }
  )
}

function legacyCall(name: string, args: Record<string, unknown>) {
  return rpc({ method: 'tools/call', params: { name, arguments: args } }, { 'mcp-protocol-version': '2025-06-18' })
}

const textOf = (r: { body: { result?: Record<string, unknown> } }) =>
  ((r.body.result?.content as Array<{ text: string }>) ?? [])[0]?.text

describe('MCP connector — legacy (2025) clients keep today\'s behaviour', () => {
  it('answers initialize and lists tools with JSON schemas and annotations', async () => {
    const init = await rpc({ method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: { elicitation: {} }, clientInfo: { name: 'c', version: '1' } } })
    expect(init.body.result?.protocolVersion).toBe('2025-06-18')
    const list = await rpc({ method: 'tools/list', params: {} }, { 'mcp-protocol-version': '2025-06-18' })
    const tools = list.body.result?.tools as Array<{ name: string; inputSchema: { properties?: Record<string, { description?: string }> }; annotations?: { destructiveHint?: boolean } }>
    expect(tools.map((t) => t.name)).toEqual(['whoami', 'delete_task', 'rename_task'])
    const del = tools.find((t) => t.name === 'delete_task')!
    expect(del.annotations?.destructiveHint).toBe(true)
    expect(del.inputSchema.properties?.taskId.description).toBe('Task id')
  })

  it('runs a destructive tool without asking, with the bearer identity', async () => {
    ran.mockClear()
    const r = await legacyCall('delete_task', { projectId: 'p1', taskId: 't1' })
    expect(JSON.parse(textOf(r))).toEqual({ deleted: 't1' })
    expect(ran).toHaveBeenCalledWith('t1', 'u1')
  })

  it('passes the caller to shape-less tools', async () => {
    expect(JSON.parse(textOf(await legacyCall('whoami', {})))).toEqual({ uid: 'u1' })
  })

  it('rejects calls without a bearer token', async () => {
    const res = await handler(new Request('http://localhost/api/mcp', { method: 'POST', body: '{}' }))
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata=')
  })
})

describe('MCP connector — 2026-07-28 clients', () => {
  it('answers server/discover', async () => {
    const r = await rpc({ method: 'server/discover', params: { _meta: envelope({}) } }, { 'mcp-protocol-version': MODERN, 'mcp-method': 'server/discover' })
    expect(r.body.result?.supportedVersions).toContain(MODERN)
  })

  it('asks for confirmation before a destructive tool when the client can elicit', async () => {
    ran.mockClear()
    const r = await modernCall('delete_task', { projectId: 'p1', taskId: 't1' }, { elicitation: { form: {} } })
    expect(r.body.result?.resultType).toBe('input_required')
    const req = (r.body.result?.inputRequests as Record<string, { method: string; params: { message: string } }>).confirm
    expect(req.method).toBe('elicitation/create')
    expect(req.params.message).toBe('Delete Task on board "Aeon Board"? This can\'t be undone.')
    expect(ran).not.toHaveBeenCalled()
  })

  it('runs once the user accepts', async () => {
    ran.mockClear()
    const r = await modernCall('delete_task', { projectId: 'p1', taskId: 't1' }, { elicitation: {} }, { confirm: { action: 'accept', content: { confirm: true } } })
    expect(JSON.parse(textOf(r))).toEqual({ deleted: 't1' })
    expect(ran).toHaveBeenCalledOnce()
  })

  it.each([
    ['declines', { action: 'decline' }],
    ['cancels', { action: 'cancel' }],
    ['unticks the box', { action: 'accept', content: { confirm: false } }],
  ])('changes nothing when the user %s', async (_label, answer) => {
    ran.mockClear()
    const r = await modernCall('delete_task', { projectId: 'p1', taskId: 't1' }, { elicitation: { form: {} } }, { confirm: answer })
    expect(r.body.result?.isError).toBe(true)
    expect(textOf(r)).toMatch(/cancelled by the user/)
    expect(ran).not.toHaveBeenCalled()
  })

  it('runs directly when the client does not advertise form elicitation', async () => {
    for (const caps of [{}, { elicitation: { url: {} } }]) {
      ran.mockClear()
      const r = await modernCall('delete_task', { projectId: 'p1', taskId: 't1' }, caps)
      expect(JSON.parse(textOf(r))).toEqual({ deleted: 't1' })
      expect(ran).toHaveBeenCalledOnce()
    }
  })

  it('never gates non-destructive tools', async () => {
    const r = await modernCall('rename_task', { taskId: 't1' }, { elicitation: { form: {} } })
    expect(JSON.parse(textOf(r))).toEqual({ renamed: true })
  })
})

describe('ConfirmGate.message', () => {
  it('counts array targets and omits the board when none is given', async () => {
    const gate = new ConfirmGate(async () => null)
    expect(await gate.message('Delete Cards', { taskIds: ['a', 'b', 'c'] }, 'u1')).toBe("Delete Cards (3 items)? This can't be undone.")
  })

  it('survives a failing board lookup', async () => {
    const gate = new ConfirmGate(async () => { throw new Error('db down') })
    expect(await gate.message('Delete Column', { projectId: 'p' }, 'u1')).toBe("Delete Column? This can't be undone.")
  })
})

describe('parseToolArgs', () => {
  const cb = async () => ok(null)
  it('reads every v1 call shape', () => {
    const bare = parseToolArgs(['a', 'd', cb])
    expect([bare.name, bare.shape, bare.annotations]).toEqual(['a', undefined, undefined])
    expect(parseToolArgs(['a', 'd', {}, cb]).shape).toEqual({})
    expect(parseToolArgs(['a', 'd', { x: z.string() }, cb]).shape).toHaveProperty('x')
    expect(parseToolArgs(['a', 'd', { title: 'T' }, cb]).annotations).toEqual({ title: 'T' })
    expect(parseToolArgs(['a', 'd', { x: z.string() }, { title: 'T' }, cb]).annotations).toEqual({ title: 'T' })
  })

  it('rejects a registration without a callback', () => {
    expect(() => parseToolArgs(['a', 'd', {}])).toThrow(/missing its callback/)
  })
})
