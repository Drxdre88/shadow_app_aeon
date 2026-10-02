import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// Each db.select() call returns a chain that resolves to the next queued
// result; the where clause is kept so the filters can be rendered and checked.
const { calls, results } = vi.hoisted(() => ({
  calls: [] as Array<{ table: unknown; where: unknown; groupBy: boolean }>,
  results: [] as unknown[][],
}))
vi.mock('@/lib/db', () => ({
  db: {
    select: () => {
      const call = { table: null as unknown, where: null as unknown, groupBy: false }
      calls.push(call)
      const result = results.shift() ?? []
      const chain = {
        from(table: unknown) { call.table = table; return chain },
        where(where: unknown) { call.where = where; return chain },
        groupBy() { call.groupBy = true; return chain },
        then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
          return Promise.resolve(result).then(resolve, reject)
        },
      }
      return chain
    },
  },
}))

import { getSetupSignals } from '../brain-status'

const dialect = new PgDialect()
const render = (where: unknown) => dialect.sqlToQuery(where as SQL)
const NOW = new Date('2026-10-02T08:30:00.000Z')
const ENV = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_OPERATOR_CHAT_ID'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  calls.length = 0
  results.length = 0
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k] }
})
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

function queue(connector: Date | null, sessions: Array<{ tool: string; at: Date | null }>, voice: Date | null, watched: number) {
  results.push([{ at: connector }], sessions, [{ at: voice }], [{ n: watched }])
}

describe('getSetupSignals', () => {
  it('maps the four queries into the checklist contract', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 't'
    process.env.TELEGRAM_OPERATOR_CHAT_ID = '1'
    queue(
      new Date('2026-10-01T09:00:00Z'),
      [
        { tool: 'claude', at: new Date('2026-10-02T07:00:00Z') },
        { tool: 'copilot', at: new Date('2026-09-20T07:00:00Z') },
        { tool: 'hook', at: new Date('2026-10-02T08:00:00Z') }, // unknown tool is ignored
      ],
      new Date('2026-09-30T21:00:00Z'),
      2,
    )
    const out = await getSetupSignals('user-1', { isOperator: true, now: NOW })
    expect(out).toEqual({
      connectorUsedAt: '2026-10-01T09:00:00.000Z',
      sessions: { claude: '2026-10-02T07:00:00.000Z', codex: null, copilot: '2026-09-20T07:00:00.000Z' },
      voiceNoteAt: '2026-09-30T21:00:00.000Z',
      watchedBoards: 2,
      telegramConfigured: true,
    })
  })

  it('empty account: nothing ticked', async () => {
    queue(null, [], null, 0)
    expect(await getSetupSignals('user-1', { now: NOW })).toEqual({
      connectorUsedAt: null,
      sessions: { claude: null, codex: null, copilot: null },
      voiceNoteAt: null,
      watchedBoards: 0,
      telegramConfigured: false,
    })
  })

  it('Telegram is only ticked for the operator', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 't'
    process.env.TELEGRAM_OPERATOR_CHAT_ID = '1'
    queue(null, [], null, 0)
    expect((await getSetupSignals('user-1', { isOperator: false, now: NOW })).telegramConfigured).toBe(false)
  })

  it('scopes every query to the user with the right filters and windows', async () => {
    queue(null, [], null, 0)
    await getSetupSignals('user-1', { now: NOW })
    expect(calls).toHaveLength(4)
    const [connector, sessions, voice, watched] = calls.map((c) => render(c.where))

    expect(connector.sql).toMatch(/"oauth_access_tokens"\."user_id" = \$1/)
    expect(connector.sql).toMatch(/"revoked_at" is null/)
    expect(connector.sql).toMatch(/"last_used_at" >= \$2/)
    expect(connector.params[0]).toBe('user-1')
    expect(connector.params[1]).toBe(new Date(NOW.getTime() - 7 * 86_400_000).toISOString())

    expect(calls[1]!.groupBy).toBe(true)
    expect(sessions.sql).toMatch(/"memories"\."type" = \$2/)
    expect(sessions.params).toContain('session_summary')
    expect(sessions.sql).toMatch(/'hook'/)
    expect(sessions.params).toContain(new Date(NOW.getTime() - 90 * 86_400_000).toISOString())

    expect(voice.params).toContain('inbound')
    expect(voice.sql).toMatch(/->'voiceNote' IS NOT NULL/)

    expect(watched.sql).toMatch(/->>'kairosFeed'\)\) in \('daily', 'weekly'\)/)
    for (const q of [connector, sessions, voice, watched]) expect(q.params[0]).toBe('user-1')
  })
})
