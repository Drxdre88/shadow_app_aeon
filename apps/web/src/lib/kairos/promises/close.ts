import { z } from 'zod'
import { mutateKairosPromises } from '@/lib/data/kairos-promises'
import { promiseDateSchema, type KairosPromise, type PromiseClosedBy } from '@/lib/data/validators/kairos-promises'
import { closeInState, isDueInWindow, isLapsed, replaceOpen } from './rules'

// The one way a promise closes. Closers: the daily check (a user-done card),
// the owner (web session / operator Telegram chat) and the 14-day lapse rule.
// No agent, MCP tool or REST bearer path may import this module
// (kairos-promises-parity.test.ts greps for it).

export type PromiseCloser =
  | { kind: 'check'; activityEventId: string; actorId: string | null; at: string }
  | { kind: 'owner'; via: 'session' | 'telegram'; verdict: 'kept' | 'dropped' }
  | { kind: 'rule'; reason: 'lapsed_14d' }

const closerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('check'), activityEventId: z.string().uuid(), actorId: z.string().nullable(), at: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('owner'), via: z.enum(['session', 'telegram']), verdict: z.enum(['kept', 'dropped']) }).strict(),
  z.object({ kind: z.literal('rule'), reason: z.literal('lapsed_14d') }).strict(),
])

export type ClosePromiseResult =
  | { ok: true; promise: KairosPromise }
  | { ok: false; reason: 'not_found' | 'already_closed' | 'forbidden_closer' | 'not_eligible' }

function closeOutcome(closer: PromiseCloser): { status: 'kept' | 'dropped' | 'lapsed'; closedBy: PromiseClosedBy } {
  switch (closer.kind) {
    case 'check':
      return { status: 'kept', closedBy: { kind: 'check', activityEventId: closer.activityEventId, actorId: closer.actorId, at: closer.at } }
    case 'owner':
      return { status: closer.verdict, closedBy: { kind: 'owner', via: closer.via } }
    case 'rule':
      return { status: 'lapsed', closedBy: { kind: 'rule', reason: 'lapsed_14d' } }
  }
}

export async function closeKairosPromise(
  userId: string,
  promiseId: string,
  closer: PromiseCloser,
  now: Date = new Date(),
): Promise<ClosePromiseResult> {
  const parsed = closerSchema.safeParse(closer)
  if (!parsed.success) return { ok: false, reason: 'forbidden_closer' }
  const valid = parsed.data
  const { status, closedBy } = closeOutcome(valid)

  return mutateKairosPromises<ClosePromiseResult>(userId, (state) => {
    const open = state.open.find((p) => p.id === promiseId)
    if (!open) {
      const closed = state.closed.some((p) => p.id === promiseId)
      return { state: null, result: { ok: false, reason: closed ? 'already_closed' : 'not_found' } }
    }
    if (valid.kind === 'check' && open.check.kind !== 'card_done') return { state: null, result: { ok: false, reason: 'not_eligible' } }
    if (valid.kind === 'rule' && !isLapsed(open, now)) return { state: null, result: { ok: false, reason: 'not_eligible' } }
    const next = closeInState(state, promiseId, status, closedBy, now)!
    return { state: next.state, result: { ok: true, promise: next.promise } }
  })
}

export interface PromiseOwner { kind: 'owner'; via: 'session' | 'telegram' }

const ownerSchema = z.object({ kind: z.literal('owner'), via: z.enum(['session', 'telegram']) }).strict()

export type RenegotiatePromiseResult =
  | { ok: true; promise: KairosPromise }
  | { ok: false; reason: 'not_found' | 'already_closed' | 'forbidden_closer' | 'invalid_date' | 'due_out_of_window' | 'unchanged' }

// Owner moves a due date ("P3 by 20/10"). Same window as creation:
// London tomorrow..+28 days.
export async function renegotiateKairosPromise(
  userId: string,
  promiseId: string,
  dueDate: string,
  by: PromiseOwner,
  now: Date = new Date(),
): Promise<RenegotiatePromiseResult> {
  const owner = ownerSchema.safeParse(by)
  if (!owner.success) return { ok: false, reason: 'forbidden_closer' }
  const date = promiseDateSchema.safeParse(dueDate)
  if (!date.success) return { ok: false, reason: 'invalid_date' }
  if (!isDueInWindow(date.data, now)) return { ok: false, reason: 'due_out_of_window' }

  return mutateKairosPromises<RenegotiatePromiseResult>(userId, (state) => {
    const open = state.open.find((p) => p.id === promiseId)
    if (!open) {
      const closed = state.closed.some((p) => p.id === promiseId)
      return { state: null, result: { ok: false, reason: closed ? 'already_closed' : 'not_found' } }
    }
    if (open.dueDate === date.data) return { state: null, result: { ok: false, reason: 'unchanged' } }
    const promise: KairosPromise = {
      ...open,
      dueDate: date.data,
      renegotiations: open.renegotiations + 1,
      dueHistory: [...open.dueHistory, { dueDate: open.dueDate, changedAt: now.toISOString(), via: owner.data.via }].slice(-20),
    }
    return { state: replaceOpen(state, promise), result: { ok: true, promise } }
  })
}
