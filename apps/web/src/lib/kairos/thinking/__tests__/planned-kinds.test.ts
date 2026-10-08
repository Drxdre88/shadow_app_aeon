import { describe, expect, it, vi } from 'vitest'

// The real registry imports every handler (and through them the DB module);
// nothing here touches the database.
vi.mock('@/lib/db', () => ({ db: {} }))

import { BRAIN_JOBS, ROUTINES, getRoutine } from '@/lib/kairos/routines/catalog'
import { PLANNED_THINKING_KINDS, SWEEP_PLAN_SKIP_KINDS } from '../queue'
import { getThinkingHandlers } from '../registry'
import { thinkingJobKindSchema } from '@/lib/data/validators/thinking'

// Every kind the queue plans must be answered by the brain routine and shown
// in the routine catalog — a forgotten or unrouted kind fails CI here.
describe('planned thinking kinds ↔ routine catalog', () => {
  const brainKinds = BRAIN_JOBS.map((j) => j.kind)

  it('the queue plans exactly the catalog kinds, minus chat (created by the Telegram webhook)', () => {
    expect(new Set(PLANNED_THINKING_KINDS)).toEqual(new Set(brainKinds.filter((k) => k !== 'chat')))
    expect(PLANNED_THINKING_KINDS).toHaveLength(new Set(PLANNED_THINKING_KINDS).size)
  })

  it('every registered handler is a catalog kind, and every catalog kind has a handler', () => {
    const handlerKinds = getThinkingHandlers().map((h) => h.kind)
    for (const kind of handlerKinds) expect(brainKinds).toContain(kind)
    expect(new Set(handlerKinds)).toEqual(new Set(brainKinds))
  })

  it('a routine can claim every catalog kind and nothing else', () => {
    expect(new Set(thinkingJobKindSchema.options)).toEqual(new Set(brainKinds))
  })

  it('the retired kinds stay retired', () => {
    for (const kind of ['brief', 'introspection', 'contradiction', 'micro_consolidate']) {
      expect(PLANNED_THINKING_KINDS as readonly string[]).not.toContain(kind)
      expect(thinkingJobKindSchema.safeParse(kind).success).toBe(false)
    }
  })

  it('routine scopes partition the catalog: brain ∪ pulse = planned kinds, chat = chat, no overlap', () => {
    const all = ROUTINES.flatMap((r) => [...r.allowedKinds])
    expect(new Set(all)).toEqual(new Set(brainKinds))
    expect(all).toHaveLength(new Set(all).size)
    expect(new Set([...getRoutine('brain').allowedKinds, ...getRoutine('pulse').allowedKinds])).toEqual(new Set(PLANNED_THINKING_KINDS))
    expect(getRoutine('pulse').allowedKinds).toEqual(['pulse'])
    expect(getRoutine('brain').allowedKinds).toContain('reflect')
    expect(getRoutine('chat').allowedKinds).toEqual(['chat'])
  })

  it('the routine tier decides scope: deep kinds on the brain, light kinds on the pulse', () => {
    for (const j of BRAIN_JOBS) {
      if (j.kind === 'chat') continue
      expect(getRoutine(j.tier === 'light' ? 'pulse' : 'brain').allowedKinds, j.kind).toContain(j.kind)
    }
  })

  it('Horae check-ins are a deep brain kind planned by claims and the sweep alike', () => {
    const row = BRAIN_JOBS.find((j) => j.kind === 'agenda_due')
    expect(row).toMatchObject({ label: 'Horae check-in', tier: 'deep' })
    expect(getRoutine('brain').allowedKinds).toContain('agenda_due')
    expect(PLANNED_THINKING_KINDS).toContain('agenda_due')
    expect(SWEEP_PLAN_SKIP_KINDS).not.toContain('agenda_due')
    expect(getThinkingHandlers().find((h) => h.kind === 'agenda_due')).toBeDefined()
  })

  it('AI DONE cards are a daily deep brain kind with a handler, planned by claims and the sweep', () => {
    expect(BRAIN_JOBS.find((j) => j.kind === 'ai_done')).toMatchObject({ label: 'AI DONE cards', area: 'Workforce', tier: 'deep', cadence: 'daily' })
    expect(getRoutine('brain').allowedKinds).toContain('ai_done')
    expect(PLANNED_THINKING_KINDS).toContain('ai_done')
    expect(SWEEP_PLAN_SKIP_KINDS).not.toContain('ai_done')
    expect(getThinkingHandlers().find((h) => h.kind === 'ai_done')).toBeDefined()
  })
})
