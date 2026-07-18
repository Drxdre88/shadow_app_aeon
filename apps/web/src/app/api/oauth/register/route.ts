import { jsonResponse } from '@/lib/api/response'
import { NextRequest, NextResponse } from 'next/server'
import { registerClient } from '@/lib/data/oauth'
import { OAUTH_CORS_HEADERS } from '@/lib/oauth/origin'

// NO `export const dynamic = 'force-dynamic'` here: on Next 16.1 + Turbopack
// that declarative export intermittently compiles POST handlers into a bundle
// that returns "No response is returned from route handler" (empty 500) —
// the same class of bug that forced OAuth discovery into middleware.ts.
// POST handlers are always dynamic; the export adds nothing and breaks this.

// RFC 7591 Dynamic Client Registration. Open registration (no auth) is the
// norm for MCP — a client_id alone is inert; nothing happens until a real user
// signs in at /authorize. We only validate that redirect_uris are http(s) URLs.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { redirect_uris?: unknown; client_name?: unknown } | null

  const redirectUris = body?.redirect_uris
  if (
    !Array.isArray(redirectUris) ||
    redirectUris.length === 0 ||
    !redirectUris.every((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u))
  ) {
    return jsonResponse(
      { error: 'invalid_redirect_uri', error_description: 'redirect_uris must be a non-empty array of http(s) URLs' },
      { status: 400, headers: OAUTH_CORS_HEADERS }
    )
  }

  const clientName = typeof body?.client_name === 'string' ? body.client_name.slice(0, 255) : null
  const client = await registerClient(redirectUris, clientName)

  return jsonResponse(
    {
      client_id: client.id,
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'mcp',
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    },
    { status: 201, headers: OAUTH_CORS_HEADERS }
  )
}

export async function OPTIONS() {
  return new Response(null, { headers: OAUTH_CORS_HEADERS })
}
