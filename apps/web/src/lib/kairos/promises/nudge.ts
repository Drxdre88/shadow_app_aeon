import { mutateKairosPromises } from '@/lib/data/kairos-promises'
import type { KairosPromise } from '@/lib/data/validators/kairos-promises'
import { writeCronFailureTrace } from '@/lib/kairos/cron-trace'
import { isLondonHour, londonDate } from '@/lib/kairos/daily-message-prompt'
import { initiativeEnabled } from '@/lib/kairos/initiative'
import { deliverKairosSpeak } from '@/lib/kairos/speak'
import { addDays, daysLate, formatDayMonth } from './rules'

// At most ONE Telegram nudge per promise, only once it is more than 2 London
// days late, at 12:00 London from the hourly thinking sweep. The nudge is
// claimed (nudge.claimedAt) inside the locked transaction BEFORE sending, so a
// retry or overlapping run can never send twice; same-day eligibles share one
// message.

export const PROMISE_NUDGE_HOUR = 12
export const PROMISE_NUDGE_MIN_DAYS_LATE = 3
export const PROMISE_NUDGE_CRON = 'promise-nudge'
export const promiseNudgeExternalId = (promiseId: string) => `kairos-promise-nudge:${promiseId}`

export type PromiseNudgeResult =
  | { status: 'skipped'; reason: 'initiative_off' | 'not_nudge_hour' }
  | { status: 'none' }
  | { status: 'sent' | 'inbox_only' | 'blocked' | 'failed'; promiseIds: string[] }

const clipOutcome = (s: string) => (s.length > 120 ? `${s.slice(0, 119)}…` : s)

export function buildPromiseNudgeMessage(promises: readonly KairosPromise[], now: Date): string {
  const lines = promises.map((p) => `P${p.seq} · ${daysLate(p, now)} days late · ${clipOutcome(p.outcome)}`)
  const first = promises[0]!.seq
  const by = formatDayMonth(addDays(londonDate(now), 7))
  const head = promises.length === 1 ? 'A promise is overdue:' : `${promises.length} promises are overdue:`
  return [head, ...lines, `Reply 'P${first} kept', 'drop P${first}' or 'P${first} by ${by}'.`].join('\n')
}

export async function runPromiseNudges(userId: string, now: Date): Promise<PromiseNudgeResult> {
  if (!initiativeEnabled()) return { status: 'skipped', reason: 'initiative_off' }
  if (!isLondonHour(now, PROMISE_NUDGE_HOUR)) return { status: 'skipped', reason: 'not_nudge_hour' }

  const claimedAt = now.toISOString()
  const claimed = await mutateKairosPromises(userId, (state) => {
    const eligible = state.open
      .filter((p) => !p.nudge && daysLate(p, now) >= PROMISE_NUDGE_MIN_DAYS_LATE)
      .sort((a, b) => a.seq - b.seq)
    if (eligible.length === 0) return { state: null, result: [] as KairosPromise[] }
    const ids = new Set(eligible.map((p) => p.id))
    const open = state.open.map((p) => (ids.has(p.id) ? { ...p, nudge: { claimedAt, delivered: false } } : p))
    return { state: { ...state, open }, result: eligible }
  })
  if (claimed.length === 0) return { status: 'none' }

  const promiseIds = claimed.map((p) => p.id)
  let status: 'sent' | 'inbox_only' | 'blocked' | 'failed' = 'failed'
  let memoryId: string | undefined
  try {
    const outcome = await deliverKairosSpeak(userId, {
      title: 'Kairos · promises',
      message: buildPromiseNudgeMessage(claimed, now),
      kind: 'notify',
      urgency: 'normal',
      force: true,
      opsAlert: false,
      digest: false,
      externalId: promiseNudgeExternalId(claimed[0]!.id),
    })
    if (outcome.status === 200) {
      memoryId = outcome.body.id
      status = outcome.body.delivered.telegram ? 'sent' : 'inbox_only'
    } else {
      status = 'blocked'
    }
  } catch (err) {
    await writeCronFailureTrace(userId, { cronName: PROMISE_NUDGE_CRON, reason: 'delivery_failed', error: err })
    return { status: 'failed', promiseIds }
  }

  if (status !== 'blocked') {
    const delivered = status === 'sent'
    await mutateKairosPromises(userId, (state) => {
      const ids = new Set(promiseIds)
      let changed = false
      const open = state.open.map((p) => {
        if (!ids.has(p.id) || p.nudge?.claimedAt !== claimedAt) return p
        changed = true
        return { ...p, nudge: { claimedAt, delivered, ...(memoryId ? { memoryId } : {}) } }
      })
      return { state: changed ? { ...state, open } : null, result: null }
    })
  } else {
    await writeCronFailureTrace(userId, { cronName: PROMISE_NUDGE_CRON, reason: 'delivery_blocked' })
  }
  return { status, promiseIds }
}
