import { getOrigin, OAUTH_CORS_HEADERS } from '@/lib/oauth/origin'

// getOrigin() calls headers() from next/headers — a true dynamic signal that
// forces per-request execution. Belt-and-suspenders with force-dynamic, which
// alone was not reliably honoured (route was statically prerendered to a 500).
export const dynamic = 'force-dynamic'

// RFC 9728 protected-resource metadata: points the MCP endpoint at this app's
// own authorization server. Reached via rewrite from
// /.well-known/oauth-protected-resource (and the /api/mcp-suffixed variant).
export async function GET() {
  const origin = await getOrigin()
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
