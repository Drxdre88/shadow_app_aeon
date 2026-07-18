// Realm-safe Response constructors for route handlers.
//
// Next's node server replaces `globalThis.Response` with a lazy wrapper class
// and copies undici's statics onto it. `Response.json()` therefore returns a
// REAL undici Response — which is NOT an instance of the wrapper — and the
// app-route module's `res instanceof Response` check throws "No response is
// returned from route handler" (empty 500 in prod). Bundled `NextResponse`
// copies fail the same check from the other side: they extend a per-chunk
// bundled Response, not the runtime global. Which routes break varies with
// chunk assembly per build — this took down /api/oauth/*, /api/v1/kairos/speak
// and parts of /api/v1 in prod (2026-07-18) while sparing others.
//
// Constructing with the GLOBAL `new Response(...)` is the only realm-proof
// path: the instance and the checker always share the same class. Route
// handlers must use these helpers instead of `Response.json` /
// `NextResponse.json` / `NextResponse.redirect`.

export function jsonResponse(data: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers)
  if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(data), { ...init, headers })
}

export function redirectResponse(location: string | URL, status: 302 | 303 | 307 | 308 = 307): Response {
  return new Response(null, { status, headers: { Location: location.toString() } })
}
