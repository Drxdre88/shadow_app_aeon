import test from 'node:test'
import assert from 'node:assert/strict'
import { compareSchemas, formatReport, normaliseType } from './verify-schema-drift.mjs'

function table(columns = {}, indexes = {}) {
  return { columns, indexes }
}

const col = (type, nullable = false) => ({ type, nullable })

test('identical shapes report clean', () => {
  const shape = { tables: { board_tasks: table({ id: col('uuid'), name: col('varchar(255)') }, { board_tasks_project_idx: { unique: false } }) } }
  const report = compareSchemas(shape, structuredClone(shape))
  assert.equal(report.clean, true)
  assert.equal(report.drifted, false)
  assert.match(formatReport(report), /No drift/)
})

test('a table only in the database is the destructive direction', () => {
  const db = { tables: { resources: table({ id: col('uuid'), name: col('text') }, { resources_user_idx: { unique: false } }) } }
  const report = compareSchemas(db, { tables: {} })
  assert.equal(report.counts.destructive, 1)
  assert.equal(report.counts.breaking, 0)
  assert.deepEqual(report.inDbOnly.tables, [{ table: 'resources', columns: 2, indexes: 1 }])
  assert.equal(report.drifted, true)
  const text = formatReport(report)
  assert.match(text, /DESTRUCTIVE/)
  assert.match(text, /table {3}resources {2}\(2 columns, 1 indexes\)/)
})

test('a missing table is reported once, not once per column', () => {
  const db = { tables: { work_calendars: table({ a: col('uuid'), b: col('text'), c: col('integer') }) } }
  const report = compareSchemas(db, { tables: {} })
  assert.equal(report.inDbOnly.columns.length, 0)
  assert.equal(report.inDbOnly.tables.length, 1)
})

test('columns only in the database are destructive, columns only in schema.ts are breaking', () => {
  const db = { tables: { board_tasks: table({ id: col('uuid'), estimate_minutes: col('integer', true) }) } }
  const declared = { tables: { board_tasks: table({ id: col('uuid'), owner_resource_id: col('uuid', true) }) } }
  const report = compareSchemas(db, declared)
  assert.deepEqual(report.inDbOnly.columns, [{ table: 'board_tasks', column: 'estimate_minutes', type: 'integer', nullable: true }])
  assert.deepEqual(report.inSchemaOnly.columns, [{ table: 'board_tasks', column: 'owner_resource_id', type: 'uuid', nullable: true }])
  assert.equal(report.drifted, true)
  const text = formatReport(report)
  assert.match(text, /DESTRUCTIVE[\s\S]*estimate_minutes/)
  assert.match(text, /BREAKING[\s\S]*owner_resource_id/)
})

test('indexes drift in both directions', () => {
  const db = { tables: { memories: table({ id: col('uuid') }, { memories_user_idx: { unique: false } }) } }
  const declared = { tables: { memories: table({ id: col('uuid') }, { memories_dominion_idx: { unique: true } }) } }
  const report = compareSchemas(db, declared)
  assert.deepEqual(report.inDbOnly.indexes, [{ table: 'memories', index: 'memories_user_idx', unique: false }])
  assert.deepEqual(report.inSchemaOnly.indexes, [{ table: 'memories', index: 'memories_dominion_idx', unique: true }])
})

test('shape mismatches are advisory and do not count as drift', () => {
  const db = { tables: { memories: table({ summary: col('text', true) }, { memories_user_idx: { unique: false } }) } }
  const declared = { tables: { memories: table({ summary: col('varchar(255)', false) }, { memories_user_idx: { unique: true } }) } }
  const report = compareSchemas(db, declared)
  assert.equal(report.drifted, false)
  assert.equal(report.clean, false)
  assert.equal(report.counts.mismatched, 3)
  const kinds = report.mismatched.map((m) => m.kind).sort()
  assert.deepEqual(kinds, ['index uniqueness', 'nullability', 'type'])
})

test('type spellings that mean the same thing do not report a mismatch', () => {
  const db = {
    tables: {
      t: table({
        a: col('character varying(255)'),
        b: col('timestamp without time zone'),
        c: col('integer'),
        d: col('boolean'),
        e: col('double precision'),
        f: col('text[]'),
        g: col('numeric(10,2)'),
      }),
    },
  }
  const declared = {
    tables: {
      t: table({
        a: col('varchar(255)'),
        b: col('timestamp'),
        c: col('serial'),
        d: col('bool'),
        e: col('float8'),
        f: col('text[]'),
        g: col('decimal(10, 2)'),
      }),
    },
  }
  assert.deepEqual(compareSchemas(db, declared).mismatched, [])
})

test('normaliseType keeps modifiers and array suffixes', () => {
  assert.equal(normaliseType('VARCHAR(50)'), 'character varying(50)')
  assert.equal(normaliseType('varchar'), 'character varying')
  assert.equal(normaliseType('vector(1536)'), 'vector(1536)')
  assert.equal(normaliseType('int4[]'), 'integer[]')
  assert.equal(normaliseType(undefined), '')
})

test('bookkeeping tables are ignored on both sides', () => {
  const db = { tables: { __drizzle_migrations: table({ id: col('bigint') }) } }
  const report = compareSchemas(db, { tables: {} })
  assert.equal(report.clean, true)
})

test('ignoredTables is overridable', () => {
  const db = { tables: { scratch: table({ id: col('uuid') }) } }
  assert.equal(compareSchemas(db, { tables: {} }, { ignoredTables: new Set(['scratch']) }).clean, true)
  assert.equal(compareSchemas(db, { tables: {} }, { ignoredTables: new Set() }).drifted, true)
})

test('empty or absent shapes do not throw', () => {
  assert.equal(compareSchemas({}, {}).clean, true)
  assert.equal(compareSchemas(undefined, undefined).clean, true)
})

test('the real Chronos drift is caught in the destructive direction', () => {
  const db = {
    tables: {
      board_tasks: table({ id: col('uuid'), estimate_minutes: col('integer', true), owner_resource_id: col('uuid', true) }),
      work_calendars: table({ id: col('uuid') }),
      calendar_exceptions: table({ id: col('uuid') }),
      resources: table({ id: col('uuid') }),
    },
  }
  const declared = { tables: { board_tasks: table({ id: col('uuid') }) } }
  const report = compareSchemas(db, declared)
  assert.equal(report.counts.destructive, 5)
  assert.equal(report.counts.breaking, 0)
  assert.match(formatReport(report), /db:push` reads these as drift/)
})

test('acknowledged objects are excluded from destructive drift', () => {
  const db = { tables: { memories: table({ id: col('uuid'), fts: col('tsvector', true) }, { memories_fts_idx: { unique: false } }) } }
  const declared = { tables: { memories: table({ id: col('uuid') }) } }
  const report = compareSchemas(db, declared)
  assert.equal(report.counts.destructive, 0)
  assert.equal(report.counts.acknowledged, 2)
  assert.equal(report.drifted, false)
  assert.deepEqual(report.acknowledged.map((a) => a.name).sort(), ['fts', 'memories_fts_idx'])
})

test('an acknowledgement the database no longer matches is reported as stale', () => {
  const acknowledged = [{ kind: 'index', table: 'users', name: 'users_email_lower_idx', reason: 'migration 0030' }]
  const report = compareSchemas({ tables: { users: table({ id: col('uuid') }) } }, { tables: { users: table({ id: col('uuid') }) } }, { acknowledged })
  assert.equal(report.counts.stale, 1)
  assert.equal(report.drifted, false)
  assert.match(formatReport(report), /STALE ACKNOWLEDGEMENT[\s\S]*users\.users_email_lower_idx/)
})

test('acknowledgement never hides an object missing from the database', () => {
  const acknowledged = [{ kind: 'index', table: 'memories', name: 'memories_fts_idx', reason: 'raw SQL' }]
  const db = { tables: { memories: table({ id: col('uuid') }) } }
  const declared = { tables: { memories: table({ id: col('uuid') }, { memories_fts_idx: { unique: false } }) } }
  const report = compareSchemas(db, declared, { acknowledged })
  assert.equal(report.counts.breaking, 1)
  assert.equal(report.drifted, true)
})

test('acknowledgement does not leak across tables of the same object name', () => {
  const acknowledged = [{ kind: 'column', table: 'memories', name: 'fts', reason: 'raw SQL' }]
  const db = { tables: { notes: table({ fts: col('tsvector', true) }), memories: table({ fts: col('tsvector', true) }) } }
  const declared = { tables: { notes: table({}), memories: table({}) } }
  const report = compareSchemas(db, declared, { acknowledged })
  assert.deepEqual(report.inDbOnly.columns.map((c) => c.table), ['notes'])
})
