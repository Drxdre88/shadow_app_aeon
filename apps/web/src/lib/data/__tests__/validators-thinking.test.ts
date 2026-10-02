import { describe, expect, it } from 'vitest'
import { claimThinkingJobSchema } from '../validators/thinking'

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
})
