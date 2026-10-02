import { describe, expect, it } from 'vitest'
import { claimThinkingJobSchema, submitThinkingJobSchema } from '../validators/thinking'

describe('claimThinkingJobSchema', () => {
  it('accepts a claim without kinds', () => {
    expect(claimThinkingJobSchema.parse({})).toEqual({})
  })

  it('drops retired kinds so a pre-0.17 routine keeps claiming the rest', () => {
    const parsed = claimThinkingJobSchema.parse({
      kinds: ['brief', 'micro_consolidate', 'daily_message', 'drift_probe'],
    })
    expect(parsed.kinds).toEqual(['daily_message', 'drift_probe'])
  })

  it('leaves an empty filter when every named kind is retired', () => {
    expect(claimThinkingJobSchema.parse({ kinds: ['micro_consolidate'] }).kinds).toEqual([])
  })

  it('still rejects unknown kinds', () => {
    expect(claimThinkingJobSchema.safeParse({ kinds: ['nonsense'] }).success).toBe(false)
  })

  it('accepts routine brain or chat and rejects anything else', () => {
    expect(claimThinkingJobSchema.parse({ routine: 'brain' })).toEqual({ routine: 'brain' })
    expect(claimThinkingJobSchema.parse({ kinds: ['chat'], routine: 'chat' })).toEqual({ kinds: ['chat'], routine: 'chat' })
    expect(claimThinkingJobSchema.safeParse({ routine: 'ideas' }).success).toBe(false)
    expect(claimThinkingJobSchema.safeParse({ routine: 1 }).success).toBe(false)
  })
})

describe('submitThinkingJobSchema', () => {
  const base = { jobId: '22222222-2222-4222-8222-222222222222', claimToken: '33333333-3333-4333-8333-333333333333', text: 'x' }

  it('routine is optional', () => {
    expect(submitThinkingJobSchema.parse(base)).toEqual(base)
  })

  it('accepts routine brain or chat and rejects anything else', () => {
    expect(submitThinkingJobSchema.parse({ ...base, routine: 'chat' }).routine).toBe('chat')
    expect(submitThinkingJobSchema.parse({ ...base, routine: 'brain' }).routine).toBe('brain')
    expect(submitThinkingJobSchema.safeParse({ ...base, routine: 'routine:brain' }).success).toBe(false)
  })
})
