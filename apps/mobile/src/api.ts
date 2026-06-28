import { getStoredToken } from './auth'
import { API_BASE_URL } from './config'

// Authenticated fetch against the Aeon REST API. Attaches the stored mobile
// session token as a Bearer — the same token authenticateRequest() validates
// server-side (aeon_s1_ prefix → verifyMobileSession).
export async function apiFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const token = await getStoredToken()
  const headers = new Headers(init.headers)
  if (token) headers.set('authorization', `Bearer ${token}`)
  if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  return fetch(`${API_BASE_URL}${path}`, { ...init, headers })
}
