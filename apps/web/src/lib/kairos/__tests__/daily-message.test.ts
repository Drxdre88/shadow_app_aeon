import { beforeEach, describe, expect, it, vi } from 'vitest'

const selectQueue: unknown[][] = []
const updateReturning: unknown[][] = []
// In-memory stand-in for pg_try_advisory_xact_lock: held for the duration of
// the transaction callback by whichever caller got it first.
const advisory = vi.hoisted(() => ({ held: false, keys: [] as unknown[] }))

vi.mock('@/lib/db', () => {
  function makeChain(rows: unknown[]) {
    const chain: Record<string, unknown> = {}
    const pass = () => chain
    chain.from = pass
    chain.where = pass
    chain.set = pass
    chain.returning = () => Promise.resolve(updateReturning.shift() ?? [])
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(rows)
    return chain
  }
  return {
    db: {
      select: vi.fn(() => makeChain(selectQueue.shift() ?? [])),
      update: vi.fn(() => makeChain([])),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        let mine = false
        const tx = {
          execute: vi.fn(async (q: unknown) => {
            advisory.keys.push(q)
            if (advisory.held) return { rows: [{ locked: false }] }
            advisory.held = true
            mine = true
            return { rows: [{ locked: true }] }
          }),
        }
        try {
          return await fn(tx)
        } finally {
          if (mine) advisory.held = false
        }
      }),
    },
  }
})

vi.mock('@/lib/data/thinking-jobs', () => ({ listJobs: vi.fn() }))
vi.mock('@/lib/ai/route-task', () => ({ getProviderForTask: vi.fn() }))
vi.mock('../speak', () => ({ deliverKairosSpeak: vi.fn() }))
vi.mock('../cron-trace', () => ({ writeCronFailureTrace: vi.fn(), writeCronSuccessTrace: vi.fn() }))
vi.mock('../daily-message-inputs', () => ({ gatherDailyMessageInputs: vi.fn() }))
vi.mock('../conscience-context', () => ({ loadConscienceBlock: vi.fn() }))

import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { listJobs } from '@/lib/data/thinking-jobs'
import { getProviderForTask } from '@/lib/ai/route-task'
import { AiCredentialMissingError } from '@/lib/ai/router'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'
import { deliverKairosSpeak } from '../speak'
import { writeCronFailureTrace, writeCronSuccessTrace } from '../cron-trace'
import { gatherDailyMessageInputs } from '../daily-message-inputs'
import { loadConscienceBlock } from '../conscience-context'
import type { DailyMessageInputs } from '../daily-message-prompt'
import { readJobDraft, runDailyMessageForUser } from '../daily-message'

const USER = 'user-1'
const NOW = new Date('2026-10-01T07:00:00.000Z') // 08:00 London (BST)
const DATE = '2026-10-01'

const INPUTS: DailyMessageInputs = {
  date: DATE,
  isMonday: false,
  areas: [{ dominion: 'AEON', headline: 'Ship the board fix.' }],
  aether: null,
  boardDay: { finished: 1, finishedTitles: ['Fix login'], thinCards: 0 },
  promotions: [{ title: 'Small batches ship faster' }],
  newBeliefs: [],
  drift: null,
  pendingAsk: null,
  synthesis: null,
  mindCompare: null,
  failed: ['aether'],
}

const ask = vi.fn()

function job(over: Partial<ThinkingJobRow> = {}): ThinkingJobRow {
  return {
    id: 'job-1',
    userId: USER,
    kind: 'daily_message' as ThinkingJobRow['kind'],
    dominionId: null,
    externalKey: `daily_message:${DATE}`,
    status: 'done',
    input: { system: 's', prompt: 'p', context: { date: DATE } },
    output: { draft: '**Today** routine draft.', memoryIds: [], answeredBy: 'routine', chars: 40 },
    claimedBy: 'routine',
    claimToken: 'tok',
    claimedAt: NOW,
    deadlineAt: NOW,
    completedAt: NOW,
    attempts: 1,
    error: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  selectQueue.length = 0
  updateReturning.length = 0
  advisory.held = false
  advisory.keys.length = 0
  vi.mocked(gatherDailyMessageInputs).mockResolvedValue(INPUTS)
  vi.mocked(loadConscienceBlock).mockResolvedValue('')
  vi.mocked(listJobs).mockResolvedValue([])
  vi.mocked(getProviderForTask).mockResolvedValue({ provider: { ask } } as never)
  ask.mockResolvedValue({ text: '{"message": "**Today** model text."}', finishReason: 'stop' })
  vi.mocked(deliverKairosSpeak).mockResolvedValue({ status: 200, body: { id: 'm1', delivered: { inbox: true, telegram: true } } })
})

describe('runDailyMessageForUser', () => {
  it('delivers once per London date with digest:true and the kairos-daily externalId', async () => {
    selectQueue.push([{ n: 0 }])
    const result = await runDailyMessageForUser(USER, { now: NOW })

    expect(result).toMatchObject({ status: 'sent', source: 'api', date: DATE, failedInputs: ['aether'] })
    const [, payload] = vi.mocked(deliverKairosSpeak).mock.calls[0]
    expect(payload).toMatchObject({ kind: 'notify', digest: true, force: true, externalId: `kairos-daily:${DATE}` })
    expect(payload.message).toBe('**Today** model text.\n\nWhat I now believe:\n1. Small batches ship faster\nTo undo one, just tell me “undo <title>”.')
    expect(writeCronSuccessTrace).toHaveBeenCalledWith(USER, expect.objectContaining({ cronName: 'daily-message' }))
    expect(vi.mocked(getProviderForTask).mock.calls[0][1]).toEqual({ taskType: 'digest' })
  })

  it('is idempotent: skips (no compose, no delivery) when today was already sent', async () => {
    selectQueue.push([{ n: 1 }])
    const result = await runDailyMessageForUser(USER, { now: NOW })
    expect(result).toEqual({ status: 'skipped', reason: 'already sent today', date: DATE })
    expect(deliverKairosSpeak).not.toHaveBeenCalled()
    expect(gatherDailyMessageInputs).not.toHaveBeenCalled()
    expect(writeCronSuccessTrace).toHaveBeenCalledWith(USER, expect.objectContaining({ outcome: 'skipped' }))
  })

  it('treats a speak externalId dedup hit as skipped', async () => {
    selectQueue.push([{ n: 0 }])
    vi.mocked(deliverKairosSpeak).mockResolvedValue({
      status: 200,
      body: { id: 'm1', delivered: { inbox: false, telegram: false }, alreadyDelivered: true },
    })
    expect(await runDailyMessageForUser(USER, { now: NOW })).toMatchObject({ status: 'skipped' })
  })

  it("prefers the routine's done draft over calling the model", async () => {
    selectQueue.push([{ n: 0 }])
    vi.mocked(listJobs).mockResolvedValue([job()])
    const result = await runDailyMessageForUser(USER, { now: NOW })
    expect(result).toMatchObject({ status: 'sent', source: 'routine' })
    expect(ask).not.toHaveBeenCalled()
    expect(vi.mocked(deliverKairosSpeak).mock.calls[0][1].message).toMatch(/^\*\*Today\*\* routine draft\.\n\nWhat I now believe:/)
  })

  it('re-guards the routine draft and falls through to the model when it fails', async () => {
    selectQueue.push([{ n: 0 }])
    vi.mocked(listJobs).mockResolvedValue([job({ output: { draft: 'see https://x.io' } })])
    expect(await runDailyMessageForUser(USER, { now: NOW })).toMatchObject({ source: 'api' })
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('adds the idea of the day to a routine draft written before the tournament finished', async () => {
    selectQueue.push([{ n: 0 }])
    vi.mocked(gatherDailyMessageInputs).mockResolvedValue({
      ...INPUTS,
      idea: { title: 'Cut the PPA scope', claim: 'Cut it', survivedBecause: 'backed by 3 board pages', othersWaiting: 1 },
    })
    vi.mocked(listJobs).mockResolvedValue([job()])
    expect(await runDailyMessageForUser(USER, { now: NOW })).toMatchObject({ source: 'routine' })
    const sent = vi.mocked(deliverKairosSpeak).mock.calls[0][1].message
    expect(sent).toContain('**Today** routine draft.\n\nIdea of the day: Cut the PPA scope — survived because backed by 3 board pages (1 more in your inbox).')
  })

  it('does not repeat the idea when the routine draft already names it', async () => {
    selectQueue.push([{ n: 0 }])
    vi.mocked(gatherDailyMessageInputs).mockResolvedValue({
      ...INPUTS,
      idea: { title: 'Cut the PPA scope', claim: 'Cut it', survivedBecause: null, othersWaiting: 0 },
    })
    vi.mocked(listJobs).mockResolvedValue([job({ output: { draft: '**Today** Idea: cut the PPA scope first.' } })])
    await runDailyMessageForUser(USER, { now: NOW })
    expect(vi.mocked(deliverKairosSpeak).mock.calls[0][1].message).not.toContain('Idea of the day')
  })

  it('the paid compose sends the conscience block after the facts, system prompt unchanged', async () => {
    selectQueue.push([{ n: 0 }])
    vi.mocked(loadConscienceBlock).mockResolvedValue('## Conscience (reference data)\n1. Rest on Sundays')
    await runDailyMessageForUser(USER, { now: NOW })
    expect(loadConscienceBlock).toHaveBeenCalledWith(USER)
    const req = ask.mock.calls[0][0] as { system: string; prompt: string }
    expect(req.system).not.toContain('Rest on Sundays')
    expect(req.prompt).toMatch(/AEON[\s\S]*## Conscience \(reference data\)\n1\. Rest on Sundays$/)
  })

  it('ignores a routine job that is not done', async () => {
    selectQueue.push([{ n: 0 }])
    vi.mocked(listJobs).mockResolvedValue([job({ status: 'claimed' })])
    expect(await runDailyMessageForUser(USER, { now: NOW })).toMatchObject({ source: 'api' })
  })

  it.each([
    ['a # heading', { text: '{"message": "# Morning\\nbody"}', finishReason: 'stop' }],
    ['a URL', { text: '{"message": "read https://x.io"}', finishReason: 'stop' }],
    ['over-length', { text: JSON.stringify({ message: 'x'.repeat(1300) }), finishReason: 'stop' }],
    ['finishReason=length', { text: '{"message": "cut', finishReason: 'length' }],
    ['non-JSON', { text: 'Morning! all good', finishReason: 'stop' }],
  ])('guard: %s → deterministic fallback, traced', async (_label, response) => {
    selectQueue.push([{ n: 0 }])
    ask.mockResolvedValue(response)
    const result = await runDailyMessageForUser(USER, { now: NOW })
    expect(result).toMatchObject({ status: 'sent_fallback', source: 'deterministic' })
    const message = vi.mocked(deliverKairosSpeak).mock.calls[0][1].message
    expect(message).toContain('AEON: Ship the board fix.')
    expect(message).toContain('What I now believe:')
    expect(writeCronFailureTrace).toHaveBeenCalledWith(USER, expect.objectContaining({ cronName: 'daily-message', reason: 'model_call_failed' }))
  })

  it('a missing BYOK credential falls back without a failure trace', async () => {
    selectQueue.push([{ n: 0 }])
    vi.mocked(getProviderForTask).mockRejectedValue(new AiCredentialMissingError('anthropic' as never))
    expect(await runDailyMessageForUser(USER, { now: NOW })).toMatchObject({ status: 'sent_fallback' })
    expect(writeCronFailureTrace).not.toHaveBeenCalled()
  })

  it('dryRun composes and returns the message without the idempotency read or delivery', async () => {
    const result = await runDailyMessageForUser(USER, { now: NOW, dryRun: true })
    expect(result).toMatchObject({ status: 'dry_run', source: 'api', message: expect.stringContaining('model text') })
    expect(db.select).not.toHaveBeenCalled()
    expect(deliverKairosSpeak).not.toHaveBeenCalled()
    expect(writeCronSuccessTrace).not.toHaveBeenCalled()
  })

  it('reports a blocked delivery distinctly and traces it', async () => {
    selectQueue.push([{ n: 0 }])
    vi.mocked(deliverKairosSpeak).mockResolvedValue({ status: 429, body: { error: 'ceiling' } })
    expect(await runDailyMessageForUser(USER, { now: NOW })).toMatchObject({ status: 'blocked' })
    expect(writeCronFailureTrace).toHaveBeenCalledWith(USER, expect.objectContaining({ reason: 'delivery_blocked' }))
  })

  it('never throws: an idempotency-read failure is traced and reported', async () => {
    vi.mocked(db.select).mockImplementationOnce(() => { throw new Error('db down') })
    expect(await runDailyMessageForUser(USER, { now: NOW })).toMatchObject({ status: 'skipped', reason: 'db down' })
    expect(writeCronFailureTrace).toHaveBeenCalledWith(USER, expect.objectContaining({ reason: 'uncaught_exception' }))
  })
})

describe('single-flight delivery', () => {
  it('takes a transaction-scoped try-lock keyed on (userId, kairos-daily:<date>)', async () => {
    await runDailyMessageForUser(USER, { now: NOW })
    expect(db.transaction).toHaveBeenCalledTimes(1)
    const q = new PgDialect().sqlToQuery(advisory.keys[0] as SQL)
    expect(q.sql).toBe('select pg_try_advisory_xact_lock(hashtext($1), hashtext($2)) as locked')
    expect(q.params).toEqual([USER, `kairos-daily:${DATE}`])
  })

  it('two overlapping runs send once: the loser skips while the winner is still delivering', async () => {
    let release!: () => void
    vi.mocked(deliverKairosSpeak).mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({ status: 200, body: { id: 'm1', delivered: { inbox: true, telegram: true } } })
    }))
    const first = runDailyMessageForUser(USER, { now: NOW })
    await vi.waitFor(() => expect(deliverKairosSpeak).toHaveBeenCalledTimes(1))

    const second = await runDailyMessageForUser(USER, { now: NOW })
    expect(second).toEqual({ status: 'skipped', reason: 'delivery in flight', date: DATE })

    release()
    expect(await first).toMatchObject({ status: 'sent' })
    expect(deliverKairosSpeak).toHaveBeenCalledTimes(1)
  })

  it('re-checks under the lock: a run that lost the race to a committed send does not deliver', async () => {
    selectQueue.push([{ n: 0 }], [{ n: 1 }]) // early check clear, locked re-check finds today's row
    expect(await runDailyMessageForUser(USER, { now: NOW })).toEqual({ status: 'skipped', reason: 'already sent today', date: DATE })
    expect(deliverKairosSpeak).not.toHaveBeenCalled()
  })
})

describe('telegram not delivered', () => {
  it('reports sent_inbox_only and writes a failure trace instead of the ok trace', async () => {
    vi.mocked(deliverKairosSpeak).mockResolvedValue({ status: 200, body: { id: 'm1', delivered: { inbox: true, telegram: false } } })
    const result = await runDailyMessageForUser(USER, { now: NOW })
    expect(result).toMatchObject({ status: 'sent_inbox_only', date: DATE, source: 'api' })
    expect(writeCronFailureTrace).toHaveBeenCalledWith(USER, expect.objectContaining({
      cronName: 'daily-message',
      reason: 'telegram_not_delivered',
    }))
    expect(writeCronSuccessTrace).not.toHaveBeenCalled()
    expect(deliverKairosSpeak).toHaveBeenCalledTimes(1)
  })
})

describe('routine draft', () => {
  it('reads the draft from the completed job output only', () => {
    expect(readJobDraft(job())).toBe('**Today** routine draft.')
    expect(readJobDraft(job({ output: { draft: '   ' } }))).toBeNull()
    expect(readJobDraft(job({ output: null }))).toBeNull()
  })
})
