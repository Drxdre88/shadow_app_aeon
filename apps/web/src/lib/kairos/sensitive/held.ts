import { sql } from 'drizzle-orm'
import { memories } from '@/lib/db/schema'
import { SENSITIVE_HELD_KEY } from './meta'

// The one spelling of "held for the owner's review" in SQL. Literal SQL (no
// bound params) so a predicate never shifts the param list of the query it joins.
const HELD = sql.raw(`'${SENSITIVE_HELD_KEY}'`)
const ALIAS_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

// Rows not held: every reader whose row text can reach a prompt or a message.
export const notHeldSensitive = sql`(${memories.sourceMetadata}->>${HELD}) IS DISTINCT FROM 'true'`

// Rows still held: the owner's "Needs your eyes" list.
export const heldSensitive = sql`(${memories.sourceMetadata}->>${HELD}) = 'true'`

// notHeldSensitive for raw SQL over an aliased memories table (e.g. `m`).
export function notHeldSensitiveRaw(alias: string): string {
  if (!ALIAS_RE.test(alias)) throw new Error(`invalid table alias: ${alias}`)
  return `(${alias}.source_metadata->>'${SENSITIVE_HELD_KEY}') IS DISTINCT FROM 'true'`
}
