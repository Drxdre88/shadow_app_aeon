import test from 'node:test'
import assert from 'node:assert/strict'

import { BACKFILL_RUN_ID, buildBackfillOps } from './backfill-memory-ops-1001.mjs'

const RUN_AT = '2026-10-01T01:30:40.967Z'

const decayed = {
  id: 'b8068632-99d2-4a59-acc3-dde55d114c8b',
  userId: 'u1',
  status: 'decayed',
  streamClass: 'agentic',
  confidence: null,
  archivedAt: RUN_AT,
  updatedAt: RUN_AT,
  sourceMetadata: { status: 'decayed', runId: 'introspection:x:2026-06-15', engine: { support: { independentSupports: 0, distinctDays: 0 } } },
}

const promoted = {
  id: 'ee4309b6-f0ae-49da-9f59-144d40d864cc',
  userId: 'u1',
  status: 'promoted',
  streamClass: 'idea',
  confidence: 0.6,
  archivedAt: null,
  updatedAt: RUN_AT,
  sourceMetadata: { status: 'promoted', promotedAt: RUN_AT, engine: { support: { independentSupports: 38, distinctDays: 10 } } },
}

test('decay op mirrors back-up.ts (revert restores pending + un-archives)', () => {
  const [op] = buildBackfillOps([decayed])
  assert.equal(op.op, 'decay')
  assert.equal(op.step, 'backup')
  assert.equal(op.memoryId, decayed.id)
  assert.equal(op.runId, BACKFILL_RUN_ID) // the introspection runId is not an engine run id
  assert.equal(op.createdAt, RUN_AT)
  assert.deepEqual(op.before, { status: 'pending', archivedAt: null })
  assert.deepEqual(op.after, { status: 'decayed', archivedAt: RUN_AT })
  assert.match(op.reason, /^backfill: 2026-10-01 run wrote no ops/)
})

test('promote op mirrors back-up.ts (revert restores the pending agentic guess)', () => {
  const [op] = buildBackfillOps([promoted])
  assert.equal(op.op, 'promote')
  assert.deepEqual(op.before, { status: 'pending', streamClass: 'agentic', confidence: null })
  assert.deepEqual(op.after, { status: 'promoted', streamClass: 'idea', confidence: 0.6 })
  assert.match(op.reason, /38 supports, 10 days/)
})

test('prefers a persisted engine runId; skips rows a revert could not restore', () => {
  const withRun = { ...decayed, sourceMetadata: { engine: { runId: 'run-9' } } }
  assert.equal(buildBackfillOps([withRun])[0].runId, 'run-9')
  assert.deepEqual(buildBackfillOps([{ ...decayed, archivedAt: null }]), [])
  assert.deepEqual(buildBackfillOps([{ ...decayed, status: 'pending' }]), [])
})
