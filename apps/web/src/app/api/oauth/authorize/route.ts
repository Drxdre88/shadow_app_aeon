import { redirectResponse } from '@/lib/api/response'
import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { getClient, createAuthCode } from '@/lib/data/oauth'



// OAuth 2.1 authorization endpoint. Browser-facing: the user must already hold
// a NextAuth session; if not we bounce through /login and return here. On
// success we mint a PKCE-bound, single-use code and redirect it to the client.
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const p = url.searchParams

  const clientId = p.get('client_id') ?? ''
  const redirectUri = p.get('redirect_uri') ?? ''
  const responseType = p.get('response_type') ?? ''
  const state = p.get('state') ?? ''
  const codeChallenge = p.get('code_challenge') ?? ''
  const codeChallengeMethod = p.get('code_challenge_method') ?? ''
  const scope = p.get('scope') || 'mcp'
  const resource = p.get('resource') ?? undefined

  // Validate the client + redirect_uri BEFORE we trust redirect_uri as a sink.
  const client = await getClient(clientId)
  if (!client) return plainError('invalid client_id', 400)
  if (!client.redirectUris.includes(redirectUri)) return plainError('invalid redirect_uri', 400)

  const bounce = (params: Record<string, string>) => {
    const target = new URL(redirectUri)
    if (state) params.state = state
    for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v)
    return redirectResponse(target)
  }

  if (responseType !== 'code') return bounce({ error: 'unsupported_response_type' })
  if (!codeChallenge || codeChallengeMethod !== 'S256') {
    return bounce({ error: 'invalid_request', error_description: 'PKCE S256 required' })
  }

  const session = await auth()
  if (!session?.user?.id) {
    // Not signed in — send to login, then back to this exact authorize URL.
    const login = new URL('/login', url.origin)
    login.searchParams.set('callbackUrl', url.pathname + url.search)
    return redirectResponse(login)
  }

  const code = await createAuthCode({
    clientId,
    userId: session.user.id,
    redirectUri,
    codeChallenge,
    scope,
    resource,
  })
  return bounce({ code })
}

function plainError(message: string, status: number) {
  return new Response(message, { status, headers: { 'Content-Type': 'text/plain' } })
}
