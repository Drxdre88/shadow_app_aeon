import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// undo_kairos_change (docs/kairos/34 §6): the ONE mutating chat tool. Finds
// the newest non-reverted ENGINE promote/decay/merge by memory title, lists
// ≤ 3 on a tie and does nothing; confirm:false mints a confirmToken bound to
// the op, and only confirm:true + that token (from a later turn) reverts via
// revertMemoryOp with an operator-veto reason.

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/memories', () => ({ listRecentMemories: vi.fn() }))
vi.mock('@/lib/data/projects', () => ({ findProjects: vi.fn() }))
vi.mock('@/lib/data/sessions', () => ({ listAgentSessions: vi.fn() }))
vi.mock('@/lib/data/recipes', () => ({ listTraceHistory: vi.fn() }))
vi.mock('@/lib/kairos/chat-board-context', () => ({ fetchLiveBoardContext: vi.fn(), renderLiveBoardSection: vi.fn() }))
vi.mock('@/lib/kairos/chat-recency-context', () => ({ fetchRecentActivityContext: vi.fn() }))
vi.mock('@/lib/kairos/retrieve', () => ({ searchSubstrateForChat: vi.fn() }))
vi.mock('@/lib/data/memory-ops', () => ({ listMemoryOps: vi.fn() }))
vi.mock('@/lib/data/memory-rescore', () => ({ loadMemoryTitles: vi.fn() }))
vi.mock('@/lib/kairos/engine/revert', () => ({ revertMemoryOp: vi.fn() }))

import { listMemoryOps, type MemoryOpRow } from '@/lib/data/memory-ops'
import { loadMemoryTitles } from '@/lib/data/memory-rescore'
import { revertMemoryOp } from '@/lib/kairos/engine/revert'
import { buildChatTools, matchUndoCandidate, undoKairosChangeInputSchema, type UndoCandidate } from '../chat-tools'

const USER = 'user-1'

function op(
  id: string,
  kind: string,
  memoryId: string,
  minutesAgo: number,
  over: Partial<MemoryOpRow> = {},
): MemoryOpRow {
  return {
    id,
    userId: USER,
    runId: 'run-1',
    memoryId,
    step: kind === 'merge' ? 'merge' : 'backup',
    op: kind,
    before: { streamClass: 'memory' },
    after: {},
    ...over,
    reason: `${kind} reason`,
    revertedAt: null,
    revertedByOpId: null,
    createdAt: new Date(Date.UTC(2026, 8, 30, 12, 0) - minutesAgo * 60_000),
  }
}

function seed(ops: MemoryOpRow[], titles: Record<string, string>) {
  vi.mocked(listMemoryOps).mockResolvedValue(ops)
  vi.mocked(loadMemoryTitles).mockResolvedValue(new Map(Object.entries(titles)))
}

type UndoInput = { title: string; confirm: boolean; confirmToken?: string }

// A fresh buildChatTools per call = a fresh chat turn.
const undo = (input: UndoInput) =>
  buildChatTools(USER).undo_kairos_change!.execute(input).then((s) => JSON.parse(s))

// confirm:false in one turn → the token the operator then confirms with.
async function lookupToken(title: string): Promise<string> {
  const res = await undo({ title, confirm: false })
  expect(res.status).toBe('confirm_needed')
  return res.confirmToken as string
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('AUTH_SECRET', 'test-secret')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('undo_kairos_change', () => {
  it('is described as operator-explicit only and validates its input', () => {
    const tool = buildChatTools(USER).undo_kairos_change!
    expect(tool.description).toMatch(/ONLY when the operator explicitly asks to undo/)
    expect(undoKairosChangeInputSchema.safeParse({ title: 'x' }).success).toBe(false)
    expect(undoKairosChangeInputSchema.safeParse({ title: 'deep work', confirm: false }).success).toBe(true)
  })

  it('first call (confirm:false) returns the match + a token and changes nothing', async () => {
    seed([op('op-1', 'promote', 'm-1', 5), op('op-2', 'decay', 'm-2', 10)], {
      'm-1': 'Deep work happens before noon',
      'm-2': 'Standups are useless',
    })

    const res = await undo({ title: 'deep work', confirm: false })

    expect(listMemoryOps).toHaveBeenCalledWith(USER, expect.objectContaining({
      ops: ['promote', 'decay', 'merge'],
      steps: ['backup', 'merge'],
    }))
    expect(res).toMatchObject({ status: 'confirm_needed', match: { title: 'Deep work happens before noon', change: 'promoted' } })
    expect(typeof res.confirmToken).toBe('string')
    expect(revertMemoryOp).not.toHaveBeenCalled()
  })

  it('confirm:true with the token reverts exactly that op as an operator veto', async () => {
    seed([op('op-1', 'promote', 'm-1', 5)], { 'm-1': 'Deep work happens before noon' })
    vi.mocked(revertMemoryOp).mockResolvedValue({ ok: true, opId: 'op-1', revertOpId: 'rv-1', restoredMemoryIds: ['m-1'] })
    const confirmToken = await lookupToken('DEEP WORK')

    const res = await undo({ title: 'DEEP WORK', confirm: true, confirmToken })

    expect(revertMemoryOp).toHaveBeenCalledWith(USER, 'op-1', { reason: 'operator veto (chat)' })
    expect(res.status).toBe('undone')
    expect(res.message).toContain('Deep work happens before noon')
  })

  it('refuses confirm:true without a token', async () => {
    seed([op('op-1', 'promote', 'm-1', 5)], { 'm-1': 'Deep work happens before noon' })
    const res = await undo({ title: 'deep work happens before noon', confirm: true })
    expect(res).toMatchObject({ status: 'refused', reason: 'confirm_token_required' })
    expect(revertMemoryOp).not.toHaveBeenCalled()
  })

  it('a lookup then confirm in the same turn (after the operator said yes) reverts the looked-up op', async () => {
    seed([op('op-1', 'promote', 'm-1', 5)], { 'm-1': 'Deep work happens before noon' })
    vi.mocked(revertMemoryOp).mockResolvedValue({ ok: true, opId: 'op-1', revertOpId: 'rv-1', restoredMemoryIds: ['m-1'] })
    const tool = buildChatTools(USER).undo_kairos_change!
    const first = JSON.parse(await tool.execute({ title: 'deep work', confirm: false }))
    const res = JSON.parse(await tool.execute({ title: 'deep work', confirm: true, confirmToken: first.confirmToken }))
    expect(res.status).toBe('undone')
    expect(revertMemoryOp).toHaveBeenCalledWith(USER, 'op-1', { reason: 'operator veto (chat)' })
  })

  it('binds the token to its op: a tampered opId, another user or a wrong secret is refused', async () => {
    seed([op('op-1', 'promote', 'm-1', 5), op('op-2', 'decay', 'm-2', 6)], {
      'm-1': 'Deep work happens before noon',
      'm-2': 'Standups are useless',
    })
    const token = await lookupToken('deep work')
    const [, exp, mac] = token.split('.')

    // Same title, but the token is swapped onto op-2.
    const swapped = await undo({ title: 'deep work', confirm: true, confirmToken: `op-2.${exp}.${mac}` })
    expect(swapped).toMatchObject({ status: 'refused', reason: 'invalid_or_expired_token' })

    const otherUser = JSON.parse(await buildChatTools('user-2').undo_kairos_change!.execute({ title: 'deep work', confirm: true, confirmToken: token }))
    expect(otherUser).toMatchObject({ status: 'refused', reason: 'invalid_or_expired_token' })

    vi.stubEnv('AUTH_SECRET', 'other-secret')
    const rotated = await undo({ title: 'deep work', confirm: true, confirmToken: token })
    expect(rotated).toMatchObject({ status: 'refused', reason: 'invalid_or_expired_token' })
    expect(revertMemoryOp).not.toHaveBeenCalled()
  })

  it('reverts the token\'s op even if the confirm:true title now matches another change', async () => {
    seed([op('op-1', 'promote', 'm-1', 5), op('op-2', 'decay', 'm-2', 6)], {
      'm-1': 'Deep work happens before noon',
      'm-2': 'Standups are useless',
    })
    vi.mocked(revertMemoryOp).mockResolvedValue({ ok: true, opId: 'op-1', revertOpId: 'rv-1', restoredMemoryIds: ['m-1'] })
    const confirmToken = await lookupToken('deep work')

    await undo({ title: 'standups are useless', confirm: true, confirmToken })

    expect(revertMemoryOp).toHaveBeenCalledTimes(1)
    expect(revertMemoryOp).toHaveBeenCalledWith(USER, 'op-1', expect.anything())
  })

  it('refuses an expired token (10-minute window)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-30T12:00:00Z'))
    seed([op('op-1', 'promote', 'm-1', 5)], { 'm-1': 'Deep work happens before noon' })
    const confirmToken = await lookupToken('deep work')

    vi.setSystemTime(new Date('2026-09-30T12:10:01Z'))
    const res = await undo({ title: 'deep work', confirm: true, confirmToken })

    expect(res).toMatchObject({ status: 'refused', reason: 'invalid_or_expired_token' })
    expect(revertMemoryOp).not.toHaveBeenCalled()
  })

  it('refuses when the token\'s op is no longer an undoable candidate', async () => {
    seed([op('op-1', 'promote', 'm-1', 5)], { 'm-1': 'Deep work happens before noon' })
    const confirmToken = await lookupToken('deep work')
    seed([], {})

    const res = await undo({ title: 'deep work', confirm: true, confirmToken })

    expect(res.status).toBe('not_found')
    expect(revertMemoryOp).not.toHaveBeenCalled()
  })

  it('does not mint a token when no server secret is configured', async () => {
    vi.stubEnv('AUTH_SECRET', '')
    vi.stubEnv('NEXTAUTH_SECRET', '')
    seed([op('op-1', 'promote', 'm-1', 5)], { 'm-1': 'Deep work happens before noon' })
    const res = await undo({ title: 'deep work', confirm: false })
    expect(res.status).toBe('unavailable')
    expect(res.confirmToken).toBeUndefined()
  })

  it('picks the engine op when an own-mind mirror op (before null) shares the title', async () => {
    seed(
      [
        op('mirror-1', 'promote', 'm-1', 1, { step: 'beliefs', before: null }),
        op('engine-1', 'promote', 'm-1', 5),
      ],
      { 'm-1': 'Deep work happens before noon' },
    )

    const res = await undo({ title: 'deep work', confirm: false })

    expect(res.status).toBe('confirm_needed')
    expect((res.confirmToken as string).startsWith('engine-1.')).toBe(true)
  })

  it('ignores constitution ops (step constitution) even with a matching title', async () => {
    seed(
      [op('const-1', 'promote', 'c-1', 1, { step: 'constitution' })],
      { 'c-1': 'Constitution v2' },
    )
    const res = await undo({ title: 'constitution v2', confirm: false })
    expect(res.status).toBe('not_found')
  })

  it('ambiguous titles list at most 3 candidates and mint no token', async () => {
    seed(
      [op('o1', 'promote', 'a', 1), op('o2', 'decay', 'b', 2), op('o3', 'merge', 'c', 3), op('o4', 'promote', 'd', 4)],
      { a: 'Shipping notes on Fridays', b: 'Shipping notes weekly', c: 'Shipping notes archive', d: 'Shipping notes v2' },
    )

    const res = await undo({ title: 'shipping notes', confirm: false })

    expect(res.status).toBe('ambiguous')
    expect(res.candidates).toHaveLength(3)
    expect(res.confirmToken).toBeUndefined()
    expect(revertMemoryOp).not.toHaveBeenCalled()
  })

  it('reports not_found when nothing matches', async () => {
    seed([op('op-1', 'promote', 'm-1', 5)], { 'm-1': 'Deep work happens before noon' })
    const res = await undo({ title: 'gardening plans', confirm: false })
    expect(res.status).toBe('not_found')
    expect(revertMemoryOp).not.toHaveBeenCalled()
  })

  it('surfaces a refused revert without claiming success', async () => {
    seed([op('op-1', 'decay', 'm-1', 5)], { 'm-1': 'Standups are useless' })
    vi.mocked(revertMemoryOp).mockResolvedValue({ ok: false, reason: 'stale' })
    const confirmToken = await lookupToken('standups are useless')
    const res = await undo({ title: 'standups are useless', confirm: true, confirmToken })
    expect(res).toMatchObject({ status: 'failed', reason: 'stale' })
  })
})
describe('matchUndoCandidate', () => {
  const c = (opId: string, memoryId: string, title: string): UndoCandidate =>
    ({ opId, op: 'promote', memoryId, title, createdAt: new Date(0), reason: '' })

  it('prefers an exact title over containment and token overlap', () => {
    const res = matchUndoCandidate('ship fridays', [c('1', 'a', 'Ship Fridays always'), c('2', 'b', 'ship fridays')])
    expect(res).toEqual({ kind: 'match', candidate: expect.objectContaining({ opId: '2' }) })
  })

  it('matches by token overlap when no title contains the query', () => {
    const res = matchUndoCandidate('fridays shipping rule', [c('1', 'a', 'Rule: shipping on Fridays'), c('2', 'b', 'Gym on Mondays')])
    expect(res).toEqual({ kind: 'match', candidate: expect.objectContaining({ opId: '1' }) })
  })

  it('uses only the newest op per memory', () => {
    const res = matchUndoCandidate('deep work', [c('new', 'a', 'Deep work'), c('old', 'a', 'Deep work')])
    expect(res).toEqual({ kind: 'match', candidate: expect.objectContaining({ opId: 'new' }) })
  })

  it('never matches on a single shared token unless the title is exact', () => {
    expect(matchUndoCandidate('work', [c('1', 'a', 'Deep work happens before noon')])).toEqual({ kind: 'none' })
    expect(matchUndoCandidate('deep sleep', [c('1', 'a', 'Deep work happens before noon')])).toEqual({ kind: 'none' })
    expect(matchUndoCandidate('standups', [c('1', 'a', 'Standups')])).toEqual({ kind: 'match', candidate: expect.objectContaining({ opId: '1' }) })
  })

  it('needs at least 60% of the query tokens in the title', () => {
    const titles = [c('1', 'a', 'Deep work happens before noon')]
    expect(matchUndoCandidate('deep work after lunch on mondays', titles)).toEqual({ kind: 'none' })
    expect(matchUndoCandidate('deep work before lunch', titles)).toEqual({ kind: 'match', candidate: expect.objectContaining({ opId: '1' }) })
  })
})
