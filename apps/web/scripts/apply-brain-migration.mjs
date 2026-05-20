// One-shot applier for apps/web/drizzle/0013_brain_memories.sql.
// Uses the existing @neondatabase/serverless dep — no extra installs.
// Idempotent: every statement uses IF NOT EXISTS / duplicate_object catch.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from '@neondatabase/serverless'

// Load .env.local manually (no dotenv dep at root level).
// Handles CRLF, quoted values, and inline `KEY=value` after comments on same line.
const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '..', '.env.local')
const envSrc = readFileSync(envPath, 'utf8').replace(/\r/g, '')
for (const rawLine of envSrc.split('\n')) {
  const line = rawLine.trim()
  if (!line || line.startsWith('#')) continue
  const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
  if (!m) continue
  let val = m[2].trim()
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1)
  }
  if (!process.env[m[1]]) process.env[m[1]] = val
}

const url = process.env.DATABASE_URL
if (!url) {
  console.error('FATAL: DATABASE_URL not found in env')
  process.exit(1)
}

const sqlPath = join(__dirname, '..', 'drizzle', '0013_brain_memories.sql')
const raw = readFileSync(sqlPath, 'utf8')

// Split on breakpoints. Only filter out blocks that, after stripping leading
// comment lines, contain no SQL — keep blocks that have comments AS WELL AS SQL.
const statements = raw
  .split('--> statement-breakpoint')
  .map((s) => s.trim())
  .filter((s) => {
    if (s.length === 0) return false
    const stripped = s.replace(/^(\s*--[^\n]*\n?)+/g, '').trim()
    return stripped.length > 0
  })

console.log(`Found ${statements.length} statement block(s) to execute.\n`)

const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 20000 })

try {
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i]
    const preview = stmt.replace(/\s+/g, ' ').slice(0, 90)
    process.stdout.write(`[${i + 1}/${statements.length}] ${preview}${stmt.length > 90 ? '…' : ''}\n`)
    await pool.query(stmt)
  }

  const { rows: tableCheck } = await pool.query(
    `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name='memories'`
  )
  const { rows: ftsCheck } = await pool.query(
    `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='memories' AND column_name='fts'`
  )
  const { rows: idxCheck } = await pool.query(
    `SELECT indexname FROM pg_indexes WHERE tablename='memories' ORDER BY indexname`
  )
  const { rows: rowCount } = await pool.query(`SELECT count(*)::int AS n FROM memories`)

  console.log('\n--- post-migration checks ---')
  console.log('memories table exists:', tableCheck[0].n === 1 ? 'YES' : 'NO')
  console.log('fts generated column exists:', ftsCheck[0].n === 1 ? 'YES' : 'NO')
  console.log('memories indexes:', idxCheck.map((r) => r.indexname).join(', '))
  console.log('memories row count:', rowCount[0].n)
  console.log('\n✓ Brain migration applied successfully.')
} catch (err) {
  console.error('\n✗ Migration FAILED:', err.message)
  if (err.stack) console.error(err.stack)
  process.exit(1)
} finally {
  await pool.end()
}
