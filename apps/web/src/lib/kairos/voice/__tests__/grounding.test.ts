import { describe, expect, it } from 'vitest'
import { trimRetrievalForVoice, VOICE_GROUNDING } from '../grounding'
import { VoiceTurnClock } from '../timing'
import { voiceNeedsTools } from '../tool-intent'

const memory = (id: string, chars: number) => ({ id, title: id, body: 'y'.repeat(chars), streamClass: 'reflection' as const, createdAt: new Date() })

describe('trimRetrievalForVoice', () => {
  it('keeps the strongest few sources, in order, clipped short', () => {
    const trimmed = trimRetrievalForVoice({
      cortex: memory('aether', 5000),
      archetypes: Array.from({ length: 10 }, (_, i) => memory(`a${i}`, 2000)),
      substrate: Array.from({ length: 5 }, (_, i) => memory(`s${i}`, 2000)),
    })
    expect(trimmed.archetypes.map((a) => a.id)).toEqual(['a0', 'a1', 'a2'])
    expect(trimmed.substrate.map((s) => s.id)).toEqual(['s0', 's1', 's2', 's3'])
    expect(trimmed.cortex!.body.length).toBeLessThanOrEqual(VOICE_GROUNDING.cortexChars + 1)
    expect(trimmed.substrate.every((s) => s.body.length <= VOICE_GROUNDING.substrateChars + 1)).toBe(true)
  })

  it('leaves short bodies and an empty brain alone', () => {
    const short = memory('s', 10)
    expect(trimRetrievalForVoice({ cortex: null, archetypes: [], substrate: [short] })).toEqual({ cortex: null, archetypes: [], substrate: [short] })
  })
})

describe('voiceNeedsTools', () => {
  it.each([
    'How are you doing?',
    'What do you think about moving to Rust?',
    'Should I take the job?',
    'Explain prompt caching to me.',
    'Tell me a joke.',
  ])('answers from grounding: %s', (text) => {
    expect(voiceNeedsTools(text)).toBe(false)
  })

  it.each([
    "What's the latest on Swarm?",
    'Look it up.',
    'Can you check the build?',
    'What did I do today?',
    'How is the AS Sprint board?',
    'Undo that last belief.',
    'Did the overnight synthesis run?',
    'What happened with the deploy yesterday?',
  ])('reaches for a tool: %s', (text) => {
    expect(voiceNeedsTools(text)).toBe(true)
  })
})

describe('VoiceTurnClock', () => {
  it('keeps the first time of each mark, plus counts and facts', () => {
    let now = 1000
    const clock = new VoiceTurnClock(() => now)
    now = 1200
    clock.mark('grounded')
    now = 1500
    clock.mark('grounded')
    clock.mark('first_text')
    clock.count('toolRounds')
    clock.count('toolRounds')
    clock.note('tools', true)
    expect(clock.snapshot()).toEqual({ groundedMs: 200, firstTextMs: 500, toolRounds: 2, tools: true })
  })
})
