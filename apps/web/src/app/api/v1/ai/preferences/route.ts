import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { getPreferences, upsertPreferences, type PreferenceShape } from '@/lib/data/ai-credentials'
import { DEFAULT_PREFERENCES, isValidProvider, getModelDescriptor, type ProviderId } from '@/lib/ai/providers'

function requireAdmin(result: { id: string; role: string }) {
  return result.role === 'admin' ? null : jsonError('AI features restricted to administrators', 403)
}

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const forbidden = requireAdmin(result)
    if (forbidden) return forbidden

    const prefs = await getPreferences(result.id)
    return jsonData(prefs ?? {
      cheap: { ...DEFAULT_PREFERENCES.cheap },
      standard: { ...DEFAULT_PREFERENCES.standard },
      heavy: { ...DEFAULT_PREFERENCES.heavy },
    })
  }),
  API_READ_LIMIT,
)

export const PATCH = withRateLimit(
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
    const prefs = body as PreferenceShape
    for (const tier of ['cheap', 'standard', 'heavy'] as const) {
      const t = prefs?.[tier]
      if (!t || !isValidProvider(t.providerId)) return jsonError(`Invalid provider for ${tier}`, 400)
      if (!getModelDescriptor(t.providerId as ProviderId, t.modelId)) {
        return jsonError(`Unknown model "${t.modelId}" for provider ${t.providerId}`, 400)
      }
    }
    const saved = await upsertPreferences(result.id, prefs)
    return jsonData(saved)
  }),
  API_WRITE_LIMIT,
)
