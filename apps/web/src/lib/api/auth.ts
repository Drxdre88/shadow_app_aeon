import { timingSafeEqual } from 'crypto'
import { NextRequest } from 'next/server'
import { jsonResponse } from '@/lib/api/response'
import { auth } from '@/lib/auth'
import { verifyApiKey } from '@/lib/data/api-keys'
import { verifyMobileSession } from '@/lib/data/mobile-auth'
import { verifyOAuthAccessToken } from '@/lib/data/oauth'

export type ApiUser = { id: string; role: string }

export function isApiUser(result: ApiUser | Response): result is ApiUser {
  return 'id' in result && typeof (result as ApiUser).id === 'string'
}

function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

export async function authenticateRequest(
  request: NextRequest
): Promise<ApiUser | Response> {
  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)

    const masterKey = process.env.AEON_API_KEY
    const adminId = process.env.AEON_API_USER_ID
    if (masterKey && adminId && constantTimeCompare(token, masterKey)) {
      return { id: adminId, role: 'admin' }
    }

    if (token.startsWith('aeon_k1_')) {
      const result = await verifyApiKey(token)
      if (result) return { id: result.userId, role: 'user' }
    }

    if (token.startsWith('aeon_s1_')) {
      const result = await verifyMobileSession(token)
      if (result) return { id: result.userId, role: 'user' }
    }

    if (token.startsWith('aeon_at_')) {
      const result = await verifyOAuthAccessToken(token)
      if (result) return { id: result.userId, role: 'user' }
    }

    return jsonResponse({ error: 'Invalid API key' }, { status: 401 })
  }

  const session = await auth()
  if (!session?.user?.id) {
    return jsonResponse({ error: 'Unauthorized' }, { status: 401 })
  }

  return { id: session.user.id, role: session.user.role || 'user' }
}

export function apiHandler(
  handler: (req: NextRequest, ctx: unknown) => Promise<Response>
) {
  return async (req: NextRequest, ctx: unknown) => {
    try {
      return await handler(req, ctx)
    } catch (error) {
      console.error('[API Error]', req.method, req.nextUrl.pathname, error)
      return jsonError('Internal server error', 500)
    }
  }
}

export function jsonError(message: string, status: number) {
  return jsonResponse({ error: message }, { status })
}

export function jsonData(data: unknown, status = 200) {
  return jsonResponse({ data }, { status })
}
