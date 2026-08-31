import { PgDialect } from 'drizzle-orm/pg-core'
import { getTableName, is, SQL, Column } from 'drizzle-orm'
import type { AnyPgTable } from 'drizzle-orm/pg-core'

/**
 * An in-memory stand-in for the Drizzle client, used by the timeline-safety
 * suites. It is not a general Postgres emulator: it renders each statement's
 * WHERE with the real Drizzle dialect and then evaluates that SQL against plain
 * JS rows, so a test that asserts "this row survived" is asserting against the
 * predicate the production code actually generates. Widening a WHERE (dropping
 * an id scope, dropping a filter) changes the rendered SQL and therefore the
 * rows the fake touches — which is exactly the regression we want to catch.
 *
 * Supported WHERE grammar: and / or / parentheses / `= $n` / `<> $n` /
 * `in ($n, ...)` / `is null` / `is not null`. Anything else throws rather than
 * silently matching everything.
 */

export type Row = Record<string, unknown>
export type RenderedWhere = { sql: string; params: unknown[] }

export type Statement =
  | { kind: 'select'; table: string; where: RenderedWhere | null }
  | { kind: 'insert'; table: string; rows: Row[] }
  | { kind: 'update'; table: string; set: Row; where: RenderedWhere | null; matched: number }
  | { kind: 'delete'; table: string; where: RenderedWhere | null; matched: number }

const dialect = new PgDialect()

function camel(snake: string) {
  return snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

function render(where: unknown): RenderedWhere | null {
  if (!where) return null
  const q = dialect.sqlToQuery(where as SQL)
  return { sql: q.sql, params: q.params as unknown[] }
}

class WhereParser {
  private i = 0
  constructor(private readonly text: string, private readonly params: unknown[]) {}

  parse(row: Row): boolean {
    const value = this.or(row)
    this.ws()
    if (this.i < this.text.length) {
      throw new Error(`fake-db: unparsed WHERE remainder: ${this.text.slice(this.i)}`)
    }
    return value
  }

  private ws() {
    while (this.text[this.i] === ' ') this.i++
  }

  private eat(token: string) {
    this.ws()
    if (this.text.startsWith(token, this.i)) {
      this.i += token.length
      return true
    }
    return false
  }

  private or(row: Row): boolean {
    let value = this.and(row)
    while (this.eat('or ')) value = this.and(row) || value
    return value
  }

  private and(row: Row): boolean {
    let value = this.atom(row)
    while (this.eat('and ')) value = this.atom(row) && value
    return value
  }

  private atom(row: Row): boolean {
    this.ws()
    if (this.eat('(')) {
      const value = this.or(row)
      if (!this.eat(')')) throw new Error('fake-db: unbalanced parenthesis in WHERE')
      return value
    }
    // `inArray(col, [])` renders as a bare literal.
    if (this.eat('false')) return false
    if (this.eat('true')) return true
    return this.comparison(row)
  }

  private comparison(row: Row): boolean {
    this.ws()
    const column = /^"[a-z_]+"\."([a-z_]+)"/.exec(this.text.slice(this.i))
    if (!column) throw new Error(`fake-db: unsupported WHERE fragment: ${this.text.slice(this.i)}`)
    this.i += column[0].length
    const actual = row[camel(column[1])]

    if (this.eat('is not null')) return actual !== null && actual !== undefined
    if (this.eat('is null')) return actual === null || actual === undefined
    if (this.eat('in (')) {
      const values: unknown[] = []
      do values.push(this.placeholder())
      while (this.eat(','))
      if (!this.eat(')')) throw new Error('fake-db: unbalanced IN list in WHERE')
      return values.some((v) => v === actual)
    }
    if (this.eat('<>')) return this.placeholder() !== actual
    if (this.eat('=')) return this.placeholder() === actual
    throw new Error(`fake-db: unsupported operator in WHERE: ${this.text.slice(this.i)}`)
  }

  private placeholder(): unknown {
    this.ws()
    const match = /^\$(\d+)/.exec(this.text.slice(this.i))
    if (!match) throw new Error(`fake-db: expected a placeholder at: ${this.text.slice(this.i)}`)
    this.i += match[0].length
    return this.params[Number(match[1]) - 1]
  }
}

function matches(row: Row, where: RenderedWhere | null): boolean {
  if (!where) return true
  return new WhereParser(where.sql, where.params).parse(row)
}

function project(row: Row, fields: Record<string, unknown> | undefined): Row {
  if (!fields) return { ...row }
  const out: Row = {}
  for (const [alias, column] of Object.entries(fields)) {
    out[alias] = is(column as never, Column)
      ? row[camel((column as unknown as { name: string }).name)]
      : undefined
  }
  return out
}

export function createFakeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {}
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }))

  const statements: Statement[] = []
  let generated = 0

  const rowsOf = (table: AnyPgTable) => {
    const name = getTableName(table)
    tables[name] ??= []
    return tables[name]
  }

  function thenable<T>(run: () => T) {
    const chain: Record<string, unknown> = {}
    const self = () => chain
    chain.from = self
    chain.innerJoin = self
    chain.leftJoin = self
    chain.orderBy = self
    chain.limit = self
    chain.for = self
    chain.onConflictDoNothing = self
    chain.then = (resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) => {
      try {
        return Promise.resolve(resolve(run()))
      } catch (err) {
        return reject ? Promise.resolve(reject(err)) : Promise.reject(err)
      }
    }
    return chain
  }

  const client = {
    select(fields?: Record<string, unknown>) {
      let table: AnyPgTable | null = null
      let where: RenderedWhere | null = null
      const chain: Record<string, unknown> = {}
      const run = () => {
        const name = getTableName(table!)
        statements.push({ kind: 'select', table: name, where })
        return rowsOf(table!)
          .filter((r) => matches(r, where))
          .map((r) => project(r, fields))
      }
      chain.from = (t: AnyPgTable) => { table = t; return chain }
      chain.innerJoin = () => chain
      chain.leftJoin = () => chain
      chain.orderBy = () => chain
      chain.limit = () => chain
      // Row locks are a no-op here — the fake is single-threaded. `.for()` is
      // accepted so a locking read still renders and evaluates its predicate.
      chain.for = () => chain
      chain.where = (cond: unknown) => { where = render(cond); return chain }
      chain.then = (resolve: (v: Row[]) => unknown, reject?: (e: unknown) => unknown) => {
        try {
          return Promise.resolve(resolve(run()))
        } catch (err) {
          return reject ? Promise.resolve(reject(err)) : Promise.reject(err)
        }
      }
      return chain
    },

    insert(table: AnyPgTable) {
      const chain: Record<string, unknown> = {}
      let inserted: Row[] = []
      chain.values = (values: Row | Row[]) => {
        const list = Array.isArray(values) ? values : [values]
        inserted = list.map((v) => ({ id: `generated-${++generated}`, ...v }))
        rowsOf(table).push(...inserted)
        statements.push({ kind: 'insert', table: getTableName(table), rows: inserted })
        return chain
      }
      chain.onConflictDoNothing = () => chain
      chain.returning = () => thenable(() => inserted.map((r) => ({ ...r })))
      chain.then = (resolve: (v: Row[]) => unknown) => Promise.resolve(resolve(inserted))
      return chain
    },

    update(table: AnyPgTable) {
      const chain: Record<string, unknown> = {}
      let values: Row = {}
      let where: RenderedWhere | null = null
      const run = () => {
        const hit = rowsOf(table).filter((r) => matches(r, where))
        for (const row of hit) {
          for (const [key, value] of Object.entries(values)) {
            // A raw SQL set-value (the bulk-push CASE expression) is recorded
            // but not applied — the fake evaluates predicates, not expressions.
            if (!is(value as never, SQL)) row[key] = value
          }
        }
        statements.push({ kind: 'update', table: getTableName(table), set: values, where, matched: hit.length })
        return hit.map((r) => ({ ...r }))
      }
      chain.set = (v: Row) => { values = v; return chain }
      chain.where = (cond: unknown) => { where = render(cond); return chain }
      chain.returning = () => thenable(run)
      chain.then = (resolve: (v: Row[]) => unknown, reject?: (e: unknown) => unknown) => {
        try {
          return Promise.resolve(resolve(run()))
        } catch (err) {
          return reject ? Promise.resolve(reject(err)) : Promise.reject(err)
        }
      }
      return chain
    },

    delete(table: AnyPgTable) {
      const chain: Record<string, unknown> = {}
      let where: RenderedWhere | null = null
      const run = (fields?: Record<string, unknown>) => {
        const list = rowsOf(table)
        const hit = list.filter((r) => matches(r, where))
        for (const row of hit) list.splice(list.indexOf(row), 1)
        statements.push({ kind: 'delete', table: getTableName(table), where, matched: hit.length })
        return hit.map((r) => project(r, fields))
      }
      chain.where = (cond: unknown) => { where = render(cond); return chain }
      chain.returning = (fields?: Record<string, unknown>) => thenable(() => run(fields))
      chain.then = (resolve: (v: Row[]) => unknown, reject?: (e: unknown) => unknown) => {
        try {
          return Promise.resolve(resolve(run()))
        } catch (err) {
          return reject ? Promise.resolve(reject(err)) : Promise.reject(err)
        }
      }
      return chain
    },

    async transaction<T>(cb: (tx: unknown) => Promise<T>): Promise<T> {
      return cb(client)
    },
  }

  return {
    db: client,
    tables,
    statements,
    rows(table: string): Row[] {
      return tables[table] ?? []
    },
    reset() {
      statements.length = 0
    },
  }
}
