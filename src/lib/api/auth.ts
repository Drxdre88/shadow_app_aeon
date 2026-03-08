import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

export type ApiUser = { id: string; role: string }

export function isApiUser(result: ApiUser | NextResponse): result is ApiUser {
  return 'id' in result && typeof (result as ApiUser).id === 'string'
}

function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

export async function authenticateRequest(
  request: NextRequest
): Promise<ApiUser | NextResponse> {
  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    const apiKey = process.env.AEON_API_KEY
    const adminId = process.env.AEON_API_USER_ID
    if (!apiKey || !adminId || !constantTimeCompare(token, apiKey)) {
      return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })
    }
    return { id: adminId, role: 'admin' }
  }

  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return { id: session.user.id, role: session.user.role || 'user' }
}

export function apiHandler(
  handler: (req: NextRequest, ctx: unknown) => Promise<NextResponse>
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
  return NextResponse.json({ error: message }, { status })
}

export function jsonData(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status })
}
