import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))

import { getProviderWithKey } from '../provider'

// Capture the raw HTTP request the Vercel AI SDK sends to the provider so we
// can assert on the actual Anthropic wire body (cache_control placement).
function anthropicResponse() {
  return new Response(
    JSON.stringify({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5-5',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

describe('Anthropic prompt caching (BYOK path)', () => {
  let bodies: Array<Record<string, unknown>>

  beforeEach(() => {
    bodies = []
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return anthropicResponse()
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('cacheSystem places a cache_control breakpoint on the system block', async () => {
    const provider = await getProviderWithKey('anthropic', 'claude-sonnet-5-5', 'sk-ant-test')
    const res = await provider.ask({
      system: 'STATIC INSTRUCTIONS',
      prompt: 'dynamic payload',
      cacheSystem: true,
      maxTokens: 100,
    })

    expect(res.text).toBe('ok')
    expect(bodies).toHaveLength(1)
    const body = bodies[0]

    // System must be a block array carrying the ephemeral cache breakpoint.
    expect(body.system).toEqual([
      expect.objectContaining({
        type: 'text',
        text: 'STATIC INSTRUCTIONS',
        cache_control: { type: 'ephemeral' },
      }),
    ])

    // The dynamic payload rides as the user message, uncached.
    const messages = body.messages as Array<{ role: string; content: unknown }>
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('user')
    expect(JSON.stringify(messages[0])).not.toContain('cache_control')
  })

  it('forwards the per-call output cap to the wire (maxOutputTokens rename)', async () => {
    const provider = await getProviderWithKey('anthropic', 'claude-sonnet-5-5', 'sk-ant-test')
    await provider.ask({ prompt: 'dynamic payload', maxTokens: 123 })

    expect(bodies).toHaveLength(1)
    // AI SDK v5+ only serializes max_tokens from `maxOutputTokens`; the old
    // `maxTokens` kwarg is silently dropped and the SDK default wins.
    expect(bodies[0].max_tokens).toBe(123)
  })

  it('without cacheSystem the request carries no cache_control', async () => {
    const provider = await getProviderWithKey('anthropic', 'claude-sonnet-5-5', 'sk-ant-test')
    await provider.ask({ system: 'STATIC INSTRUCTIONS', prompt: 'dynamic payload', maxTokens: 100 })

    expect(bodies).toHaveLength(1)
    expect(JSON.stringify(bodies[0])).not.toContain('cache_control')
  })

  it('is a no-op for non-Anthropic BYOK providers', async () => {
    const provider = await getProviderWithKey('openai', 'gpt-6.1-sol', 'sk-test')
    // The mocked response is Anthropic-shaped, so the OpenAI provider may
    // fail to parse it — we only care about the outbound request body.
    await provider
      .ask({ system: 'STATIC INSTRUCTIONS', prompt: 'dynamic payload', cacheSystem: true, maxTokens: 100 })
      .catch(() => {})

    expect(bodies.length).toBeGreaterThan(0)
    for (const body of bodies) {
      expect(JSON.stringify(body)).not.toContain('cache_control')
    }
  })
})

// Effort rides call-level providerOptions; these lock the actual wire shape
// the installed SDK sends, not just the options object we build.
describe('effort on the wire (BYOK path)', () => {
  let bodies: Array<Record<string, unknown>>

  beforeEach(() => {
    bodies = []
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return anthropicResponse()
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends Anthropic effort as output_config.effort', async () => {
    const provider = await getProviderWithKey('anthropic', 'claude-opus-5-5', 'sk-ant-test', 'high')
    await provider.ask({ prompt: 'x', maxTokens: 50 })
    expect(bodies[0].output_config).toMatchObject({ effort: 'high' })
  })

  it('defaults to the model registry effort when none is given', async () => {
    const provider = await getProviderWithKey('anthropic', 'claude-opus-5-5', 'sk-ant-test')
    await provider.ask({ prompt: 'x', maxTokens: 50 })
    expect(bodies[0].output_config).toMatchObject({ effort: 'medium' })
  })

  it('drops temperature for Opus 5.5, which rejects sampling parameters', async () => {
    const provider = await getProviderWithKey('anthropic', 'claude-opus-5-5', 'sk-ant-test')
    await provider.ask({ prompt: 'x', maxTokens: 50, temperature: 0.2 })
    expect(bodies[0]).not.toHaveProperty('temperature')
  })

  it('sends no effort for Haiku 4.5, which has no effort parameter', async () => {
    const provider = await getProviderWithKey('anthropic', 'claude-haiku-4-5', 'sk-ant-test')
    await provider.ask({ prompt: 'x', maxTokens: 50 })
    expect(JSON.stringify(bodies[0])).not.toContain('effort')
  })

  it('sends OpenAI effort as reasoning.effort for GPT-6', async () => {
    const provider = await getProviderWithKey('openai', 'gpt-6.1-sol', 'sk-test', 'high')
    await provider.ask({ prompt: 'x', maxTokens: 50 }).catch(() => {})
    expect(bodies[0].reasoning).toMatchObject({ effort: 'high' })
  })
})
