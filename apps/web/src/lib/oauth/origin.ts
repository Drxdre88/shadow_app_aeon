/**
 * Resolve the public origin (scheme://host) of an incoming request, honouring
 * the proxy-forwarded headers Vercel/Neon set in front of the app. This must
 * match the origin mcp-handler advertises in its 401 `resource_metadata` URL,
 * otherwise claude.ai's discovery walk lands on the wrong host.
 */
export function getOrigin(req: Request): string {
  const h = req.headers
  const host = h.get('x-forwarded-host') || h.get('host') || ''
  const proto =
    h.get('x-forwarded-proto') ||
    (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https')
  return `${proto}://${host}`
}

export const OAUTH_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
}
