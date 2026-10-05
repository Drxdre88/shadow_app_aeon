// @vitest-environment node
/**
 * The shipped MCP route, driven through its real POST handler: per-profile
 * tool lists, profile/transport refusals and the destructive-tool roster.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/api/auth', () => ({
  authenticateRequest: vi.fn(async () => ({ id: 'u1', role: 'user' })),
  isApiUser: (r: unknown) => !!r && typeof r === 'object' && 'id' in r,
}))

import { POST } from '../[transport]/route'

type Tool = { name: string; annotations?: { destructiveHint?: boolean } }

async function call(query: string, transport = 'mcp', body: Record<string, unknown> = { method: 'tools/list', params: {} }) {
  const req = new Request(`http://localhost/api/${transport}${query}`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer aeon_k1_test',
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...body }),
  })
  return POST(req, { params: Promise.resolve({ transport }) })
}

async function listTools(query = ''): Promise<Tool[]> {
  const res = await call(query)
  expect(res.status).toBe(200)
  const text = await res.text()
  const json = text.startsWith('{') ? text : text.split('\n').find((l) => l.startsWith('data:'))!.slice(5)
  return (JSON.parse(json) as { result: { tools: Tool[] } }).result.tools
}

const names = async (query: string) => new Set((await listTools(query)).map((t) => t.name))

const REALM = 'list_realms'
const TASK = ['list_tasks', 'get_task_detail', 'create_task']
const MEMORY = ['search_memories', 'create_memory']
const DOMINION = 'list_dominions'
const SESSION = 'list_sessions'
const HANGAR = 'list_hangar_repos'
const BOARD_ONLY = ['list_projects', 'list_gantt_tasks', 'list_labels']

const DESTRUCTIVE = [
  'cancel_realm_invite', 'delete_checklist_item', 'delete_column', 'delete_comment', 'delete_dominion',
  'delete_gantt_task', 'delete_gantt_view', 'delete_hangar_repo', 'delete_label', 'delete_project',
  'delete_realm', 'delete_row', 'delete_task', 'delete_virtual_member', 'kill_session',
  'remove_dependency', 'remove_dominion_repo', 'remove_label_from_task', 'remove_project_from_realm', 'remove_realm_member',
]

const PROFILE_SIZES = { all: 146, board: 72, vorath: 64, hangar: 39 } as const

describe('MCP route — profiles over the real handler', () => {
  it('all exposes every tool exactly once', async () => {
    const all = (await listTools('')).map((t) => t.name)
    expect(new Set(all).size).toBe(all.length)
    expect(all.length).toBe(PROFILE_SIZES.all)
  }, 30_000)

  it.each(['board', 'vorath', 'hangar'] as const)('%s lists its documented tool count', async (p) => {
    expect((await names(`?profile=${p}`)).size).toBe(PROFILE_SIZES[p])
  })

  it('board has realms and tasks, no Vorath or Hangar tools', async () => {
    const tools = await names('?profile=board')
    for (const t of [REALM, ...TASK, ...BOARD_ONLY]) expect(tools, t).toContain(t)
    for (const t of [...MEMORY, DOMINION, SESSION, HANGAR]) expect(tools.has(t), t).toBe(false)
  })

  it('vorath (and its kairos alias) has memories and Dominions, no board tools', async () => {
    const tools = await names('?profile=vorath')
    for (const t of [...MEMORY, DOMINION]) expect(tools, t).toContain(t)
    for (const t of [...BOARD_ONLY, ...TASK, SESSION, HANGAR]) expect(tools.has(t), t).toBe(false)
    expect(await names('?profile=kairos')).toEqual(tools)
  })

  it('hangar has what the dispatch contract tells runners to use', async () => {
    const tools = await names('?profile=hangar')
    for (const t of [SESSION, HANGAR, REALM, ...TASK, ...MEMORY]) expect(tools, t).toContain(t)
    for (const t of [...BOARD_ONLY, DOMINION]) expect(tools.has(t), t).toBe(false)
  })

  it('refuses an unknown profile with the valid list', async () => {
    const res = await call('?profile=nope')
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toContain('all, board, vorath, hangar')
  })

  it('404s any transport other than mcp', async () => {
    expect((await call('', 'sse')).status).toBe(404)
  })

  it('rejects a call without a bearer token', async () => {
    const res = await POST(new Request('http://localhost/api/mcp', { method: 'POST', body: '{}' }), {
      params: Promise.resolve({ transport: 'mcp' }),
    })
    expect(res.status).toBe(401)
  })

  it('marks exactly these tools destructive (each asks to confirm on capable clients)', async () => {
    const destructive = (await listTools('')).filter((t) => t.annotations?.destructiveHint === true).map((t) => t.name).sort()
    expect(destructive).toEqual(DESTRUCTIVE)
  })
})
