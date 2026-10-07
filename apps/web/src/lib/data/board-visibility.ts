import { sql } from 'drizzle-orm'
import { projects } from '@/lib/db/schema'

// Read-only board visibility predicates for the Archive switch. Literal SQL
// (no bound params) so adding one to a where clause never shifts $n numbering.

export const notArchivedSql = sql`(${projects.settings} ->> 'archived') is distinct from 'true'`

export const archivedSql = sql`(${projects.settings} ->> 'archived') = 'true'`
