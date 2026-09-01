#!/usr/bin/env node
// Read-only diagnostic — compares what the database actually contains against
// what schema.ts declares, and names the difference in both directions.
//
// Why this exists: the drizzle journal is frozen at 0010, so migrations here
// are hand-written and applied by one-off scripts. schema.ts and the live
// database can therefore drift apart silently. When they do, `drizzle-kit push`
// reads the difference as drift and emits DROP statements for everything the
// database has and schema.ts lacks. That happened with the Chronos migrations
// 0034/0035 — ten columns and three tables sat in production, undeclared, one
// `db:push` away from being dropped. It was caught by eye. This catches it by
// tooling instead.
//
// Dev and production are ONE Neon database. This script only ever SELECTs from
// information_schema and pg_catalog — no DDL, no writes, not ever.
//
// Pool, not the neon() HTTP driver, matching apply-chronos-migration.mjs: the
// introspection is several queries and a pooled session runs them against one
// consistent connection.
//
// Exit codes:
//   0  clean, or shape mismatches only (advisory)
//   1  drift found in either direction
//   2  could not run (no DATABASE_URL, unreadable schema.ts, connection failed)

import { Pool } from '@neondatabase/serverless'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import dotenv from 'dotenv'

const here = dirname(fileURLToPath(import.meta.url))
const SCHEMA_TS = join(here, '..', 'src', 'lib', 'db', 'schema.ts')

// Bookkeeping tables that live in `public` on some setups and are deliberately
// not declared in schema.ts. Drizzle's own migration table normally sits in the
// `drizzle` schema, which we never look at, but list it so a relocated one does
// not read as destructive drift.
const IGNORED_TABLES = new Set(['__drizzle_migrations', 'drizzle_migrations'])

// Objects the database has on purpose that schema.ts deliberately does not
// model, because drizzle cannot express them: generated tsvector columns, GIN
// and HNSW indexes, expression indexes. Every entry names the migration that
// created it. They are reported separately and do not fail the check — without
// this list the check could never come back clean and would be ignored.
//
// Adding a row here is a decision that an object is intentionally undeclared.
// Do not use it to silence real drift: an object that drizzle CAN model belongs
// in schema.ts, not here.
const ACKNOWLEDGED = [
  { kind: 'column', table: 'memories', name: 'fts', reason: 'generated tsvector — drizzle/0013_brain_memories.sql' },
  { kind: 'index', table: 'memories', name: 'memories_fts_idx', reason: 'GIN — drizzle/0013_brain_memories.sql' },
  { kind: 'index', table: 'memories', name: 'memories_tags_idx', reason: 'GIN jsonb_path_ops — drizzle/0013_brain_memories.sql' },
  { kind: 'index', table: 'memories', name: 'memories_embedding_idx', reason: 'HNSW cosine — drizzle/0023_memory_embeddings.sql' },
  { kind: 'index', table: 'oauth_access_tokens', name: 'oauth_access_tokens_user_idx', reason: 'drizzle/0022_oauth.sql' },
  { kind: 'index', table: 'users', name: 'users_email_lower_idx', reason: 'lower(email) expression index — drizzle/0030_users_email_lower_idx.sql' },
]

const acknowledgementKey = (kind, table, name) => `${kind}:${table}:${name}`

/** Does the introspected shape actually contain this acknowledged object? */
function existsInShape(shape, entry) {
  const table = shape?.tables?.[entry.table]
  if (!table) return false
  if (entry.kind === 'table') return true
  if (entry.kind === 'column') return Object.hasOwn(table.columns ?? {}, entry.name)
  return Object.hasOwn(table.indexes ?? {}, entry.name)
}

const TABLES_SQL = `
  SELECT c.relname AS table_name
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
  ORDER BY 1
`

const COLUMNS_SQL = `
  SELECT c.relname AS table_name,
         a.attname AS column_name,
         format_type(a.atttypid, a.atttypmod) AS data_type,
         NOT a.attnotnull AS nullable
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
  ORDER BY 1, 2
`

// Constraint-backed indexes are excluded: Postgres creates one implicitly for
// every primary key and unique constraint, and drizzle models those as
// primaryKey()/unique() rather than as entries in the table's index list. They
// would otherwise read as drift on every single table.
const INDEXES_SQL = `
  SELECT t.relname AS table_name,
         i.relname AS index_name,
         ix.indisunique AS unique
  FROM pg_index ix
  JOIN pg_class i ON i.oid = ix.indexrelid
  JOIN pg_class t ON t.oid = ix.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relkind = 'r'
    AND NOT EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conindid = i.oid)
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = t.oid AND d.deptype = 'e')
  ORDER BY 1, 2
`

// drizzle's getSQLType() and Postgres' format_type() spell the same type
// differently often enough that a raw string compare is all false positives.
const TYPE_ALIASES = new Map([
  ['varchar', 'character varying'],
  ['char', 'character'],
  ['bpchar', 'character'],
  ['timestamp', 'timestamp without time zone'],
  ['timestamptz', 'timestamp with time zone'],
  ['time', 'time without time zone'],
  ['timetz', 'time with time zone'],
  ['int', 'integer'],
  ['int2', 'smallint'],
  ['int4', 'integer'],
  ['int8', 'bigint'],
  ['serial', 'integer'],
  ['smallserial', 'smallint'],
  ['bigserial', 'bigint'],
  ['bool', 'boolean'],
  ['float4', 'real'],
  ['float8', 'double precision'],
  ['decimal', 'numeric'],
])

/**
 * Normalise a type name so drizzle's spelling and Postgres' spelling of the
 * same type compare equal, preserving any length/precision modifier and array
 * suffix.
 */
export function normaliseType(type) {
  if (!type) return ''
  let t = String(type).trim().toLowerCase()
  let arrays = ''
  while (t.endsWith('[]')) { arrays += '[]'; t = t.slice(0, -2).trim() }
  const modifier = t.match(/\(([^)]*)\)\s*$/)
  const base = (modifier ? t.slice(0, modifier.index) : t).trim()
  const mapped = TYPE_ALIASES.get(base) ?? base
  return `${mapped}${modifier ? `(${modifier[1].replace(/\s+/g, '')})` : ''}${arrays}`
}

function emptySide() {
  return { tables: [], columns: [], indexes: [] }
}

/**
 * Compare two schema shapes and describe the drift. Pure — takes plain data,
 * touches no database, so it is unit-testable on its own.
 *
 * Each shape is { tables: { name: { columns: { name: { type, nullable } },
 * indexes: { name: { unique } } } } }.
 */
export function compareSchemas(dbShape, declaredShape, options = {}) {
  const ignored = options.ignoredTables ?? IGNORED_TABLES
  const acknowledgedList = options.acknowledged ?? ACKNOWLEDGED
  const acknowledgedKeys = new Set(acknowledgedList.map((a) => acknowledgementKey(a.kind, a.table, a.name)))
  const isAcknowledged = (kind, tbl, name) => acknowledgedKeys.has(acknowledgementKey(kind, tbl, name))
  const dbTables = dbShape?.tables ?? {}
  const declaredTables = declaredShape?.tables ?? {}

  const inDbOnly = emptySide()
  const inSchemaOnly = emptySide()
  const mismatched = []
  const acknowledged = []

  const names = new Set([...Object.keys(dbTables), ...Object.keys(declaredTables)])
  for (const table of [...names].sort()) {
    if (ignored.has(table)) continue
    const db = dbTables[table]
    const declared = declaredTables[table]

    // A whole missing table is reported once. Listing every one of its columns
    // and indexes underneath would bury the one line that matters.
    if (db && !declared) {
      if (isAcknowledged('table', table, table)) { acknowledged.push({ kind: 'table', table, name: table }); continue }
      inDbOnly.tables.push({
        table,
        columns: Object.keys(db.columns ?? {}).length,
        indexes: Object.keys(db.indexes ?? {}).length,
      })
      continue
    }
    if (declared && !db) {
      inSchemaOnly.tables.push({
        table,
        columns: Object.keys(declared.columns ?? {}).length,
        indexes: Object.keys(declared.indexes ?? {}).length,
      })
      continue
    }

    const dbCols = db.columns ?? {}
    const declaredCols = declared.columns ?? {}
    for (const column of [...new Set([...Object.keys(dbCols), ...Object.keys(declaredCols)])].sort()) {
      const a = dbCols[column]
      const b = declaredCols[column]
      if (a && !b) {
        if (isAcknowledged('column', table, column)) acknowledged.push({ kind: 'column', table, name: column })
        else inDbOnly.columns.push({ table, column, type: a.type ?? '', nullable: !!a.nullable })
        continue
      }
      if (b && !a) { inSchemaOnly.columns.push({ table, column, type: b.type ?? '', nullable: !!b.nullable }); continue }
      if (normaliseType(a.type) !== normaliseType(b.type)) {
        mismatched.push({ table, column, kind: 'type', db: a.type ?? '', declared: b.type ?? '' })
      }
      if (!!a.nullable !== !!b.nullable) {
        mismatched.push({
          table,
          column,
          kind: 'nullability',
          db: a.nullable ? 'nullable' : 'not null',
          declared: b.nullable ? 'nullable' : 'not null',
        })
      }
    }

    const dbIdx = db.indexes ?? {}
    const declaredIdx = declared.indexes ?? {}
    for (const index of [...new Set([...Object.keys(dbIdx), ...Object.keys(declaredIdx)])].sort()) {
      const a = dbIdx[index]
      const b = declaredIdx[index]
      if (a && !b) {
        if (isAcknowledged('index', table, index)) acknowledged.push({ kind: 'index', table, name: index })
        else inDbOnly.indexes.push({ table, index, unique: !!a.unique })
        continue
      }
      if (b && !a) { inSchemaOnly.indexes.push({ table, index, unique: !!b.unique }); continue }
      if (!!a.unique !== !!b.unique) {
        mismatched.push({
          table,
          column: index,
          kind: 'index uniqueness',
          db: a.unique ? 'unique' : 'non-unique',
          declared: b.unique ? 'unique' : 'non-unique',
        })
      }
    }
  }

  // An acknowledgement that no longer matches anything is a lie the next
  // reader would trust, so surface it rather than letting the list rot.
  const stale = acknowledgedList.filter((entry) => !existsInShape(dbShape, entry))

  const count = (side) => side.tables.length + side.columns.length + side.indexes.length
  const destructive = count(inDbOnly)
  const breaking = count(inSchemaOnly)
  return {
    inDbOnly,
    inSchemaOnly,
    mismatched,
    acknowledged,
    staleAcknowledgements: stale,
    counts: {
      destructive,
      breaking,
      mismatched: mismatched.length,
      acknowledged: acknowledged.length,
      stale: stale.length,
    },
    clean: destructive === 0 && breaking === 0 && mismatched.length === 0,
    drifted: destructive > 0 || breaking > 0,
  }
}

/** Render a drift report as advice a human can act on directly. */
export function formatReport(report) {
  const out = []
  const { inDbOnly, inSchemaOnly, mismatched, staleAcknowledgements, counts } = report

  if (counts.destructive > 0) {
    out.push('DESTRUCTIVE — in the database, NOT declared in schema.ts')
    out.push('  `db:push` reads these as drift and emits DROP for them. Dev and prod share')
    out.push('  this database, so that is live user data. Declare them in schema.ts.')
    for (const t of inDbOnly.tables) out.push(`    table   ${t.table}  (${t.columns} columns, ${t.indexes} indexes)`)
    for (const c of inDbOnly.columns) out.push(`    column  ${c.table}.${c.column}  ${c.type}${c.nullable ? '' : ' not null'}`)
    for (const i of inDbOnly.indexes) out.push(`    index   ${i.table}.${i.index}${i.unique ? '  unique' : ''}`)
    out.push('')
  }

  if (counts.breaking > 0) {
    out.push('BREAKING — declared in schema.ts, NOT in the database')
    out.push('  Every query selecting these fails at runtime for live users. Hand-write a')
    out.push('  numbered migration in drizzle/ and apply it with a one-off script.')
    for (const t of inSchemaOnly.tables) out.push(`    table   ${t.table}  (${t.columns} columns, ${t.indexes} indexes)`)
    for (const c of inSchemaOnly.columns) out.push(`    column  ${c.table}.${c.column}  ${c.type}${c.nullable ? '' : ' not null'}`)
    for (const i of inSchemaOnly.indexes) out.push(`    index   ${i.table}.${i.index}${i.unique ? '  unique' : ''}`)
    out.push('')
  }

  if (counts.mismatched > 0) {
    out.push('MISMATCH — present on both sides, shape differs (advisory, does not fail)')
    for (const m of mismatched) out.push(`    ${m.kind.padEnd(16)} ${m.table}.${m.column}  db=${m.db}  schema.ts=${m.declared}`)
    out.push('')
  }

  if (counts.stale > 0) {
    out.push('STALE ACKNOWLEDGEMENT — listed as intentionally undeclared, but not in the database')
    out.push('  Either the object was dropped, or it was renamed. Update the ACKNOWLEDGED list.')
    for (const s of staleAcknowledgements) out.push(`    ${s.kind.padEnd(7)} ${s.table}.${s.name}  — ${s.reason}`)
    out.push('')
  }

  if (report.clean) out.push('No drift. schema.ts and the database agree on tables, columns and indexes.')
  if (counts.acknowledged > 0) {
    out.push(`${counts.acknowledged} object(s) intentionally undeclared (raw-SQL generated columns and index types` +
      ' drizzle cannot express) — see the ACKNOWLEDGED list in this script.')
  }
  return out.join('\n')
}

function ensureTable(shape, table) {
  if (!shape.tables[table]) shape.tables[table] = { columns: {}, indexes: {} }
  return shape.tables[table]
}

/** Introspect the live database into a comparable shape. SELECT only. */
export async function readDatabaseShape(pool) {
  const shape = { tables: {} }
  const [tables, columns, indexes] = await Promise.all([
    pool.query(TABLES_SQL),
    pool.query(COLUMNS_SQL),
    pool.query(INDEXES_SQL),
  ])
  for (const r of tables.rows) ensureTable(shape, r.table_name)
  for (const r of columns.rows) {
    const t = shape.tables[r.table_name]
    if (t) t.columns[r.column_name] = { type: r.data_type, nullable: !!r.nullable }
  }
  for (const r of indexes.rows) {
    const t = shape.tables[r.table_name]
    if (t) t.indexes[r.index_name] = { unique: !!r.unique }
  }
  return shape
}

/**
 * Read what schema.ts declares, via drizzle's own table metadata rather than a
 * parse of the TypeScript source. Node strips the types on import, and
 * getTableConfig is drizzle's public accessor, so this stays correct as the
 * file is edited in ways a regex would not survive.
 */
export async function readDeclaredShape(schemaPath = SCHEMA_TS) {
  const [schemaModule, pgCore, orm] = await Promise.all([
    import(pathToFileURL(resolve(schemaPath)).href),
    import('drizzle-orm/pg-core'),
    import('drizzle-orm'),
  ])
  const { getTableConfig, PgTable } = pgCore
  const { is } = orm

  const shape = { tables: {} }
  for (const exported of Object.values(schemaModule)) {
    if (!is(exported, PgTable)) continue
    const config = getTableConfig(exported)
    // Only the public schema is introspected on the database side.
    if (config.schema && config.schema !== 'public') continue
    const table = ensureTable(shape, config.name)
    for (const column of config.columns) {
      table.columns[column.name] = { type: column.getSQLType(), nullable: !column.notNull }
    }
    for (const index of config.indexes) {
      const name = index?.config?.name
      if (name) table.indexes[name] = { unique: !!index.config.unique }
    }
  }
  return shape
}

async function main() {
  dotenv.config({ path: '.env.local' })
  dotenv.config({ path: '.env' })

  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL not set — cannot introspect. Nothing checked.')
    return 2
  }

  let declared
  try {
    declared = await readDeclaredShape()
  } catch (err) {
    console.error('Could not read schema.ts declarations — nothing checked.')
    console.error(`  ${err.message}`)
    return 2
  }

  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 20000 })
  let live
  try {
    live = await readDatabaseShape(pool)
  } catch (err) {
    console.error('Could not introspect the database — nothing checked.')
    console.error(`  ${err.message}`)
    await pool.end().catch(() => {})
    return 2
  }
  await pool.end().catch(() => {})

  const report = compareSchemas(live, declared)
  const dbCount = Object.keys(live.tables).length
  const declaredCount = Object.keys(declared.tables).length

  console.log('schema drift check — public schema, read-only\n')
  console.log(`  database:  ${dbCount} tables`)
  console.log(`  schema.ts: ${declaredCount} tables\n`)
  console.log(formatReport(report))

  if (report.drifted) {
    console.log(`\nDrift: ${report.counts.destructive} object(s) only in the database, ` +
      `${report.counts.breaking} only in schema.ts. Do NOT run db:push until this is zero.`)
    return 1
  }
  if (report.counts.mismatched > 0) console.log('\nNo missing objects. Shape mismatches above are advisory.')
  return 0
}

const invokedDirectly = process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url

if (invokedDirectly) {
  // A diagnostic that crashes teaches nothing — every failure exits with a
  // message instead of a stack trace.
  let code = 2
  try {
    code = await main()
  } catch (err) {
    console.error('schema drift check failed unexpectedly — nothing was written.')
    console.error(`  ${err?.message ?? err}`)
  }
  process.exit(code)
}
