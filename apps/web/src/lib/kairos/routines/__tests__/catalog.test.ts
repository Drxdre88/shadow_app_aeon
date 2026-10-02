import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))

import {
  BRAIN_JOBS,
  KAIROS_ROUTINE_MODEL,
  ROUTINES,
  getRoutine,
  routinePrompt,
  routineScheduleRequest,
} from '../catalog'
import { getThinkingHandlers } from '@/lib/kairos/thinking/registry'

const THINKING_TOOLS = ['claim_thinking_job', 'submit_thinking_job', 'list_thinking_jobs']

// Minimal cron field expander (numbers, *, ranges, lists, steps).
function expandField(field: string, min: number, max: number): number[] {
  const out = new Set<number>()
  for (const part of field.split(',')) {
    const [range, stepRaw] = part.split('/')
    const step = stepRaw === undefined ? 1 : Number(stepRaw)
    if (!Number.isInteger(step) || step < 1) throw new Error(`bad step in ${field}`)
    let lo: number
    let hi: number
    if (range === '*') { lo = min; hi = max } else if (range.includes('-')) {
      ;[lo, hi] = range.split('-').map(Number)
    } else {
      lo = Number(range); hi = stepRaw === undefined ? lo : max
    }
    if (![lo, hi].every(Number.isInteger) || lo < min || hi > max || lo > hi) throw new Error(`bad field ${field}`)
    for (let v = lo; v <= hi; v += step) out.add(v)
  }
  return [...out].sort((a, b) => a - b)
}

function dailyRunMinutes(cron: string): number[] {
  const fields = cron.trim().split(/\s+/)
  if (fields.length !== 5) throw new Error(`cron must have 5 fields: ${cron}`)
  const [minute, hour, dom, month, dow] = fields
  expandField(dom, 1, 31)
  expandField(month, 1, 12)
  expandField(dow, 0, 7)
  const minutes = expandField(minute, 0, 59)
  return expandField(hour, 0, 23).flatMap((h) => minutes.map((m) => h * 60 + m))
}

describe('ROUTINES', () => {
  it('every routine runs on the Opus routine model', () => {
    expect(ROUTINES.length).toBeGreaterThan(0)
    for (const r of ROUTINES) expect(r.model).toBe('claude-opus-5-5')
    expect(KAIROS_ROUTINE_MODEL).toBe('claude-opus-5-5')
  })

  it('ids are unique and getRoutine finds each', () => {
    expect(new Set(ROUTINES.map((r) => r.id)).size).toBe(ROUTINES.length)
    for (const r of ROUTINES) expect(getRoutine(r.id)).toBe(r)
  })

  it('scheduled routines have a valid 5-field cron, at most hourly; API routines have none', () => {
    for (const r of ROUTINES) {
      if (r.trigger === 'api') { expect(r.cronUtc).toBeNull(); continue }
      expect(r.cronUtc).toBeTruthy()
      const runs = dailyRunMinutes(r.cronUtc!)
      expect(runs.length).toBeGreaterThan(0)
      const gaps = runs.slice(1).map((m, i) => m - runs[i])
      // Wrap-around from the last run to the next day's first.
      gaps.push(runs[0] + 24 * 60 - runs[runs.length - 1])
      for (const g of gaps) expect(g).toBeGreaterThanOrEqual(60)
    }
  })

  it('the brain routine runs hourly through the night', () => {
    const brain = getRoutine('brain')
    expect(brain.trigger).toBe('schedule')
    const runs = dailyRunMinutes(brain.cronUtc!)
    expect(runs.length).toBeGreaterThan(1)
    expect(runs.slice(1).every((m, i) => m - runs[i] === 60)).toBe(true)
  })
})

describe('routinePrompt', () => {
  it('brain claims with {} so the server decides what is due', () => {
    const prompt = routinePrompt(getRoutine('brain'))
    expect(getRoutine('brain').claimKinds).toBeNull()
    expect(prompt).toContain('Call claim_thinking_job with {}.')
    expect(prompt).not.toMatch(/"kinds"/)
  })

  it('chat claims only chat jobs', () => {
    const prompt = routinePrompt(getRoutine('chat'))
    const match = prompt.match(/claim_thinking_job with (\{[^\n]*?\})\./)
    expect(match).not.toBeNull()
    expect(JSON.parse(match![1])).toEqual({ kinds: ['chat'] })
  })

  it('the chat routine is channel-neutral: it serves Telegram and the Kairos page', () => {
    const chat = getRoutine('chat')
    expect(chat.claimKinds).toEqual(['chat'])
    expect(chat.purpose).toContain('on Telegram and on the Kairos page')
    expect(chat.scheduleLabel).not.toMatch(/Telegram/)
    const prompt = routinePrompt(chat)
    expect(prompt).toMatch(/Telegram or on the Kairos page/)
    expect(prompt).not.toMatch(/answering the owner on Telegram\./)
  })

  it.each(ROUTINES.map((r) => [r.id, r] as const))('%s prompt never asks to read a repository or doc file', (_id, r) => {
    const prompt = routinePrompt(r)
    expect(prompt).not.toMatch(/repositor|\brepo\b|\.md\b|docs\/|CLAUDE\.md|AGENTS\.md|README|read the file|open the file/i)
  })

  it.each(ROUTINES.map((r) => [r.id, r] as const))('%s prompt names only the thinking tools', (_id, r) => {
    const prompt = routinePrompt(r)
    const toolLike = prompt.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []
    expect(toolLike.length).toBeGreaterThan(0)
    for (const name of toolLike) expect(THINKING_TOOLS).toContain(name)
    expect(prompt).toContain('claim_thinking_job')
    expect(prompt).toContain('submit_thinking_job')
  })

  it('brain prompt states its job and time limits', () => {
    const brain = getRoutine('brain')
    const prompt = routinePrompt(brain)
    expect(prompt).toContain(`after ${brain.maxJobs} jobs`)
    expect(prompt).toContain(`after ${brain.maxMinutes} minutes`)
  })
})

describe('routineScheduleRequest', () => {
  it.each(ROUTINES.map((r) => [r.id, r] as const))('%s request embeds the full prompt, model and trigger', (_id, r) => {
    const req = routineScheduleRequest(r, 'any repository')
    expect(req).toContain(routinePrompt(r))
    expect(req).toContain(`Model: ${r.model}.`)
    expect(req).toContain(`"${r.name}"`)
    if (r.cronUtc) expect(req).toContain(`cron "${r.cronUtc}"`)
    else expect(req).toMatch(/API trigger/)
  })
})

describe('BRAIN_JOBS', () => {
  it('kinds are unique', () => {
    expect(new Set(BRAIN_JOBS.map((j) => j.kind)).size).toBe(BRAIN_JOBS.length)
  })

  it('every kind has a registered thinking handler', () => {
    const registered = new Set(getThinkingHandlers().map((h) => h.kind))
    for (const j of BRAIN_JOBS) expect(registered.has(j.kind), j.kind).toBe(true)
  })

  it('the chat routine claims a kind the brain catalog lists', () => {
    for (const k of getRoutine('chat').claimKinds ?? []) {
      expect(BRAIN_JOBS.some((j) => j.kind === k)).toBe(true)
    }
  })
})
