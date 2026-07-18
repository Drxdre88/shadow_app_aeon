import { jsonResponse } from '@/lib/api/response'
import { getOrigin, OAUTH_CORS_HEADERS } from '@/lib/oauth/origin'

// Primary path is middleware.ts (serveOAuthDiscovery), which intercepts this
// before the request ever reaches this handler — Next was prerendering/stale-
// caching this route into an empty 500. This handler is kept only as a fallback.
export const dynamic = 'force-dynamic'

// RFC 8414 authorization-server metadata. Reached via a rewrite from
// /.well-known/oauth-authorization-server (App Router won't serve dot-folders).
export async function GET(req: Request) {
  const origin = getOrigin(req)
  return jsonResponse(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/api/oauth/authorize`,
      token_endpoint: `${origin}/api/oauth/token`,
      registration_endpoint: `${origin}/api/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['mcp'],
    },
    { headers: OAUTH_CORS_HEADERS }
  )
}

export function OPTIONS() {
  return new Response(null, { headers: OAUTH_CORS_HEADERS })
}
