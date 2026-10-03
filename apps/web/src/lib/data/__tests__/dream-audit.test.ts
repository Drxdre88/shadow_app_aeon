import { beforeEach, describe, expect, it, vi } from 'vitest'

const rows = vi.hoisted(() => ({ memories: [] as unknown[], calls: 0 }))

vi.mock('@/lib/db', () => {
  const chain: Record<string, unknown> = {}
  const pass = () => chain
  chain.from = pass
  chain.where = pass
  chain.orderBy = pass
  chain.limit = () => Promise.resolve(rows.memories)
  return { db: { select: vi.fn(() => { rows.calls++; return chain }) } }
})
vi.mock('@/lib/data/thinking-jobs', () => ({ listJobs: vi.fn() }))

import { listJobs } from '@/lib/data/thinking-jobs'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'
import { dreamFingerprints } from '@/lib/kairos/dreams/fingerprint'
import { auditDreamEchoes, countDreamEchoes } from '../dream-audit'

const USER = 'user-1'
const NOW = new Date('2026-10-03T04:00:00Z')
const DREAMT_AT = new Date('2026-10-03T03:00:00Z')
const DREAM = 'the trading desk floated out past the harbour wall while the lighthouse kept counting settlement prices in a voice like rain'
const SOURCE = 'the trading desk reviewed settlement prices'
const PRINTS = dreamFingerprints([DREAM], [SOURCE])

function dreamJob(over: Partial<ThinkingJobRow> = {}): ThinkingJobRow {
  return {
    id: 'dream-1', userId: USER, kind: 'dream', dominionId: null, externalKey: 'dream:2026-10-03', status: 'done',
    input: { system: 's', prompt: 'p' },
    output: { dreamt: true, v: 1, date: '2026-10-03', title: 'Harbour', dream: DREAM, scenes: [], seeds: [], fingerprints: PRINTS },
    claimedBy: 'routine', claimToken: null, claimedAt: DREAMT_AT, deadlineAt: DREAMT_AT, completedAt: DREAMT_AT,
    attempts: 1, error: null, createdAt: DREAMT_AT, updatedAt: DREAMT_AT, ...over,
  } as ThinkingJobRow
}

const after = new Date('2026-10-03T03:30:00Z')
const before = new Date('2026-10-03T02:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  rows.memories = []
  rows.calls = 0
})

describe('countDreamEchoes', () => {
  it('flags memories created after the dream that share ≥2 fingerprints', () => {
    expect(PRINTS.length).toBeGreaterThan(2)
    const echo = { id: 'm-echo', createdAt: after, text: `Note: ${DREAM}` }
    const earlier = { id: 'm-before', createdAt: before, text: DREAM }
    const unrelated = { id: 'm-other', createdAt: after, text: 'The trading desk reviewed settlement prices again today.' }
    expect(countDreamEchoes([{ dreamtAt: DREAMT_AT, fingerprints: PRINTS }], [echo, earlier, unrelated]))
      .toEqual({ dreamEchoes: 1, dreamEchoIds: ['m-echo'] })
  })

  it('one shared shingle is not an echo', () => {
    const words = DREAM.split(' ')
    const single = { id: 'm1', createdAt: after, text: words.slice(0, 8).join(' ') }
    expect(countDreamEchoes([{ dreamtAt: DREAMT_AT, fingerprints: PRINTS }], [single]).dreamEchoes).toBe(0)
  })
})

describe('auditDreamEchoes', () => {
  it('reads done dreams from the last week and scans memories created since', async () => {
    vi.mocked(listJobs).mockResolvedValue([dreamJob()])
    rows.memories = [
      { id: 'm-echo', createdAt: after, title: 'Harbour notes', summary: null, bodyMd: DREAM },
      { id: 'm-clean', createdAt: after, title: 'Board', summary: 'Shipped the fix', bodyMd: 'Shipped the login fix.' },
    ]
    expect(await auditDreamEchoes(USER, NOW)).toEqual({ dreamEchoes: 1, dreamEchoIds: ['m-echo'] })
    expect(listJobs).toHaveBeenCalledWith(USER, expect.objectContaining({ kind: 'dream', status: 'done' }))
  })

  it('no readable dream → zero without touching memories', async () => {
    vi.mocked(listJobs).mockResolvedValue([dreamJob({ output: { dreamt: true, redacted: true } })])
    expect(await auditDreamEchoes(USER, NOW)).toEqual({ dreamEchoes: 0, dreamEchoIds: [] })
    expect(rows.calls).toBe(0)
  })
})
