#!/usr/bin/env node
// One-off — backfills the memory_ops trail the 2026-10-01 01:30Z memory-engine
// run never wrote. That run was killed at maxDuration mid-BackUp: it decayed
// 348 introspection proposals and promoted 1, but its ops sat in an in-memory
// buffer that was flushed only at step end, so none reached memory_ops and none
// of those changes could be undone via revert_memory_op.
//
// One op per affected proposal, with before/after EXACTLY as
// lib/kairos/engine/steps/back-up.ts writes them, so lib/kairos/engine/revert.ts
// restores them like any other engine op. Idempotent: skips a proposal that
// already has an op of the same kind. created_at = the run's own timestamp.
//
//   node scripts/backfill-memory-ops-1001.mjs            # dry run (default)
//   node scripts/backfill-memory-ops-1001.mjs --apply    # write, one transaction

import { pathToFileURL } from 'node:url'

// No engine runId was persisted on the rows (sourceMetadata.runId is the
// introspection run's own id), so the whole backfill shares this fixed run id.
export const BACKFILL_RUN_ID = 'ffd37158-9890-4025-8ea5-68d23f425aa3'
export const REASON = 'backfill: 2026-10-01 run wrote no ops'
// Every pending introspection proposal is captured as agentic with no
// confidence column (verified in prod 2026-10-01: all 2982 pending rows).
export const PRE_PROMOTE = { streamClass: 'agentic', confidence: null }
// The run's ctx.now was 2026-10-01T01:30:40.967Z; memories timestamps are UTC
// `timestamp without time zone`.
export const RUN_WINDOW = { from: '2026-10-01 01:30:00', to: '2026-10-01 02:00:00' }

function asRecord(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
}

function supportNote(meta) {
  const s = asRecord(asRecord(meta.engine).support)
  if (typeof s.independentSupports !== 'number') return ''
  return ` (${s.independentSupports} supports, ${s.distinctDays ?? 0} days)`
}

// rows: { id, userId, status, streamClass, confidence, archivedAt (ISO|null),
// updatedAt (ISO), sourceMetadata }. Returns memory_ops rows to insert.
export function buildBackfillOps(rows, runIdFor = () => BACKFILL_RUN_ID) {
  const ops = []
  for (const row of rows) {
    const meta = asRecord(row.sourceMetadata)
    const engineRunId = typeof asRecord(meta.engine).runId === 'string' ? asRecord(meta.engine).runId : null
    const base = { userId: row.userId, runId: engineRunId ?? runIdFor(row), memoryId: row.id, step: 'backup', createdAt: row.updatedAt }
    if (row.status === 'decayed') {
      if (!row.archivedAt) continue // not an archived decay — nothing a revert could restore
      ops.push({
        ...base,
        op: 'decay',
        before: { status: 'pending', archivedAt: null },
        after: { status: 'decayed', archivedAt: row.archivedAt },
        reason: `${REASON} — decayed: no independent backing${supportNote(meta)}`,
      })
    } else if (row.status === 'promoted') {
      ops.push({
        ...base,
        op: 'promote',
        before: { status: 'pending', ...PRE_PROMOTE },
        after: { status: 'promoted', streamClass: row.streamClass, confidence: row.confidence },
        reason: `${REASON} — promoted${supportNote(meta)}`,
      })
    }
  }
  return ops
}

const SELECT_AFFECTED = `
  SELECT m.id, m.user_id AS "userId", m.source_metadata->>'status' AS status,
         m.stream_class AS "streamClass", m.confidence,
         to_char(m.archived_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "archivedAt",
         to_char(m.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt",
         m.source_metadata AS "sourceMetadata"
  FROM memories m
  WHERE m.type = 'inbound'
    AND m.source_metadata->>'introspection' = 'true'
    AND m.source_metadata->>'status' IN ('decayed', 'promoted')
    AND m.updated_at >= $1 AND m.updated_at < $2
    AND NOT EXISTS (
      SELECT 1 FROM memory_ops o
      WHERE o.memory_id = m.id
        AND o.op = CASE m.source_metadata->>'status' WHEN 'decayed' THEN 'decay' ELSE 'promote' END
    )
  ORDER BY m.created_at`

const INSERT_OP = `
  INSERT INTO memory_ops (user_id, run_id, memory_id, step, op, before, after, reason, created_at)
  SELECT $1::uuid, $2::uuid, $3::uuid, $4::varchar, $5::varchar, $6::jsonb, $7::jsonb, $8::text, $9::timestamp
  WHERE NOT EXISTS (SELECT 1 FROM memory_ops WHERE memory_id = $3 AND op = $5)
  RETURNING id`

async function main() {
  const apply = process.argv.includes('--apply')
  const { default: dotenv } = await import('dotenv')
  dotenv.config({ path: '.env.local' })
  dotenv.config({ path: '.env' })
  const url = process.env.DATABASE_URL
  if (!url) { console.error('DATABASE_URL not set'); process.exit(1) }

  const { Pool } = await import('@neondatabase/serverless')
  const pool = new Pool({ connectionString: url })
  const client = await pool.connect()
  try {
    if (apply) await client.query('BEGIN')
    const { rows } = await client.query(SELECT_AFFECTED, [RUN_WINDOW.from, RUN_WINDOW.to])
    const ops = buildBackfillOps(rows)
    const counts = ops.reduce((acc, o) => ({ ...acc, [o.op]: (acc[o.op] ?? 0) + 1 }), {})
    console.log(`${apply ? 'APPLY' : 'DRY RUN'}: ${rows.length} affected proposals without an op; ${ops.length} ops to insert`, counts)
    for (const sample of [...ops.filter((o) => o.op === 'promote').slice(0, 1), ...ops.filter((o) => o.op === 'decay').slice(0, 2)]) {
      console.log(JSON.stringify(sample, null, 2))
    }
    if (!apply) {
      console.log('dry run: nothing written (pass --apply to insert in one transaction)')
      return
    }
    let inserted = 0
    for (const o of ops) {
      const res = await client.query(INSERT_OP, [
        o.userId, o.runId, o.memoryId, o.step, o.op, JSON.stringify(o.before), JSON.stringify(o.after), o.reason, o.createdAt,
      ])
      inserted += res.rowCount ?? 0
    }
    await client.query('COMMIT')
    console.log(`committed: ${inserted} memory_ops rows inserted (run_id ${BACKFILL_RUN_ID})`)
  } catch (err) {
    if (apply) await client.query('ROLLBACK').catch(() => {})
    console.error('FAILED (rolled back):', err.message)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
