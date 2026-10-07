import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KairosDecisionsState } from '@/lib/data/validators/kairos-decisions'

const h = vi.hoisted(() => ({
  stored: undefined as unknown,
  hasRow: false,
  calls: [] as string[],
}))

function findStateJson(node: unknown, seen = new Set<unknown>()): string | null {
  if (typeof node === 'string') return node.startsWith('{"v":1') ? node : null
  if (!node || typeof node !== 'object' || seen.has(node)) return null
  seen.add(node)
  for (const value of Object.values(node as Record<string, unknown>)) {
    const hit = findStateJson(value, seen)
    if (hit) return hit
  }
  return null
}

vi.mock('@/lib/db', () => {
  const rows = () => (h.hasRow ? [{ value: h.stored }] : [])
  const select = (via: string) => () => ({
    from: () => ({
      where: () => Object.assign(Promise.resolve(rows()), {
        for: (mode: string) => { h.calls.push(`${via}:select-for-${mode}`); return Promise.resolve(rows()) },
      }),
    }),
  })
  const tx = {
    select: select('tx'),
    update: () => ({
      set: (arg: { preferences: unknown }) => ({
        where: async () => {
          h.calls.push('tx:update')
          h.stored = JSON.parse(findStateJson(arg.preferences)!)
        },
      }),
    }),
    insert: () => ({
      values: (v: { preferences: Record<string, unknown> }) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            h.calls.push('tx:insert')
            h.stored = v.preferences.kairosDecisions
            h.hasRow = true
            return [{ userId: 'u1' }]
          },
        }),
      }),
    }),
  }
  return {
    db: {
      select: select('db'),
      transaction: async <R>(fn: (t: typeof tx) => Promise<R>) => { h.calls.push('db:transaction'); return fn(tx) },
    },
  }
})

import {
  confirmKairosDecisionByOwner,
  findOpenKairosDecisionBySeq,
  listKairosDecisions,
  logKairosDecision,
  readKairosDecisions,
  settleKairosDecisionByOwner,
  KairosDecisionsCorruptError,
} from '../kairos-decisions'

const USER = 'u1'
const NOW = new Date('2026-10-07T09:00:00.000Z')
const input = (decision: string, decisionType = 'hire') => ({ decision, expectation: 'it works out well', probability: 0.8, decisionType, checkBy: '2026-11-01' })
const owner = { kind: 'owner', via: 'app' } as const
const relayed = { kind: 'relayed', via: 'mcp' } as const

beforeEach(() => {
  h.stored = undefined
  h.hasRow = false
  h.calls = []
})

describe('kairos decisions single locked writer', () => {
  it('first log inserts the preferences row inside a FOR UPDATE transaction and numbers D1', async () => {
    const res = await logKairosDecision(USER, input('Hire a designer'), owner, NOW)
    expect(res).toMatchObject({ ok: true, decision: { number: 'D1', relayed: false, needsConfirm: false } })
    expect(h.calls).toEqual(['db:transaction', 'tx:select-for-update', 'tx:insert'])
    expect((h.stored as KairosDecisionsState).nextSeq).toBe(2)
  })

  it('later logs merge into the existing row and keep counting D2, D3', async () => {
    await logKairosDecision(USER, input('Hire a designer'), owner, NOW)
    h.calls = []
    const second = await logKairosDecision(USER, input('Back Hydra this quarter', 'project'), owner, NOW)
    const third = await logKairosDecision(USER, input('Drop the Visor pilot', 'priority'), relayed, NOW)
    expect(second).toMatchObject({ ok: true, decision: { number: 'D2' } })
    expect(third).toMatchObject({ ok: true, decision: { number: 'D3', relayed: true, needsConfirm: true } })
    expect(h.calls).toEqual(['db:transaction', 'tx:select-for-update', 'tx:update', 'db:transaction', 'tx:select-for-update', 'tx:update'])
    expect((await readKairosDecisions(USER)).open.map((d) => d.seq)).toEqual([1, 2, 3])
  })

  it('a refused step writes nothing', async () => {
    await logKairosDecision(USER, input('Hire a designer'), owner, NOW)
    h.calls = []
    const res = await logKairosDecision(USER, { ...input('Too late now'), checkBy: '2026-10-01' }, owner, NOW)
    expect(res).toEqual({ ok: false, reason: 'past_check_by' })
    expect(h.calls).toEqual(['db:transaction', 'tx:select-for-update'])
  })

  it('a malformed stored blob throws instead of being clobbered', async () => {
    h.hasRow = true
    h.stored = { v: 2 }
    await expect(logKairosDecision(USER, input('Hire a designer'), owner, NOW)).rejects.toBeInstanceOf(KairosDecisionsCorruptError)
    expect(h.calls).not.toContain('tx:update')
  })
})

describe('owner-only settle', () => {
  it('settles through the app or Telegram and refuses any other caller', async () => {
    const logged = await logKairosDecision(USER, input('Hire a designer'), owner, NOW)
    const id = logged.ok ? logged.decision.id : ''
    const agent = { via: 'mcp' } as unknown as { via: 'app' }
    expect(await settleKairosDecisionByOwner(USER, id, 'right', agent, NOW)).toEqual({ ok: false, reason: 'forbidden' })
    expect(await settleKairosDecisionByOwner(USER, id, 'right', { via: 'telegram' }, NOW)).toMatchObject({ ok: true, decision: { status: 'right' } })
    expect(await settleKairosDecisionByOwner(USER, id, 'wrong', { via: 'app' }, NOW)).toEqual({ ok: false, reason: 'already_settled' })
  })

  it('a relayed decision cannot settle until the owner confirms it', async () => {
    const logged = await logKairosDecision(USER, input('Hire a designer'), relayed, NOW)
    const id = logged.ok ? logged.decision.id : ''
    expect(await settleKairosDecisionByOwner(USER, id, 'right', { via: 'app' }, NOW)).toEqual({ ok: false, reason: 'unconfirmed' })
    expect(await confirmKairosDecisionByOwner(USER, id, NOW)).toMatchObject({ ok: true, decision: { needsConfirm: false, relayed: true } })
    expect(await settleKairosDecisionByOwner(USER, id, 'right', { via: 'app' }, NOW)).toMatchObject({ ok: true })
  })

  it('finds an open decision by its D-number', async () => {
    await logKairosDecision(USER, input('Hire a designer'), owner, NOW)
    expect((await findOpenKairosDecisionBySeq(USER, 1))?.decision).toBe('Hire a designer')
    expect(await findOpenKairosDecisionBySeq(USER, 9)).toBeNull()
  })
})

describe('listKairosDecisions', () => {
  it('lists due ones first and keeps unconfirmed relayed entries out of calibration', async () => {
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const r = await logKairosDecision(USER, input(`Hiring call number ${i}`), owner, NOW)
      if (r.ok) ids.push(r.decision.id)
    }
    await logKairosDecision(USER, { ...input('Due tomorrow call'), checkBy: '2026-10-07' }, owner, NOW)
    for (const id of ids) await settleKairosDecisionByOwner(USER, id, 'right', { via: 'app' }, NOW)

    const state = (await readKairosDecisions(USER))
    h.stored = {
      ...state,
      closed: [...state.closed, { ...state.closed[0]!, id: '0b6c3f7e-6a4e-4d43-9a4e-1f0c1c1c1c1c', seq: 99, status: 'wrong', origin: relayed }],
    }

    const list = await listKairosDecisions(USER, { scope: 'open' }, NOW)
    expect(list.decisions.map((d) => [d.number, d.due])).toEqual([['D4', true]])
    expect(list.calibration.settled).toBe(3)
    expect(list.calibration.byType).toEqual([expect.objectContaining({ decisionType: 'hire', n: 3, right: 3 })])
  })
})
