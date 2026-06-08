import { handlers } from '@/lib/auth'

// Force per-request execution on the Node runtime so the catch-all auth handler
// is never prerendered/edge-optimised into a non-responding shell — the Next 16
// build-time failure mode behind the intermittent "No response is returned from
// route handler" 500s on /api/auth/* during deploy rollouts.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const { GET, POST } = handlers
