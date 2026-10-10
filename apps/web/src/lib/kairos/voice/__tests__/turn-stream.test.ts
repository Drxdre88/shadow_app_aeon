import { describe, expect, it, vi } from 'vitest'
import type { AIProvider, AIRequest, AIResponse, StreamChunk } from '@/lib/ai/provider'
import { createVoiceTurnStream, sseFrame } from '../turn-stream'
import { VoiceTapProvider } from '../tap-provider'
import { VoiceTurnClock } from '../timing'

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

  it('records the first call, tool rounds, the first text and the prompt size on the clock', async () => {
    let now = 0
    const clock = new VoiceTurnClock(() => now)
    const ask = vi.fn()
      .mockResolvedValueOnce({ text: '', providerId: 'byok', modelId: 'm', toolCalls: [{ toolCallId: '1', toolName: 't', input: {} }] })
    const tap = new VoiceTapProvider(fakeProvider({ ask }), () => {}, clock)
    now = 100
    await tap.ask(withTools)
    now = 400
    await tap.ask(plain)
    expect(clock.snapshot()).toEqual({ modelCallMs: 100, firstTextMs: 400, answerEndMs: 400, toolRounds: 1, plainCalls: 1, promptChars: 2 })
  })
})

describe('voice turn end to end over the tap', () => {
  it('streams token deltas as whole sentences, in order, before done', async () => {
    const tokens = ['The build ', 'is green. ', 'Two tests ', 'were flaky. ', 'Want the list?']
    const inner = fakeProvider({
      stream: async function* (): AsyncIterable<StreamChunk> {
        for (const text of tokens) yield { text, providerId: 'byok', modelId: 'm' }
      },
    })
    const frames = parseFrames(await readAll(createVoiceTurnStream(async (onText) => {
      const tap = new VoiceTapProvider(inner, onText)
      const answer = await tap.ask({ messages: [{ role: 'user', content: 'how is the build?' }] })
      tap.seal()
      return { ok: true, done: { ...DONE, text: answer.text } }
    })))
    expect(frames.map((f) => f.event)).toEqual(['delta', 'delta', 'delta', 'done'])
    expect(frames.slice(0, 3).map((f) => f.data.text)).toEqual(['The build is green.', 'Two tests were flaky.', 'Want the list?'])
    expect(frames[3].data).toMatchObject({ streamed: true, replaced: false })
  })
})

describe('voice turn ack, early last piece and timing', () => {
  it('sends ack first, before the engine has produced anything', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const stream = createVoiceTurnStream(async (onText) => {
      await gate
      onText('Hi.')
      return { ok: true, done: { ...DONE, text: 'Hi.' } }
    }, undefined, { ack: { threadId: 't1' } })
    const reader = stream.getReader()
    const first = new TextDecoder().decode((await reader.read()).value)
    expect(first).toBe('event: ack\ndata: {"threadId":"t1"}\n\n')
    release()
    let rest = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      rest += new TextDecoder().decode(value)
    }
    expect(parseFrames(rest).map((f) => f.event)).toEqual(['delta', 'done'])
  })

  it('speaks the last piece when the answer ends, not after the save', async () => {
    const seen: string[] = []
    let saved: () => void = () => {}
    const save = new Promise<void>((resolve) => { saved = resolve })
    const stream = createVoiceTurnStream(async (onText, onEnd) => {
      onText('Hello there')
      onEnd()
      await save
      return { ok: true, done: { ...DONE, text: 'Hello there' } }
    })
    const reader = stream.getReader()
    seen.push(new TextDecoder().decode((await reader.read()).value))
    expect(parseFrames(seen[0])).toEqual([{ event: 'delta', data: { text: 'Hello there' } }])
    saved()
    const tail = new TextDecoder().decode((await reader.read()).value)
    expect(parseFrames(tail)[0]).toMatchObject({ event: 'done', data: { streamed: true, replaced: false } })
  })

  it('done carries the timing object built from the stream times', async () => {
    const frames = parseFrames(await readAll(createVoiceTurnStream(async (onText) => {
      onText('Hi there.')
      return { ok: true, done: DONE }
    }, undefined, { timing: (t) => ({ deltas: t.deltas, ok: t.ok, sawFirst: t.firstDeltaMs !== null }) })))
    expect(frames.at(-1)!.data.timing).toEqual({ deltas: 1, ok: true, sawFirst: true })
  })

  it('without the options nothing extra is framed', async () => {
    const frames = parseFrames(await readAll(createVoiceTurnStream(async () => ({ ok: true, done: DONE }))))
    expect(frames.map((f) => f.event)).toEqual(['done'])
    expect(frames[0].data).not.toHaveProperty('timing')
  })

  it('the tap ends the answer once its stream is done, before ask() resolves to the engine', async () => {
    const order: string[] = []
    const tap = new VoiceTapProvider(fakeProvider(), (t) => order.push(`text:${t}`), undefined, () => order.push('end'))
    await tap.ask({ messages: [{ role: 'user', content: 'hi' }] })
    order.push('resolved')
    expect(order).toEqual(['text:Str', 'text:eamed.', 'end', 'resolved'])
  })
})

describe('VoiceTurnClock.payload', () => {
  it('turns marks and spans into stage durations on the request clock', () => {
    let now = 1000
    const clock = new VoiceTurnClock(() => now)
    now = 1080; clock.mark('accepted')
    clock.span('thread', 140)
    clock.span('retrieval', 420.4)
    clock.span('embedding', 180)
    clock.span('section:today', 95)
    clock.span('section:pendingAsk', 160)
    now = 1600; clock.mark('grounded')
    clock.note('promptChars', 9000)
    clock.note('tools', false)
    now = 1610; clock.mark('model_call'); clock.count('plainCalls')
    now = 2400; clock.mark('first_text')
    now = 3100; clock.mark('answer_end')
    now = 3110; clock.mark('answered')
    now = 3500; clock.mark('saved')

    expect(clock.payload({ firstDeltaMs: 1350, totalMs: 2440, deltas: 3 }, 80)).toEqual({
      routeMs: 80,
      threadMs: 140,
      retrievalMs: 420,
      embeddingMs: 180,
      rerankMs: null,
      sections: { today: 95, pendingAsk: 160 },
      groundedMs: 600,
      promptChars: 9000,
      modelCallMs: 610,
      modelFirstTokenMs: 790,
      modelTotalMs: 1490,
      saveMs: 390,
      firstDeltaMs: 1430,
      totalMs: 2520,
      deltas: 3,
      tools: false,
      toolRounds: 0,
      plainCalls: 1,
    })
  })
})