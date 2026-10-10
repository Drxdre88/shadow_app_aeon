import type { RateLimitConfig } from '@/lib/api/rateLimit'

// Voice line limits, each in its own per-IP bucket so other REST calls never
// eat into them (and they never eat into other routes).

// A 5s poll is 12 a minute; 60 covers several desk windows plus retries.
export const VOICE_FEED_LIMIT: RateLimitConfig = { windowMs: 60_000, maxRequests: 60, scope: 'voice-feed' }

export const VOICE_TURN_LIMIT: RateLimitConfig = { windowMs: 60_000, maxRequests: 30, scope: 'voice-turn' }
