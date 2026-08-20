import { handlers } from '@/lib/auth'

// Force per-request execution on the Node runtime so the catch-all auth handler
// is never prerendered/edge-optimised into a non-responding shell — the Next 16
// build-time failure mode behind the intermittent "No response is returned from
// route handler" 500s on /api/auth/* during deploy rollouts.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Realm coercion — the durable fix for the OTHER intermittent auth 500:
// "Expected a Response object but received 'Response'". The auth stack can
// hand back a Response built from a bundled copy of the class (undici/polyfill
// realm), and Next's instanceof check then rejects it on some instances —
// upgrading Next only shuffles the odds (recurred on 16.3.1, prod 2026-08-20;
// see vercel/next.js#58611 for the class-identity failure shape). Rebuilding
// the response with THIS module's global Response guarantees Next always
// receives its own realm's class, on any Next version. Body/status/headers
// (incl. set-cookie) are carried over untouched.
type AuthHandler = (req: Request) => Promise<Response> | Response

function coerceResponse(handler: AuthHandler): AuthHandler {
  return async (req) => {
    const res = await handler(req)
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    })
  }
}

export const GET = coerceResponse(handlers.GET as AuthHandler)
export const POST = coerceResponse(handlers.POST as AuthHandler)
