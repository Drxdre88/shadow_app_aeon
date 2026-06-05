import { getOrigin, OAUTH_CORS_HEADERS } from '@/lib/oauth/origin'

// RFC 9728 protected-resource metadata: points the MCP endpoint at this app's
// own authorization server. Reached via rewrite from
// /.well-known/oauth-protected-resource (and the /api/mcp-suffixed variant).
export async function GET(req: Request) {
  const origin = getOrigin(req)
  return Response.json(
    {
      resource: `${origin}/api/mcp`,
      authorization_servers: [origin],
    },
    { headers: OAUTH_CORS_HEADERS }
  )
}

export function OPTIONS() {
  return new Response(null, { headers: OAUTH_CORS_HEADERS })
}
