import { NextRequest } from 'next/server'
import { generateText } from 'ai'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { buildModelWithKey } from '@/lib/ai/router'
import { isValidProvider, getModelDescriptor, DEFAULT_PREFERENCES, type ProviderId } from '@/lib/ai/providers'

function requireAdmin(result: { id: string; role: string }) {
  return result.role === 'admin' ? null : jsonError('AI features restricted to administrators', 403)
}

export const POST = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const forbidden = requireAdmin(result)
    if (forbidden) return forbidden

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('Invalid JSON body', 400)
    }
    const { provider, apiKey, modelId } = body as { provider?: string; apiKey?: string; modelId?: string }
    if (!provider || !isValidProvider(provider)) return jsonError('Invalid provider', 400)
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 8) {
      return jsonError('apiKey required (min 8 chars)', 400)
    }
    const providerId = provider as ProviderId
    const chosenModel = modelId ?? DEFAULT_PREFERENCES.cheap.modelId
    if (!getModelDescriptor(providerId, chosenModel)) {
      return jsonError('Unknown model for provider', 400)
    }

    const startedAt = Date.now()
    try {
      const model = await buildModelWithKey(providerId, chosenModel, apiKey.trim())
      const { text, usage } = await generateText({
        model,
        prompt: 'Reply with exactly: ok',
        maxOutputTokens: 8,
      })
      return jsonData({
        ok: true,
        latencyMs: Date.now() - startedAt,
        sample: text.trim().slice(0, 32),
        usage: {
          inputTokens: usage?.inputTokens ?? null,
          outputTokens: usage?.outputTokens ?? null,
        },
      })
    } catch (err) {
      return jsonData({
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : 'Connection test failed',
      })
    }
  }),
  API_WRITE_LIMIT,
)
