import { NextRequest } from 'next/server'
import { consumeAuthCode, issueTokens, rotateRefreshToken } from '@/lib/data/oauth'
import { verifyPkceS256 } from '@/lib/oauth/pkce'
import { OAUTH_CORS_HEADERS } from '@/lib/oauth/origin'

// OAuth 2.1 token endpoint. Accepts authorization_code (with PKCE) and
// refresh_token grants. Public clients only — no client_secret, the PKCE
// verifier is the proof of possession.
export async function POST(req: NextRequest) {
  const body = await readBody(req)
  const grantType = body.grant_type

  if (grantType === 'authorization_code') {
    const { code, redirect_uri, client_id, code_verifier } = body
    if (!code || !client_id || !code_verifier) return tokenError('invalid_request')

    const record = await consumeAuthCode(code)
    if (!record) return tokenError('invalid_grant', 'code is invalid, expired, or already used')
    if (record.clientId !== client_id || record.redirectUri !== redirect_uri) {
      return tokenError('invalid_grant', 'client_id / redirect_uri mismatch')
    }
    if (!verifyPkceS256(code_verifier, record.codeChallenge)) {
      return tokenError('invalid_grant', 'PKCE verification failed')
    }

    const tokens = await issueTokens({ clientId: record.clientId, userId: record.userId, scope: record.scope })
    return tokenResponse(tokens)
  }

  if (grantType === 'refresh_token') {
    const { refresh_token, client_id } = body
    if (!refresh_token) return tokenError('invalid_request')
    const tokens = await rotateRefreshToken(refresh_token, client_id)
    if (!tokens) return tokenError('invalid_grant', 'refresh_token is invalid or expired')
    return tokenResponse(tokens)
  }

  return tokenError('unsupported_grant_type')
}

export function OPTIONS() {
  return new Response(null, { headers: OAUTH_CORS_HEADERS })
}

async function readBody(req: NextRequest): Promise<Record<string, string>> {
  const contentType = req.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const json = (await req.json().catch(() => ({}))) as Record<string, unknown>
    return Object.fromEntries(Object.entries(json).map(([k, v]) => [k, String(v)]))
  }
  const form = await req.formData().catch(() => null)
  if (!form) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of form.entries()) out[k] = String(v)
  return out
}

function tokenResponse(tokens: { accessToken: string; refreshToken: string; expiresIn: number; scope: string }) {
  return Response.json(
    {
      access_token: tokens.accessToken,
      token_type: 'Bearer',
      expires_in: tokens.expiresIn,
      refresh_token: tokens.refreshToken,
      scope: tokens.scope,
    },
    { headers: { ...OAUTH_CORS_HEADERS, 'Cache-Control': 'no-store' } }
  )
}

function tokenError(error: string, description?: string) {
  return Response.json(
    { error, ...(description ? { error_description: description } : {}) },
    { status: 400, headers: { ...OAUTH_CORS_HEADERS, 'Cache-Control': 'no-store' } }
  )
}
