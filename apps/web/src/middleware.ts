import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'

const PUBLIC_PATHS = ['/login', '/demo', '/beta-terms']

const OAUTH_CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store',
}

// Serve the OAuth discovery documents directly from middleware. The equivalent
// GET route handlers were being statically prerendered / stale-build-cached by
// Next into empty 500/200 shells (force-dynamic is not reliably honoured on
// route handlers). Middleware runs per-request on every deploy and can NEVER be
// statically optimised or cached, so this is the one place guaranteed to return
// fresh, correct JSON for claude.ai's discovery walk. Runs before NextAuth so
// discovery stays anonymous (no CSRF cookies stamped on it).
function serveOAuthDiscovery(
  request: { method: string; nextUrl: { pathname: string }; headers: Headers }
): NextResponse | null {
  const { pathname } = request.nextUrl
  const isAS =
    pathname === '/.well-known/oauth-authorization-server' ||
    pathname === '/.well-known/openid-configuration' ||
    pathname.startsWith('/.well-known/oauth-authorization-server/')
  const isPR =
    pathname === '/.well-known/oauth-protected-resource' ||
    pathname.startsWith('/.well-known/oauth-protected-resource/')
  if (!isAS && !isPR) return null

  if (request.method === 'OPTIONS') return new NextResponse(null, { headers: OAUTH_CORS })

  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || ''
  const proto =
    request.headers.get('x-forwarded-proto') ||
    (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https')
  const origin = `${proto}://${host}`

  if (isAS) {
    return NextResponse.json(
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
      { headers: OAUTH_CORS }
    )
  }
  return NextResponse.json(
    {
      resource: `${origin}/api/mcp`,
      authorization_servers: [origin],
      scopes_supported: ['mcp'],
      bearer_methods_supported: ['header'],
    },
    { headers: OAUTH_CORS }
  )
}

export default auth((request) => {
  // Discovery is served here directly, before any auth/routing logic, so it
  // never reaches the statically-prerendered/stale-cached route handlers.
  const discovery = serveOAuthDiscovery(request)
  if (discovery) return discovery

  const { pathname } = request.nextUrl

  if (PUBLIC_PATHS.includes(pathname) || pathname.startsWith('/api/') || pathname.startsWith('/.well-known/') || pathname.startsWith('/share/')) {
    return NextResponse.next()
  }

  const isAuthenticated = !!request.auth

  if (pathname === '/') {
    const target = isAuthenticated ? '/dashboard' : '/login'
    return NextResponse.redirect(new URL(target, request.url))
  }

  if (!isAuthenticated) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
})

export const config = {
  // IMPORTANT: `api` is excluded. The `auth()` wrapper must NOT run in front of
  // the NextAuth route handlers (/api/auth/*) — on the sign-in POST it consumes
  // the request before the handler can issue its redirect, yielding a 500
  // "No response is returned from route handler". (Auth.js-recommended matcher.)
  // Discovery still works: it lives under /.well-known/* which stays matched.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|manifest\\.json|sw\\.js|offline\\.html|aeon.*\\.png).*)'],
}
