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
// socket to go stale); db.transaction() still uses WebSocket, which is fine —
// transactions are request-scoped board mutations, never the auth hot path.
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
  max: 20,
})
export const db = drizzle(pool, { schema })
