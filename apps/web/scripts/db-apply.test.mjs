import test from 'node:test'
import assert from 'node:assert/strict'
import { findDestructive, parseArgs, stripComments } from './db-apply.mjs'
import { gateVerdict } from './verify-schema-drift.mjs'

test('additive migrations pass the destructive guard', () => {
  const sql = `
    CREATE TABLE IF NOT EXISTS foo (id uuid PRIMARY KEY);
    ALTER TABLE foo ADD COLUMN IF NOT EXISTS bar text;
    ALTER TABLE foo ALTER COLUMN bar DROP DEFAULT;
    ALTER TABLE foo ALTER COLUMN bar DROP NOT NULL;
    ALTER TABLE foo DROP CONSTRAINT IF EXISTS foo_bar_key;
    DROP INDEX IF EXISTS foo_bar_idx;
    -- DROP TABLE foo;  (commented out, never counts)
    /* TRUNCATE foo; */
  `
  assert.deepEqual(findDestructive(sql), [])
})

test('drops, truncates and deletes are flagged', () => {
  const hits = findDestructive(`
    DROP TABLE IF EXISTS old_things;
    ALTER TABLE foo DROP COLUMN legacy;
    alter table foo drop legacy2;
    TRUNCATE foo;
    DELETE FROM foo WHERE id = 1;
    DROP SCHEMA scratch CASCADE;
  `)
  assert.equal(hits.length, 6)
  assert.match(hits[0], /^DROP TABLE IF EXISTS old_things/)
})

test('comments are stripped before scanning', () => {
  assert.equal(stripComments('SELECT 1; -- DROP TABLE x\n/* TRUNCATE y */').includes('DROP'), false)
})

test('arguments: file plus flags in any order', () => {
  assert.deepEqual(parseArgs(['--dry-run', 'drizzle/0042_x.sql', '--no-tx']), {
    file: 'drizzle/0042_x.sql', dryRun: true, allowDestructive: false, noTx: true, force: false,
  })
})

test('deploy gate blocks only code that is ahead of the database', () => {
  const report = (destructive, breaking) => ({ counts: { destructive, breaking } })
  assert.equal(gateVerdict(report(0, 0)), 0)
  assert.equal(gateVerdict(report(3, 0)), 0)
  assert.equal(gateVerdict(report(0, 2)), 1)
})
