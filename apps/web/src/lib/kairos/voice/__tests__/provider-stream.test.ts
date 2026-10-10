import { describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test'
import { VercelAIProvider } from '@/lib/ai/provider'
import { VoiceTapProvider } from '../tap-provider'

vi.mock('@/lib/ai/router', () => ({}))
vi.mock('@/lib/ai/spend', () => ({ spendMeter: {} }))

const USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 3, text: 3, reasoning: 0 },
}

function streamingModel(chunks: unknown[], delayMs = 0) {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({ chunks: chunks as never[], chunkDelayInMs: delayMs }),
    }),
  })
}

const textParts = (pieces: string[]) => [
  { type: 'stream-start', warnings: [] },
  { type: 'text-start', id: 't' },
  ...pieces.map((delta) => ({ type: 'text-delta', id: 't', delta })),
  { type: 'text-end', id: 't' },
  { type: 'finish', finishReason: { unified: 'stop', raw: 'end_turn' }, usage: USAGE },
]

describe('the tool-less voice answer really streams through the SDK provider', () => {
  it('taps each text delta as the model produces it, before the answer resolves', async () => {
    const provider = new VercelAIProvider('anthropic', 'm', streamingModel(textParts(['Hello', ' there,', ' Andrey.']), 5))
    const seen: Array<{ text: string; at: number }> = []
    const started = Date.now()
    const tap = new VoiceTapProvider(provider, (text) => seen.push({ text, at: Date.now() - started }))
    const answer = await tap.ask({ messages: [{ role: 'user', content: 'hi' }] })
    expect(answer.text).toBe('Hello there, Andrey.')
    expect(seen.map((s) => s.text)).toEqual(['Hello', ' there,', ' Andrey.'])
    expect(seen[0].at).toBeLessThan(seen[2].at)
  })

  it('a provider error before any text falls back to ask() instead of ending silently', async () => {
    const model = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({ chunks: [{ type: 'stream-start', warnings: [] }, { type: 'error', error: new Error('overloaded') }] as never[] }),
      }),
      doGenerate: async () => ({
        content: [{ type: 'text', text: 'Fallback answer.' }],
        finishReason: { unified: 'stop', raw: 'end_turn' },
        usage: USAGE,
        warnings: [],
      }) as never,
    })
    const seen: string[] = []
    const tap = new VoiceTapProvider(new VercelAIProvider('anthropic', 'm', model), (text) => seen.push(text))
    const answer = await tap.ask({ messages: [{ role: 'user', content: 'hi' }] })
    expect(answer.text).toBe('Fallback answer.')
    expect(seen).toEqual(['Fallback answer.'])
  })
})
