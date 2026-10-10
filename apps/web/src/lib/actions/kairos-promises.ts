'use server'

import { requireVorath } from '@/lib/actions/helpers'
import { listKairosPromises, toKairosPromiseView } from '@/lib/data/kairos-promises'
import { listKairosPromisesSchema, ownerPromiseIdSchema, ownerRenegotiateSchema } from '@/lib/data/validators/kairos-promises'
import { closeKairosPromise, renegotiateKairosPromise } from '@/lib/kairos/promises/close'

// Owner-only promise controls for the web session. The Telegram operator chat
// is the other owner path; agents (MCP / REST bearer) have read-only access.

export async function listOwnKairosPromises(scope?: 'open' | 'all') {
  const userId = await requireVorath()
  const input = listKairosPromisesSchema.parse({ scope })
  return (await listKairosPromises(userId, input)).map(toKairosPromiseView)
}

export async function keepKairosPromise(promiseId: string) {
  const userId = await requireVorath()
  return closeKairosPromise(userId, ownerPromiseIdSchema.parse(promiseId), { kind: 'owner', via: 'session', verdict: 'kept' })
}

export async function dropKairosPromise(promiseId: string) {
  const userId = await requireVorath()
  return closeKairosPromise(userId, ownerPromiseIdSchema.parse(promiseId), { kind: 'owner', via: 'session', verdict: 'dropped' })
}

export async function renegotiateOwnKairosPromise(promiseId: string, dueDate: string) {
  const userId = await requireVorath()
  const input = ownerRenegotiateSchema.parse({ promiseId, dueDate })
  return renegotiateKairosPromise(userId, input.promiseId, input.dueDate, { kind: 'owner', via: 'session' })
}
