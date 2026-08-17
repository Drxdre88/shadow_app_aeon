import { Pool, neonConfig } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-serverless'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set')
}

// Route single-statement queries over stateless HTTP fetch instead of the
// module-scoped Pool's persistent WebSocket. A WebSocket does NOT survive
// across serverless invocations on Vercel: when an instance goes idle the
// platform tears the socket down, and the next request pulls a dead-but-
// "available" socket from the pool and awaits forever until the function is
// killed — Next then logs "No response is returned from route handler". This
// hammered /api/auth/* specifically because the NextAuth adapter runs a DB
// query on EVERY signin/signout/session check, so it always sat on the stale
// socket. With poolQueryViaFetch those single-statement queries use HTTP (no
// socket to go stale); db.transaction() still uses the WebSocket pool, so the
// SAME dead-socket class hit transactional board writes (checklist create/
// update run in db.transaction) — an idle-resumed instance pulled a dead
// socket and the write hung until the function died, silently from the
// client's perspective. idleTimeoutMillis + query_timeout below bound that:
// idle sockets are evicted before they can straddle an instance freeze, and a
// query on a dead socket rejects instead of hanging until the function is
// killed — the client then at least sees a failure (retried in dev, rolled
// back + toasted in prod, where action error messages are masked).
// The connectionTimeoutMillis below only covered the *different* failure of a
// slow connection acquire, not a dead-socket reuse, which is why the 500s
// outlived it. Ref: Neon serverless CONFIG.md (poolQueryViaFetch) + Neon docs
// warning never to create/reuse a Pool outside a single request handler.
neonConfig.poolQueryViaFetch = true

// connectionTimeoutMillis MUST stay below the route maxDuration (30s on the v1
// routes). If a request waits longer for a free connection than the platform
// lets the function run, Vercel hard-kills the function mid-await — the handler
// never throws, never returns, and Next logs "No response is returned from
// route handler". An 8s acquire timeout rejects in time for apiHandler's
// try/catch to return a clean 503 instead. max is raised because the -pooler
// (PgBouncer) endpoint multiplexes, so a higher per-instance ceiling is safe.
const pool = new Pool({
  connectionString,
  connectionTimeoutMillis: 8000,
  // Evict idle sockets fast: one that sat "available" across an instance
  // freeze is dead, and reusing it hangs the next transaction.
  idleTimeoutMillis: 10_000,
  // Client-side per-query deadline so a dead-socket query rejects instead of
  // awaiting until Vercel kills the function with no response.
  query_timeout: 15_000,
  max: 20,
})
export const db = drizzle(pool, { schema })
