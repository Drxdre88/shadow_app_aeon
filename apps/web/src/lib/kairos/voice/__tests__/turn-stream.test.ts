import { describe, expect, it, vi } from 'vitest'
import type { AIProvider, AIRequest, AIResponse, StreamChunk } from '@/lib/ai/provider'
import { createVoiceTurnStream, sseFrame } from '../turn-stream'
import { VoiceTapProvider } from '../tap-provider'

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let out = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return out
    out += decoder.decode(value, { stream: true })
  }
}

function parseFrames(raw: string): Array<{ event: string; data: Record<string, unknown> }> {
  return raw.split('\n\n').filter(Boolean).map((frame) => {
    const [eventLine, dataLine] = frame.split('\n')
    return { event: eventLine.replace('event: ', ''), data: JSON.parse(dataLine.replace('data: ', '')) }
  })
}

const DONE = { threadId: 't1', userSeq: 1, assistantSeq: 2, text: 'Done text.', model: 'tier:heavy' }

describe('voice turn SSE framing', () => {
  it('frames one event as event + JSON data line + blank line', () => {
    expect(sseFrame('delta', { text: 'Hi.' })).toBe('event: delta\ndata: {"text":"Hi."}\n\n')
  })

  it('streams sentence deltas, then one done with ids', async () => {
    const stream = createVoiceTurnStream(async (onText) => {
      onText('The build is **stuck** [[abc')
      onText('d]]. Want me to look?')
      return { ok: true, done: DONE }
    })
    const frames = parseFrames(await readAll(stream))
    expect(frames.map((f) => f.event)).toEqual(['delta', 'delta', 'done'])
    expect(frames[0].data).toEqual({ text: 'The build is stuck.' })
    expect(frames[1].data).toEqual({ text: 'Want me to look?' })
    expect(frames[2].data).toMatchObject({ threadId: 't1', userSeq: 1, assistantSeq: 2, text: 'Done text.', streamed: true, replaced: true })
  })

  it('done.text is the saved reply; replaced only when the words differ from what was spoken', async () => {
    const same = parseFrames(await readAll(createVoiceTurnStream(async (onText) => {
      onText('The build is stuck. Want me to look?')
      return { ok: true, done: { ...DONE, text: 'The build is stuck; want me to look?' } }
    })))
    expect(same.at(-1)).toMatchObject({ event: 'done', data: { text: 'The build is stuck; want me to look?', replaced: false } })
    const swapped = parseFrames(await readAll(createVoiceTurnStream(async (onText) => {
      onText('Half an answer.')
      return { ok: true, done: { ...DONE, text: 'I ran out of time.' } }
    })))
    expect(swapped.at(-1)).toMatchObject({ event: 'done', data: { text: 'I ran out of time.', streamed: true, replaced: true } })
  })

  it('text pushed after the turn returned is never framed', async () => {
    let late: ((t: string) => void) | null = null
    const frames = parseFrames(await readAll(createVoiceTurnStream(async (onText) => {
      late = onText
      return { ok: true, done: DONE }
    })))
    late!('Too late. ')
    expect(frames.map((f) => f.event)).toEqual(['done'])
  })

  it('without deltas the full text arrives in a single done event', async () => {
    const frames = parseFrames(await readAll(createVoiceTurnStream(async () => ({ ok: true, done: DONE }))))
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({ event: 'done', data: { text: 'Done text.', streamed: false } })
  })

  it('an engine failure or throw ends with one error event', async () => {
    const failed = parseFrames(await readAll(createVoiceTurnStream(async () => ({ ok: false, reason: 'ai_failed', message: 'boom', threadId: 't1' }))))
    expect(failed).toEqual([{ event: 'error', data: { reason: 'ai_failed', message: 'boom', threadId: 't1' } }])
    const thrown = parseFrames(await readAll(createVoiceTurnStream(async () => { throw new Error('kaput') })))
    expect(thrown[0]).toMatchObject({ event: 'error', data: { reason: 'ai_failed', message: 'kaput' } })
  })
})

function fakeProvider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    providerId: 'byok',
    modelId: 'tier:heavy',
    ask: vi.fn(async (): Promise<AIResponse> => ({ text: 'Asked.', providerId: 'byok', modelId: 'tier:heavy' })),
    stream: async function* (): AsyncIterable<StreamChunk> {
      yield { text: 'Str', providerId: 'byok', modelId: 'tier:heavy' }
      yield { text: 'eamed.', providerId: 'byok', modelId: 'tier:heavy' }
      yield { text: '', providerId: 'byok', modelId: 'tier:heavy', done: true, usage: { outputTokens: 3 } }
    },
    ...overrides,
  }
}

describe('VoiceTapProvider', () => {
  const plain: AIRequest = { messages: [{ role: 'user', content: 'hi' }] }
  const withTools: AIRequest = { ...plain, tools: { t: { description: 'd', inputSchema: {} as never } } }

  it('streams a tool-less answer and disarms for later calls', async () => {
    const seen: string[] = []
    const inner = fakeProvider()
    const tap = new VoiceTapProvider(inner, (t) => seen.push(t))
    const res = await tap.ask(plain)
    expect(res.text).toBe('Streamed.')
    expect(seen).toEqual(['Str', 'eamed.'])
    expect(tap.answerUsage).toEqual({ outputTokens: 3 })
    await tap.ask(plain)
    expect(seen).toHaveLength(2)
    expect(inner.ask).toHaveBeenCalledTimes(1)
  })

  it('taps a tool round only when it is the answer', async () => {
    const seen: string[] = []
    const ask = vi.fn()
      .mockResolvedValueOnce({ text: 'Let me check.', providerId: 'byok', modelId: 'm', toolCalls: [{ toolCallId: '1', toolName: 't', input: {} }] })
      .mockResolvedValueOnce({ text: 'All green.', providerId: 'byok', modelId: 'm' })
    const tap = new VoiceTapProvider(fakeProvider({ ask }), (t) => seen.push(t))
    await tap.ask(withTools)
    expect(seen).toEqual([])
    await tap.ask(withTools)
    expect(seen).toEqual(['All green.'])
  })

  it('a tool round that resolves after the answer was tapped stays silent', async () => {
    const seen: string[] = []
    let resolveSlow: (r: AIResponse) => void = () => {}
    const slow = new Promise<AIResponse>((resolve) => { resolveSlow = resolve })
    const ask = vi.fn()
      .mockReturnValueOnce(slow)
      .mockResolvedValueOnce({ text: 'Real answer.', providerId: 'byok', modelId: 'm' })
    const tap = new VoiceTapProvider(fakeProvider({ ask }), (t) => seen.push(t))
    const lost = tap.ask(withTools) // the round that loses the deadline race
    await tap.ask(withTools)
    resolveSlow({ text: 'Stale answer.', providerId: 'byok', modelId: 'm' })
    await lost
    expect(seen).toEqual(['Real answer.'])
  })

  it('after seal() nothing is tapped, not even a late tool round or stream chunk', async () => {
    const seen: string[] = []
    let resolveSlow: (r: AIResponse) => void = () => {}
    const ask = vi.fn().mockReturnValueOnce(new Promise<AIResponse>((resolve) => { resolveSlow = resolve }))
    const tap = new VoiceTapProvider(fakeProvider({ ask }), (t) => seen.push(t))
    const pending = tap.ask(withTools)
    tap.seal()
    resolveSlow({ text: 'After the engine returned.', providerId: 'byok', modelId: 'm' })
    await pending
    await tap.ask(plain)
    expect(seen).toEqual([])
  })

  it('falls back to ask() when stream() fails before any text', async () => {
    const seen: string[] = []
    const stream = async function* (): AsyncIterable<StreamChunk> { throw new Error('no stream') }
    const tap = new VoiceTapProvider(fakeProvider({ stream }), (t) => seen.push(t))
    expect((await tap.ask(plain)).text).toBe('Asked.')
    expect(seen).toEqual(['Asked.'])
  })
})
