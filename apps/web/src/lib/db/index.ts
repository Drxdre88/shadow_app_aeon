import { Pool } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-serverless'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set')
}

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
