import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { findLiveConstitutionRow } from '@/lib/data/constitution'
import { BELIEF_TYPE, readBelief, type BeliefMind } from '@/lib/kairos/beliefs/types'
import { toLiveConstitution, type Principle } from '@/lib/kairos/constitution/schema'

// Conscience readers (P2.5 G4): the norms Kairos reads at answer time — the
// live constitution's principles and the weightiest held beliefs. Pure DB,
// user-scoped, no auth. Rendering lives in lib/kairos/conscience-context.ts.

export interface ConsciencePrinciples {
  version: number
  principles: Principle[]
}

// The live constitution (streamClass 'constitution', supersededAt null), or
// null when none has been accepted yet or its metadata does not parse.
export async function getConsciencePrinciples(userId: string): Promise<ConsciencePrinciples | null> {
  const row = await findLiveConstitutionRow(userId)
  const live = row ? toLiveConstitution(row) : null
  return live ? { version: live.version, principles: live.principles } : null
}

export interface ConscienceBelief {
  // Row id (internal use, e.g. dream_read's fragile-belief link); never rendered.
  id?: string
  mind: BeliefMind
  domain: string
  dominionId: string | null
  claim: string
  confidence: number
}

const beliefField = (key: string) => sql`${memories.sourceMetadata}->'belief'->>${key}`

// Held beliefs ranked by standing (then confidence, then recency). With a
// dominionId: that Dominion's beliefs first, then global ('general', no
// Dominion) ones — other Dominions' beliefs are excluded.
export async function listConscienceBeliefs(
  userId: string,
  opts: { dominionId?: string | null; limit?: number } = {},
): Promise<ConscienceBelief[]> {
  const conds: SQL[] = [
    eq(memories.userId, userId),
    eq(memories.type, BELIEF_TYPE),
    isNull(memories.supersededAt),
    isNull(memories.archivedAt),
    sql`${beliefField('status')} = 'held'`,
  ]
  const order: SQL[] = []
  if (opts.dominionId) {
    conds.push(sql`(${memories.dominionId} = ${opts.dominionId} OR ${memories.dominionId} IS NULL)`)
    order.push(sql`(CASE WHEN ${memories.dominionId} = ${opts.dominionId} THEN 0 ELSE 1 END)`)
  }
  order.push(sql`${memories.standing} DESC NULLS LAST`, sql`${memories.confidence} DESC NULLS LAST`, desc(memories.updatedAt))

  const rows = await db
    .select({ id: memories.id, sourceMetadata: memories.sourceMetadata })
    .from(memories)
    .where(and(...conds))
    .orderBy(...order)
    .limit(Math.min(Math.max(opts.limit ?? 12, 1), 50))
  return rows.flatMap((r) => {
    const b = readBelief(r.sourceMetadata)
    if (!b || b.status !== 'held') return []
    return [{ id: r.id, mind: b.mind, domain: b.domain, dominionId: b.dominionId, claim: b.claim, confidence: b.confidence }]
  })
}
