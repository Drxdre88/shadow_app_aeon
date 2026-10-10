import { beforeEach, describe, expect, it, vi } from 'vitest'

// The voice line sees the cap only as a provider failure: the paid key's
// provider throws SpendCapReached and the turn ends with one error event.
const h = vi.hoisted(() => ({
  selects: [] as unknown[][],
  meter: { check: vi.fn(async () => {}), record: vi.fn() },
}))

vi.mock('@/lib/db', () => {
  const chain = (rows: unknown[]) => {
    const c: Record<string, unknown> = {}
    c.from = () => c
    c.where = () => c
    c.orderBy = () => c
    c.limit = () => c
    c.set = () => c
    c.catch = () => Promise.resolve()
    c.then = (resolve: (v: unknown[]) => unknown) => resolve(rows)
    return c
  }
  return { db: { select: vi.fn(() => chain(h.selects.shift() ?? [])), update: vi.fn(() => chain([])) } }
})
vi.mock('@/lib/kairos/paid-backup', () => ({ isPaidBackupEnabled: vi.fn(async () => true) }))
vi.mock('../crypto', () => ({ decryptSecret: vi.fn(() => 'sk-test') }))
vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic: vi.fn(() => (modelId: string) => ({ modelId })) }))
vi.mock('../spend', async (importOriginal) => ({ ...(await importOriginal<typeof import('../spend')>()), spendMeter: h.meter }))

import { getProviderForTask } from '../route-task'
import { SpendCapReached } from '../spend'
import type { AIProvider } from '../provider'
import { VoiceTapProvider } from '@/lib/kairos/voice/tap-provider'
import { createVoiceTurnStream, type VoiceTurnOutcome } from '@/lib/kairos/voice/turn-stream'

const CRED = { id: 'c1', ciphertext: 'x', iv: 'y', authTag: 'z' }

async function voiceProvider(): Promise<AIProvider> {
  h.selects = [[], [CRED]]
  return (await getProviderForTask('u1', { taskType: 'voice_chat' })).provider
}

async function readEvents(stream: ReadableStream<Uint8Array>): Promise<Array<{ event: string; data: Record<string, unknown> }>> {
  const text = await new Response(stream).text()
  return text.trim().split('\n\n').map((frame) => {
    const [ev, data] = frame.split('\n')
    return { event: ev.replace('event: ', ''), data: JSON.parse(data.replace('data: ', '')) }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  h.meter.check.mockImplementation(async () => { throw new SpendCapReached(5.2, 5) })
})

describe('daily spend cap on the voice line', () => {
  it('meters the voice provider under its task and pinned model', async () => {
    h.meter.check.mockResolvedValue(undefined)
    const provider = await voiceProvider()
    expect(provider.modelId).toBe('claude-sonnet-5-5')
    await provider.ask({ prompt: 'x' }).catch(() => {})
    expect(h.meter.check).toHaveBeenCalledWith('u1')
    expect(h.meter.record).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', task: 'voice_chat', providerId: 'anthropic', modelId: 'claude-sonnet-5-5' }))
  })

  it('an engine that reports the provider failure ends the turn with an error event', async () => {
    const provider = await voiceProvider()
    const stream = createVoiceTurnStream(async (onText): Promise<VoiceTurnOutcome> => {
      const tapped = new VoiceTapProvider(provider, onText)
      try {
        await tapped.ask({ messages: [{ role: 'user', content: 'hello' }] })
        return { ok: false, reason: 'unexpected' }
      } catch (err) {
        return { ok: false, reason: 'ai_failed', message: (err as Error).message, threadId: 't1' }
      }
    })
    const events = await readEvents(stream)
    expect(events).toHaveLength(1)
    expect(events[0].event).toBe('error')
    expect(events[0].data).toMatchObject({ reason: 'ai_failed', threadId: 't1' })
    expect(String(events[0].data.message)).toMatch(/daily AI budget reached/)
  })

  it('an uncaught cap error still ends the turn with one error event and no speech', async () => {
    const provider = await voiceProvider()
    const stream = createVoiceTurnStream(async (onText) => {
      await new VoiceTapProvider(provider, onText).ask({ messages: [{ role: 'user', content: 'hello' }] })
      return { ok: false, reason: 'unreachable' }
    })
    const events = await readEvents(stream)
    expect(events.map((e) => e.event)).toEqual(['error'])
    expect(String(events[0].data.message)).toMatch(/daily AI budget reached/)
  })
})
