/**
 * "Claude used him over MCP" — the today-use wrapper (spec_one_mind).
 * Listed tools note one coalesced use AFTER returning their result unchanged;
 * Kairos's own routine, dialogue, answer/accept/voice, board tools and
 * get_kairos_today never do. The token itself never leaves verifyToken —
 * only its kind and an 8-hex fingerprint.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const mocks = vi.hoisted(() => ({
  noteMcpUse: vi.fn(async (..._a: unknown[]) => {}),
  pending: [] as Array<() => unknown>,
}))

vi.mock('next/server', () => ({ after: (fn: () => unknown) => { mocks.pending.push(fn) } }))
vi.mock('@/lib/kairos/today', () => ({ noteMcpUse: mocks.noteMcpUse }))

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { installTodayUseTracking, TODAY_USE_TOOLS, tokenFingerprint, tokenKindOf } from '@/lib/kairos/today-mcp-use'

const SRC = path.resolve(__dirname, '../../..')
const TOOLS_DIR = path.join(SRC, 'app/api/[transport]/tools')
const MCP_ROUTE = path.join(SRC, 'app/api/[transport]/route.ts')

type Cb = (...a: unknown[]) => Promise<unknown>

function fakeServer() {
  const registered = new Map<string, Cb>()
  const server = {
    tool: (...args: unknown[]) => {
      registered.set(args[0] as string, args[args.length - 1] as Cb)
      return { name: args[0] }
    },
  }
  installTodayUseTracking(server as unknown as McpServer)
  return { server, registered }
}

const extra = { authInfo: { token: 'secret', clientId: 'u1', scopes: ['user'], extra: { userId: 'u1', role: 'user', tokenKind: 'oauth', fp: '0123abcd' } } }
const RESULT = { content: [{ type: 'text', text: '{"hits":3}' }] }

async function flushAfter() {
  const tasks = mocks.pending.splice(0)
  await Promise.all(tasks.map((t) => t()))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.pending.length = 0
})

describe('installTodayUseTracking', () => {
  it('a listed tool returns its result unchanged and notes the use after()', async () => {
    const { server, registered } = fakeServer()
    const handler = vi.fn(async () => RESULT)
    const ret = server.tool('search_memories', 'desc', {}, {}, handler)
    expect(ret).toEqual({ name: 'search_memories' })

    const result = await registered.get('search_memories')!({ query: 'gantt' }, extra)
    expect(result).toBe(RESULT)
    expect(handler).toHaveBeenCalledWith({ query: 'gantt' }, extra)
    expect(mocks.noteMcpUse).not.toHaveBeenCalled()

    await flushAfter()
    expect(mocks.noteMcpUse).toHaveBeenCalledWith('u1', 'search_memories', { query: 'gantt' }, { kind: 'oauth', fp: '0123abcd' })
  })

  it('handles argument-less tools (callback receives only extra)', async () => {
    const { server, registered } = fakeServer()
    server.tool('list_dominions', 'desc', async () => RESULT)
    await registered.get('list_dominions')!(extra)
    await flushAfter()
    expect(mocks.noteMcpUse).toHaveBeenCalledWith('u1', 'list_dominions', undefined, { kind: 'oauth', fp: '0123abcd' })
  })

  it.each(['claim_thinking_job', 'submit_thinking_job', 'answer_kairos_ask', 'accept_proposal', 'kairos_voice_note', 'append_dialogue_turn', 'create_task', 'get_kairos_today'])(
    'excluded tool %s is not wrapped',
    async (name) => {
      const { server, registered } = fakeServer()
      const handler = vi.fn(async () => RESULT)
      server.tool(name, 'desc', {}, handler)
      expect(registered.get(name)).toBe(handler)
      await registered.get(name)!({}, extra)
      await flushAfter()
      expect(mocks.noteMcpUse).not.toHaveBeenCalled()
    },
  )

  it('errors and failed results are not noted; a throw propagates untouched', async () => {
    const { server, registered } = fakeServer()
    server.tool('get_dominion', 'desc', {}, async () => ({ content: [], isError: true }))
    server.tool('get_constitution', 'desc', {}, async () => { throw new Error('boom') })
    await registered.get('get_dominion')!({}, extra)
    await expect(registered.get('get_constitution')!({}, extra)).rejects.toThrow('boom')
    await flushAfter()
    expect(mocks.noteMcpUse).not.toHaveBeenCalled()
  })

  it('without a token kind/fingerprint nothing is noted', async () => {
    const { server, registered } = fakeServer()
    server.tool('search_memories', 'desc', {}, async () => RESULT)
    await registered.get('search_memories')!({}, { authInfo: { extra: { userId: 'u1' } } })
    await flushAfter()
    expect(mocks.noteMcpUse).not.toHaveBeenCalled()
  })
})

describe('token identity', () => {
  it('derives the kind from the prefix and an 8-hex fingerprint', () => {
    expect(tokenKindOf('aeon_at_x')).toBe('oauth')
    expect(tokenKindOf('aeon_k1_x')).toBe('api_key')
    expect(tokenKindOf('aeon_s1_x')).toBe('mobile')
    expect(tokenKindOf('anything-else')).toBe('master')
    const fp = tokenFingerprint('aeon_at_secret')
    expect(fp).toMatch(/^[0-9a-f]{8}$/)
    expect(fp).not.toContain('secret')
  })

  it('route.ts installs tracking before any register call and never logs the token', () => {
    const src = readFileSync(MCP_ROUTE, 'utf8')
    const install = src.indexOf('installTodayUseTracking(server')
    const firstRegister = src.search(/register\w+Tools\(server\)/)
    expect(install).toBeGreaterThan(-1)
    expect(install).toBeLessThan(firstRegister)
    expect(src).toMatch(/tokenKind: tokenKindOf\(bearerToken\)/)
    expect(src).toMatch(/fp: tokenFingerprint\(bearerToken\)/)
    expect(src).not.toMatch(/console\.\w+\([^)]*bearerToken/)
  })
})

describe('TODAY_USE_TOOLS', () => {
  const registeredNames = readdirSync(TOOLS_DIR)
    .filter((f) => f.endsWith('.ts'))
    .flatMap((f) => [...readFileSync(path.join(TOOLS_DIR, f), 'utf8').matchAll(/server\.tool\(\s*['"]([a-z_]+)['"]/g)].map((m) => m[1]))

  it('names only real MCP tools', () => {
    for (const name of TODAY_USE_TOOLS) expect(registeredNames, name).toContain(name)
  })

  it('never lists the thinking routine, dialogue, answer/accept/voice or today itself', () => {
    const excluded = registeredNames.filter((n) => /thinking_job|dialogue/.test(n))
    for (const n of [...excluded, 'answer_kairos_ask', 'accept_proposal', 'kairos_voice_note', 'get_kairos_today']) {
      expect(TODAY_USE_TOOLS.has(n), n).toBe(false)
    }
  })
})
