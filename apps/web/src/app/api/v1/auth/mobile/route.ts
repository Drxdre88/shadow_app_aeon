import { NextRequest } from 'next/server'
import { apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { createLoginToken, findUserByEmail } from '@/lib/data/mobile-auth'

export const POST = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('Invalid JSON body', 400)
    }

    const { email, callbackUrl: rawCallbackUrl } = body as {
      email?: string
      callbackUrl?: string
    }
    if (!email || !rawCallbackUrl) {
      return jsonError('email and callbackUrl are required', 400)
    }

    if (!rawCallbackUrl.startsWith('/') || rawCallbackUrl.startsWith('//')) {
      return jsonError('Invalid callbackUrl', 400)
    }
    let callbackUrl: string
    try {
      callbackUrl = new URL(rawCallbackUrl, 'http://localhost').pathname
    } catch {
      return jsonError('Invalid callbackUrl', 400)
    }

    const user = await findUserByEmail(email)
    if (!user) {
      return jsonData({ sent: true })
    }

    const token = await createLoginToken(email, callbackUrl)

    const resendKey = process.env.AUTH_RESEND_KEY
    if (!resendKey) {
      return jsonError('Email service not configured', 503)
    }

    const loginUrl = `${callbackUrl}?token=${token}`

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || 'Aeon <noreply@aeon.app>',
        to: [email],
        subject: 'Sign in to Aeon',
        html: [
          '<p>Tap the link below to sign in to Aeon on your phone:</p>',
          `<p><a href="${loginUrl}">Sign in to Aeon</a></p>`,
          '<p>This link expires in 10 minutes.</p>',
        ].join(''),
      }),
    })

    return jsonData({ sent: true })
  }),
  API_WRITE_LIMIT
)
