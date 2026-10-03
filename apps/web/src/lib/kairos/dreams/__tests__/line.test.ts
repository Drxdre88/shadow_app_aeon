import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/thinking-jobs', () => ({ listJobs: vi.fn() }))

import { listJobs } from '@/lib/data/thinking-jobs'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'
import { DREAM_LINE_MAX_CHARS, buildDreamLine, isDreamLineDay, readDreamLine, sanitiseDreamText } from '../line'

const USER = 'user-1'
const SAT = new Date('2026-10-03T05:00:00Z') // 06:00 London, Saturday
const at = (iso: string) => new Date(iso)

function job(kind: 'dream' | 'dream_read', output: Record<string, unknown>, over: Partial<ThinkingJobRow> = {}): ThinkingJobRow {
  return {
    id: `${kind}-job`, userId: USER, kind, dominionId: null, externalKey: `${kind}:2026-10-03`, status: 'done',
    input: { system: 's', prompt: 'p' }, output, claimedBy: 'routine', claimToken: null, claimedAt: SAT,
    deadlineAt: SAT, completedAt: SAT, attempts: 1, error: null, createdAt: SAT, updatedAt: SAT, ...over,
  } as ThinkingJobRow
}

const DREAM = job('dream', { dreamt: true, v: 1, date: '2026-10-03', title: 'The desk at sea', dream: 'secret dream text' })
const READ = job('dream_read', { dreamt: true, v: 1, date: '2026-10-03', dreamJobId: 'dream-job', morningLine: 'I dreamt the trading desk drifted out to sea.' })

function jobsByKind(rows: ThinkingJobRow[]) {
  vi.mocked(listJobs).mockImplementation(async (_u, filter = {}) => rows.filter((r) => !filter.kind || r.kind === filter.kind))
}

beforeEach(() => {
  vi.clearAllMocks()
  jobsByKind([DREAM, READ])
})

describe('isDreamLineDay', () => {
  it('is London Tue/Thu/Sat only — never Monday', () => {
    expect(isDreamLineDay(at('2026-10-06T05:00:00Z'))).toBe(true) // Tue
    expect(isDreamLineDay(at('2026-10-08T05:00:00Z'))).toBe(true) // Thu
    expect(isDreamLineDay(SAT)).toBe(true)
    for (const iso of ['2026-10-04T05:00:00Z', '2026-10-05T05:00:00Z', '2026-10-07T05:00:00Z', '2026-10-09T05:00:00Z']) {
      expect(isDreamLineDay(at(iso))).toBe(false)
    }
    // 23:30 UTC Monday is 00:30 London Tuesday (BST).
    expect(isDreamLineDay(at('2026-10-05T23:30:00Z'))).toBe(true)
  })
})

describe('sanitiseDreamText', () => {
  it('strips URLs, headings, markdown, uuids, prompt aliases and Q/P refs', () => {
    const raw = '## I dreamt **P2** and Q14 met m1 at https://x.io/a near 1b4e28ba-2fa1-11d2-883f-0016d3cca427 (b3) www.y.com'
    const out = sanitiseDreamText(raw)
    expect(out).toBe('I dreamt and met at near')
    expect(out).not.toMatch(/\b[QP]\d+\b|https?:|www\.|#|\*/)
  })
})

describe('buildDreamLine', () => {
  it('uses the morning line when it reads as "I dreamt…", with the 💭 prefix', () => {
    expect(buildDreamLine('I dreamt the desk drifted.', 'X')).toBe('💭 I dreamt the desk drifted.')
    expect(buildDreamLine('i dreamt of P3 again', 'X')).toBe('💭 I dreamt of again')
  })

  it('falls back to "I dreamt about <title>." when the line is missing or off-form', () => {
    expect(buildDreamLine(null, 'The desk at sea')).toBe('💭 I dreamt about The desk at sea.')
    expect(buildDreamLine('Something else entirely', 'Rooms!')).toBe('💭 I dreamt about Rooms.')
    expect(buildDreamLine(null, '  ')).toBeNull()
    expect(buildDreamLine(undefined, undefined)).toBeNull()
  })

  it('never exceeds 160 characters', () => {
    const line = buildDreamLine(`I dreamt ${'very long scene '.repeat(30)}`, null) as string
    expect(line.length).toBeLessThanOrEqual(DREAM_LINE_MAX_CHARS)
    expect(line.endsWith('…')).toBe(true)
  })
})

describe('readDreamLine', () => {
  it('builds the line from today\'s done dream_read on a line day', async () => {
    expect(await readDreamLine(USER, SAT)).toBe('💭 I dreamt the trading desk drifted out to sea.')
    expect(listJobs).toHaveBeenCalledWith(USER, expect.objectContaining({ kind: 'dream_read', status: 'done' }))
  })

  it('falls back to the dream title when the read has no morning line', async () => {
    jobsByKind([DREAM, job('dream_read', { ...READ.output, morningLine: null })])
    expect(await readDreamLine(USER, SAT)).toBe('💭 I dreamt about The desk at sea.')
  })

  it('is null off-day, without today\'s done read, or when the lookup throws', async () => {
    expect(await readDreamLine(USER, at('2026-10-05T05:00:00Z'))).toBeNull()
    expect(listJobs).not.toHaveBeenCalled()

    jobsByKind([DREAM, job('dream_read', { ...READ.output, date: '2026-10-02' })])
    expect(await readDreamLine(USER, SAT)).toBeNull()

    jobsByKind([DREAM, job('dream_read', READ.output as Record<string, unknown>, { status: 'claimed' })])
    expect(await readDreamLine(USER, SAT)).toBeNull()

    jobsByKind([DREAM])
    expect(await readDreamLine(USER, SAT)).toBeNull()

    vi.mocked(listJobs).mockRejectedValue(new Error('db down'))
    expect(await readDreamLine(USER, SAT)).toBeNull()
  })

  it('never returns the dream text itself', async () => {
    jobsByKind([DREAM, job('dream_read', { ...READ.output, morningLine: null })])
    expect(await readDreamLine(USER, SAT)).not.toContain('secret dream text')
  })
})
