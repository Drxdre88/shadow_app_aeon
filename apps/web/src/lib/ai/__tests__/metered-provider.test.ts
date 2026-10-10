import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))

import type { AIProvider, AIRequest, AIResponse, StreamChunk } from '../provider'
import { MeteredProvider } from '../metered-provider'
import { SpendCapReached, type UsageEvent } from '../spend'

const CTX = { userId: 'u1', task: 'chat', providerId: 'anthropic', modelId: 'claude-opus-5-5' }
const USAGE = { inputTokens: 100, outputTokens: 20 }

function fakeMeter(refuse = false) {
  const events: UsageEvent[] = []
  return {
    events,
    check: vi.fn(async () => { if (refuse) throw new SpendCapReached(5, 5) }),
    record: vi.fn((e: UsageEvent) => { events.push(e) }),
  }
}

function fakeInner(opts: { fail?: Error; chunks?: string[] } = {}): AIProvider & { ask: ReturnType<typeof vi.fn> } {
  const ask = vi.fn(async (_req: AIRequest): Promise<AIResponse> => {
    if (opts.fail) throw opts.fail
    return { text: 'hi', providerId: 'byok', modelId: 'tier:heavy', usage: USAGE }
  })
  async function* stream(): AsyncIterable<StreamChunk> {
    for (const text of opts.chunks ?? ['a', 'b']) yield { text, providerId: 'byok', modelId: 'tier:heavy' }
    if (opts.fail) throw opts.fail
    yield { text: '', providerId: 'byok', modelId: 'tier:heavy', done: true, usage: USAGE }
  }
  return { providerId: 'byok', modelId: 'tier:heavy', ask, stream }
}

let t = 0
const clock = () => (t += 50)

beforeEach(() => {
  t = 0
})

describe('MeteredProvider.ask', () => {
  it('passes the response through and records usage on success', async () => {
    const meter = fakeMeter()
    const p = new MeteredProvider(fakeInner(), CTX, meter, clock)
    const res = await p.ask({ prompt: 'x' })
    expect(res.text).toBe('hi')
    expect(p.modelId).toBe('tier:heavy')
    expect(meter.events).toEqual([{ ...CTX, usage: USAGE, latencyMs: 50, ok: true }])
  })

  it('records the failure and rethrows the provider error unchanged', async () => {
    const meter = fakeMeter()
    const boom = new Error('overloaded')
    const p = new MeteredProvider(fakeInner({ fail: boom }), CTX, meter, clock)
    await expect(p.ask({ prompt: 'x' })).rejects.toBe(boom)
    expect(meter.events).toEqual([{ ...CTX, usage: undefined, latencyMs: 50, ok: false, error: boom }])
  })

  it('refuses at the cap without calling the model or recording', async () => {
    const meter = fakeMeter(true)
    const inner = fakeInner()
    const p = new MeteredProvider(inner, CTX, meter, clock)
    await expect(p.ask({ prompt: 'x' })).rejects.toBeInstanceOf(SpendCapReached)
    expect(inner.ask).not.toHaveBeenCalled()
    expect(meter.record).not.toHaveBeenCalled()
  })

  it('a throwing recorder never fails the call', async () => {
    const meter = fakeMeter()
    meter.record.mockImplementation(() => { throw new Error('log broke') })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const p = new MeteredProvider(fakeInner(), CTX, meter, clock)
    await expect(p.ask({ prompt: 'x' })).resolves.toMatchObject({ text: 'hi' })
    warn.mockRestore()
  })
})

describe('MeteredProvider.stream', () => {
  async function drain(it: AsyncIterable<StreamChunk>): Promise<string> {
    let text = ''
    for await (const c of it) text += c.text
    return text
  }

  it('records the final usage once the stream ends', async () => {
    const meter = fakeMeter()
    const p = new MeteredProvider(fakeInner(), CTX, meter, clock)
    expect(await drain(p.stream({ prompt: 'x' }))).toBe('ab')
    expect(meter.events).toEqual([{ ...CTX, usage: USAGE, latencyMs: 50, ok: true }])
  })

  it('records a mid-stream error once and rethrows', async () => {
    const meter = fakeMeter()
    const boom = new Error('reset')
    const p = new MeteredProvider(fakeInner({ fail: boom }), CTX, meter, clock)
    await expect(drain(p.stream({ prompt: 'x' }))).rejects.toBe(boom)
    expect(meter.events).toHaveLength(1)
    expect(meter.events[0]).toMatchObject({ ok: false, error: boom })
  })

  it('records an abandoned stream as not ok', async () => {
    const meter = fakeMeter()
    const p = new MeteredProvider(fakeInner(), CTX, meter, clock)
    for await (const _c of p.stream({ prompt: 'x' })) break
    expect(meter.events).toHaveLength(1)
    expect(meter.events[0]).toMatchObject({ ok: false })
  })

  it('refuses at the cap before the first chunk', async () => {
    const meter = fakeMeter(true)
    const p = new MeteredProvider(fakeInner(), CTX, meter, clock)
    await expect(drain(p.stream({ prompt: 'x' }))).rejects.toBeInstanceOf(SpendCapReached)
    expect(meter.record).not.toHaveBeenCalled()
  })
})
