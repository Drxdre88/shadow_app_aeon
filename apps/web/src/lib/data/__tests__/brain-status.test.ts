import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))

import { classifyBrainJob, countPaidBackupCalls, summariseBrainStatus, summariseChatLatency, type BrainJobRow } from '../brain-status'
import { BRAIN_JOBS } from '@/lib/kairos/routines/catalog'

const NOW = new Date('2026-10-02T08:30:00.000Z')
const t = (iso: string) => new Date(`2026-${iso}:00.000Z`)

function row(overrides: Partial<BrainJobRow>): BrainJobRow {
  return {
    kind: 'cortex',
    status: 'done',
    claimedBy: 'routine',
    claimedAt: t('10-02T01:41'),
    completedAt: t('10-02T01:43'),
    deadlineAt: t('10-02T05:00'),
    error: null,
    ...overrides,
  }
}

describe('classifyBrainJob', () => {
  it.each<[string, Partial<BrainJobRow>, ReturnType<typeof classifyBrainJob>]>([
    ['02/10 cortex done by the routine', {}, 'routine'],
    ['done by a scoped routine claim', { claimedBy: 'routine:brain' }, 'routine'],
    ['done on the paid key', { claimedBy: 'api' }, 'backup'],
    ['done deterministically', { claimedBy: 'deterministic' }, 'backup'],
    ['02/10 drift_probe covered by the sweep fallback', { kind: 'drift_probe', status: 'fallback', claimedBy: 'routine', completedAt: t('10-02T06:00') }, 'backup'],
    ['02/10 expired with a deferred-to-cron note', { kind: 'daily_message', status: 'expired', claimedBy: null, claimedAt: null, completedAt: null, error: 'fallback: deferred to the 06:15 UTC briefer cron' }, 'backup'],
    ['failed but a cron named as covering it', { status: 'failed', error: 'rejected; the nightly cron covers it' }, 'backup'],
    ['chat taken over by the watchdog', { kind: 'chat', status: 'failed', error: 'chat-watchdog: no claim; answered on the paid key' }, 'backup'],
    ['02/10 cortex failed with no backup note', { status: 'failed', error: 'invalid JSON from routine' }, 'missed'],
    ['expired by the sweep, fallback not yet run', { status: 'expired', error: 'deadline passed before a routine answered' }, 'missed'],
    ['expired with no error', { status: 'expired', error: null }, 'missed'],
    ['queued past its deadline', { status: 'queued', claimedAt: null, completedAt: null, deadlineAt: t('10-02T07:00') }, 'missed'],
    ['claimed past its deadline', { status: 'claimed', completedAt: null, deadlineAt: t('10-02T07:00') }, 'missed'],
    ['queued before its deadline', { status: 'queued', claimedAt: null, completedAt: null, deadlineAt: t('10-02T09:00') }, null],
    ['claimed before its deadline', { status: 'claimed', completedAt: null, deadlineAt: t('10-02T09:00') }, null],
    ['superseded chat turn is not owed', { kind: 'chat', status: 'failed', error: 'superseded: a newer operator message took over this turn' }, null],
  ])('%s', (_name, overrides, expected) => {
    expect(classifyBrainJob(row(overrides), NOW)).toBe(expected)
  })

  it('a sweep fallback declined by the paid-backup switch is missed, not backup', () => {
    const declined = row({ kind: 'concept', status: 'expired', error: 'fallback: paid backup off' })
    expect(classifyBrainJob(declined, NOW)).toBe('missed')
  })

  it('switch off: a cron-"covered" job was skipped (missed), except the free plain-text daily message', () => {
    const cron = row({ status: 'failed', error: 'deadline_passed: …; the cortex-regen cron owns this job now' })
    const daily = row({ kind: 'daily_message', status: 'expired', error: 'fallback: deferred to the 06:00 cron' })
    const paid = row({ kind: 'drift_probe', status: 'fallback', claimedBy: null })
    expect(classifyBrainJob(cron, NOW, { paidBackupOff: true })).toBe('missed')
    expect(classifyBrainJob(cron, NOW)).toBe('backup')
    expect(classifyBrainJob(daily, NOW, { paidBackupOff: true })).toBe('backup')
    expect(classifyBrainJob(paid, NOW, { paidBackupOff: true })).toBe('backup')
  })
})

describe('countPaidBackupCalls', () => {
  it('counts backup-answered jobs (any kind) in the last 7 days', () => {
    const rows = [
      row({ kind: 'drift_probe', status: 'fallback', claimedBy: null }),
      row({ kind: 'chat', status: 'failed', error: 'chat-watchdog: answered on the paid key' }),
      row({}), // routine
      row({ status: 'failed', error: 'invalid JSON from routine' }), // missed
      row({ kind: 'aether', claimedBy: 'api', deadlineAt: t('09-20T05:00') }), // older than a week
    ]
    expect(countPaidBackupCalls(rows, NOW)).toBe(2)
    expect(countPaidBackupCalls([], NOW)).toBe(0)
  })
})

describe('summariseBrainStatus', () => {
  const night: BrainJobRow[] = [
    row({}),
    row({ kind: 'cortex', status: 'failed', claimedAt: t('10-02T01:50'), completedAt: t('10-02T01:52'), error: 'invalid JSON from routine' }),
    row({ kind: 'drift_probe', status: 'fallback', claimedBy: null, claimedAt: null, completedAt: t('10-02T06:00') }),
    row({ kind: 'daily_message', status: 'expired', claimedBy: null, claimedAt: null, completedAt: null, deadlineAt: t('10-02T06:10'), error: 'fallback: deferred to the 06:15 UTC briefer cron' }),
    // A kind no longer in the catalog still counts for the night, but is not listed.
    row({ kind: 'retired_kind', status: 'fallback', claimedBy: null, claimedAt: null, completedAt: t('10-02T06:20') }),
    // Two nights ago — outside "last night", inside the week.
    row({ kind: 'aether', claimedAt: t('09-30T02:00'), completedAt: t('09-30T02:05'), deadlineAt: t('09-30T05:00') }),
    // Older than a week — ignored for the week counts.
    row({ kind: 'aether', claimedBy: 'api', claimedAt: t('09-20T02:00'), completedAt: t('09-20T02:05'), deadlineAt: t('09-20T05:00') }),
  ]

  it('lists every BRAIN_JOBS kind in catalog order', () => {
    const s = summariseBrainStatus(night, NOW)
    expect(s.kinds.map((k) => k.kind)).toEqual(BRAIN_JOBS.map((j) => j.kind))
    expect(s.kinds.find((k) => k.kind === 'concept')).toEqual({
      kind: 'concept',
      lastAt: null,
      lastAnsweredBy: null,
      week: { routine: 0, backup: 0, missed: 0 },
    })
  })

  it('counts last night (deadline since 00:00 UTC yesterday) across all kinds', () => {
    expect(summariseBrainStatus(night, NOW).lastNight).toEqual({ routine: 1, backup: 3, missed: 1 })
  })

  it('per kind: latest outcome wins and week counts stay within 7 days', () => {
    const s = summariseBrainStatus(night, NOW)
    const cortex = s.kinds.find((k) => k.kind === 'cortex')!
    expect(cortex.week).toEqual({ routine: 1, backup: 0, missed: 1 })
    expect(cortex.lastAnsweredBy).toBe('missed')
    expect(cortex.lastAt).toBe('2026-10-02T01:52:00.000Z')
    const aether = s.kinds.find((k) => k.kind === 'aether')!
    expect(aether.week).toEqual({ routine: 1, backup: 0, missed: 0 })
    expect(aether.lastAnsweredBy).toBe('routine')
  })

  it('backupKinds: catalog kinds answered by backup in the last 24 h, deduped', () => {
    const rows = [
      ...night,
      row({ kind: 'drift_probe', status: 'done', claimedBy: 'api', completedAt: t('10-02T07:00') }),
      row({ kind: 'archetype', status: 'fallback', completedAt: t('09-30T06:00'), deadlineAt: t('09-30T05:00') }),
    ]
    expect(summariseBrainStatus(rows, NOW).backupKinds).toEqual(['drift_probe', 'daily_message'])
  })

  it('brain routine is live after a routine claim within 26 h, with that claim time', () => {
    const s = summariseBrainStatus(night, NOW)
    expect(s.routines.find((r) => r.id === 'brain')).toEqual({
      id: 'brain', lastClaimAt: '2026-10-02T01:41:00.000Z', state: 'live',
    })
  })

  it('brain routine is silent when its last routine answer is older than 26 h', () => {
    const rows = [
      row({ claimedAt: t('09-30T01:41'), completedAt: t('09-30T01:43'), deadlineAt: t('09-30T05:00') }),
      // A routine claim that failed is not an answer.
      row({ status: 'failed', claimedAt: t('10-02T01:41'), error: 'invalid JSON' }),
    ]
    expect(summariseBrainStatus(rows, NOW).routines.find((r) => r.id === 'brain')).toEqual({
      id: 'brain', lastClaimAt: '2026-09-30T01:41:00.000Z', state: 'silent',
    })
  })

  it('brain routine is silent with no history; chat claims do not count for it', () => {
    const rows = [row({ kind: 'chat', claimedAt: t('10-02T08:00'), completedAt: t('10-02T08:01'), deadlineAt: t('10-02T08:10') })]
    const brain = summariseBrainStatus(rows, NOW).routines.find((r) => r.id === 'brain')
    expect(brain).toEqual({ id: 'brain', lastClaimAt: null, state: 'silent' })
  })

  describe('chat routine', () => {
    const answered = row({ kind: 'chat', claimedAt: t('10-01T20:00'), completedAt: t('10-01T20:01'), deadlineAt: t('10-01T20:10') })
    const watchdog = row({ kind: 'chat', status: 'failed', claimedBy: null, claimedAt: null, completedAt: t('10-02T07:00'), deadlineAt: t('10-02T07:05'), error: 'chat-watchdog: no claim; answered on the paid key' })
    const chat = (rows: BrainJobRow[], flag: boolean) =>
      summariseBrainStatus(rows, NOW, { chatRoutineFlagOn: flag }).routines.find((r) => r.id === 'chat')

    it('is off when the Telegram routine flag is off, whatever the history', () => {
      expect(chat([answered], false)).toEqual({ id: 'chat', lastClaimAt: '2026-10-01T20:00:00.000Z', state: 'off' })
      expect(summariseBrainStatus([answered], NOW).routines.find((r) => r.id === 'chat')?.state).toBe('off')
    })

    it('is live when the latest turn was answered by the routine', () => {
      expect(chat([watchdog, row({ ...answered, completedAt: t('10-02T08:00'), deadlineAt: t('10-02T08:10') })], true)?.state).toBe('live')
    })

    it('is silent when the latest turn fell to the backup, or there is no turn', () => {
      expect(chat([answered, watchdog], true)).toEqual({ id: 'chat', lastClaimAt: '2026-10-01T20:00:00.000Z', state: 'silent' })
      expect(chat([], true)).toEqual({ id: 'chat', lastClaimAt: null, state: 'silent' })
    })
  })
})

describe('summariseChatLatency', () => {
  // A chat turn created at `created` (MM-DDTHH:MM) answered `secs` later.
  const routineTurn = (created: string, secs: number, over: Partial<BrainJobRow> = {}) => {
    const at = t(created)
    return row({
      kind: 'chat', createdAt: at, claimedAt: new Date(at.getTime() + 2_000),
      completedAt: new Date(at.getTime() + secs * 1000), deadlineAt: new Date(at.getTime() + 90_000), ...over,
    })
  }
  const backupTurn = (created: string, settleMs: number, timing: Record<string, unknown> = {}) => {
    const at = t(created)
    return row({
      kind: 'chat', status: 'failed', claimedBy: null, claimedAt: null, createdAt: at,
      completedAt: new Date(at.getTime() + 60_000), deadlineAt: new Date(at.getTime() + 90_000),
      error: 'chat-watchdog: no claim; answered on the paid key',
      timing: { fireOk: true, enqueueToSettleMs: settleMs, ...timing },
    })
  }

  it('p50/p95/max over routine-answered turns in the last 7 days', () => {
    const rows = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((s, i) => routineTurn(`10-01T1${i}:00`, s))
    const l = summariseChatLatency(rows, NOW)!
    expect(l).toMatchObject({ turns: 10, routine: 10, backup: 0, missed: 0, p50Ms: 50_000, p95Ms: 100_000, maxMs: 100_000, fireFailures: 0 })
  })

  it('routine-only percentiles; backup p50 from the stamped settle time; fire failures counted', () => {
    const rows = [
      routineTurn('10-01T10:00', 38),
      routineTurn('10-01T11:00', 71, { claimedBy: 'routine:chat' }),
      backupTurn('10-01T12:00', 95_000, { fireOk: false }),
      backupTurn('10-01T13:00', 105_000),
      // Not chat, ignored.
      routineTurn('10-01T14:00', 999, { kind: 'cortex' }),
      // Older than 7 days, ignored.
      routineTurn('09-20T10:00', 500),
    ]
    const l = summariseChatLatency(rows, NOW)!
    expect(l).toMatchObject({ turns: 4, routine: 2, backup: 2, missed: 0, p50Ms: 38_000, p95Ms: 71_000, backupP50Ms: 95_000, fireFailures: 1 })
    expect(l.lastTurnMs).toBe(105_000)
  })

  it('a custom window (one UTC day) bounds the turns', () => {
    const rows = [routineTurn('09-30T23:59', 20), routineTurn('10-01T00:00', 30), routineTurn('10-02T00:00', 40)]
    const l = summariseChatLatency(rows, NOW, { from: t('10-01T00:00'), to: new Date(t('10-02T00:00').getTime() - 1) })!
    expect(l).toMatchObject({ turns: 1, p50Ms: 30_000 })
  })

  it('no chat turns → null', () => {
    expect(summariseChatLatency([], NOW)).toBeNull()
    expect(summariseChatLatency([row({})], NOW)).toBeNull()
    const superseded = row({ kind: 'chat', status: 'failed', createdAt: t('10-02T07:00'), error: 'superseded: newer' })
    expect(summariseChatLatency([superseded], NOW)).toBeNull()
  })
})

describe('daytime cadence (pulse routine, reflect)', () => {
  const pulseDone = row({ kind: 'pulse', claimedBy: 'routine', claimedAt: t('10-02T07:10'), completedAt: t('10-02T07:11'), deadlineAt: t('10-02T07:55') })
  const reflectDone = row({ kind: 'reflect', claimedAt: t('10-02T07:40'), completedAt: t('10-02T07:42'), deadlineAt: t('10-02T08:30') })
  const pulse = (rows: BrainJobRow[], flag?: boolean) =>
    summariseBrainStatus(rows, NOW, flag === undefined ? {} : { pulseRoutineFlagOn: flag }).routines.find((r) => r.id === 'pulse')

  it('pulse claims count for the pulse routine, never the brain; reflect counts for the brain', () => {
    const s = summariseBrainStatus([pulseDone], NOW, { pulseRoutineFlagOn: true })
    expect(s.routines.find((r) => r.id === 'brain')).toEqual({ id: 'brain', lastClaimAt: null, state: 'silent' })
    expect(pulse([pulseDone], true)).toEqual({ id: 'pulse', lastClaimAt: '2026-10-02T07:10:00.000Z', state: 'live' })
    expect(summariseBrainStatus([reflectDone], NOW).routines.find((r) => r.id === 'brain')?.lastClaimAt).toBe('2026-10-02T07:40:00.000Z')
  })

  it('the pulse is off when daytime thinking is off (default: the server flag)', () => {
    delete process.env.KAIROS_DAYTIME_THINKING
    expect(pulse([pulseDone])?.state).toBe('off')
    expect(pulse([pulseDone], false)?.state).toBe('off')
    expect(pulse([], true)).toEqual({ id: 'pulse', lastClaimAt: null, state: 'silent' })
  })

  it('an unanswered daytime slot is missed, never "backup" (they have none)', () => {
    const expired = { status: 'expired', claimedBy: null, claimedAt: null, completedAt: null, error: 'fallback: no fallback — a missed hour is fine' }
    expect(classifyBrainJob(row({ kind: 'pulse', ...expired }), NOW)).toBe('missed')
    expect(classifyBrainJob(row({ kind: 'reflect', ...expired }), NOW)).toBe('missed')
    expect(countPaidBackupCalls([row({ kind: 'reflect', ...expired })], NOW)).toBe(0)
  })

  it('daytime jobs are not counted as "last night"', () => {
    expect(summariseBrainStatus([pulseDone, reflectDone, row({})], NOW).lastNight).toEqual({ routine: 1, backup: 0, missed: 0 })
  })
})
