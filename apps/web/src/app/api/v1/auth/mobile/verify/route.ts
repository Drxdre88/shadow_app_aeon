import { NextRequest } from 'next/server'
import { apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import {
  verifyLoginToken,
  findUserByEmail,
  createMobileSession,
} from '@/lib/data/mobile-auth'

export const POST = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('Invalid JSON body', 400)
    }

    const { token } = body as { token?: string }
    if (!token) {
      return jsonError('token is required', 400)
    }

    const result = await verifyLoginToken(token)
    if (!result) {
      return jsonError('Invalid or expired token', 401)
    }

    const user = await findUserByEmail(result.email)
    if (!user) {
      return jsonError('User not found', 404)
    }

    const sessionToken = await createMobileSession(user.id)

    return jsonData({
      token: sessionToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        image: user.image,
      },
    })
  }),
  API_WRITE_LIMIT
)
