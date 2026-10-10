import { jsonError, type ApiUser } from '@/lib/api/auth'
import { canUseVorath } from '@/lib/vorath-access'

// Owner-only gate for Vorath REST routes. A 404 (not 403) so beta callers
// cannot tell the feature exists.
export function vorathGuard(user: ApiUser): Response | null {
  return canUseVorath(user.id) ? null : jsonError('Not found', 404)
}
