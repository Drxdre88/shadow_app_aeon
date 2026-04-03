import { NextRequest } from 'next/server'
import { apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import {
  verifyGoogleIdToken,
  findOrCreateGoogleUser,
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

    const { idToken } = body as { idToken?: string }
    if (!idToken) {
      return jsonError('idToken is required', 400)
    }

    const profile = await verifyGoogleIdToken(idToken)
    if (!profile) {
      return jsonError('Invalid Google ID token', 401)
    }

    const allowed = (process.env.ALLOWED_EMAILS || '')
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean)
    if (allowed.length > 0 && !allowed.includes(profile.email)) {
      return jsonError('Email not authorized', 403)
    }

    const user = await findOrCreateGoogleUser(profile)
    if (!user) {
      return jsonError('Failed to create user', 500)
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
