import { getOrigin, OAUTH_CORS_HEADERS } from '@/lib/oauth/origin'

// RFC 8414 authorization-server metadata. Reached via a rewrite from
// /.well-known/oauth-authorization-server (App Router won't serve dot-folders).
export async function GET(req: Request) {
  const origin = getOrigin(req)
  return Response.json(
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
