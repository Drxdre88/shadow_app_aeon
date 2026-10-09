import { listOpenKairosAsks } from '@/lib/data/ask'
import { listSurvivorsSince } from '@/lib/data/ideas'
import { listOpenGoals } from '@/lib/data/goals'
import { listPendingCardTrees } from '@/lib/data/card-tree-proposals'
import { readKairosPredictions } from '@/lib/data/kairos-predictions'
import { predictionsEnabled } from '../predictions/flag'
import { pickVerdicts } from '../daily-message-tail'
import type { DeckCandidate } from './types'

// Everything waiting on the owner's verdict, for the Sunday deck. Each source
// is best-effort: a failed read drops that source (named in `failed`), never
// the deck. Undecided idea survivors are those still pending (expiry archives
// them after 7 days, so 8 days back covers every one). The decision journal is
// deliberately absent: nothing in Vorath reads it (consult 7867f277); the
// owner settles decisions with D commands or in the app.

const DAY_MS = 86_400_000
const IDEA_LOOKBACK_MS = 8 * DAY_MS
const SCAN = 50

export interface DeckGather { candidates: DeckCandidate[]; failed: string[] }

async function ideas(userId: string, now: Date): Promise<DeckCandidate[]> {
  const rows = await listSurvivorsSince(userId, new Date(now.getTime() - IDEA_LOOKBACK_MS), SCAN)
  return rows
    .filter((r) => r.status === 'pending')
    .map((r) => ({ kind: 'idea' as const, id: r.id, label: null, title: r.title || r.claim, since: r.createdAt.toISOString() }))
}

async function asks(userId: string, now: Date): Promise<DeckCandidate[]> {
  return (await listOpenKairosAsks(userId, now)).map((a) => ({
    kind: 'ask' as const, id: a.id, label: `Q${a.seq}`, title: a.title, since: a.kairosAsk.askedAt || a.createdAt.toISOString(),
  }))
}

async function predictions(userId: string, now: Date): Promise<DeckCandidate[]> {
  if (!predictionsEnabled()) return []
  const open = (await readKairosPredictions(userId)).open
  const due = new Set(pickVerdicts(open, now).map((v) => v.seq))
  return open
    .filter((p) => due.has(p.seq))
    .map((p) => ({ kind: 'prediction' as const, id: p.id, label: `R${p.seq}`, title: p.claim, since: `${p.dueDate}T00:00:00.000Z` }))
}

async function proposals(userId: string, now: Date): Promise<DeckCandidate[]> {
  const [goals, trees] = await Promise.all([listOpenGoals(userId, now), listPendingCardTrees(userId, now, SCAN)])
  return [
    ...goals
      .filter((g) => g.meta.state === 'proposed')
      .map((g) => ({ kind: 'proposal' as const, id: g.id, label: 'Goal', title: g.title || g.meta.question, since: g.createdAt.toISOString() })),
    ...trees.map((t) => ({ kind: 'proposal' as const, id: t.id, label: 'Cards', title: t.title, since: t.createdAt.toISOString() })),
  ]
}

export async function gatherDeckCandidates(userId: string, now: Date): Promise<DeckGather> {
  const failed: string[] = []
  const safe = async (name: string, fn: () => Promise<DeckCandidate[]>) => {
    try {
      return await fn()
    } catch (err) {
      console.warn(`[kairos:verdict-deck] source ${name} failed:`, err instanceof Error ? err.message : err)
      failed.push(name)
      return []
    }
  }
  const parts = await Promise.all([
    safe('ideas', () => ideas(userId, now)),
    safe('asks', () => asks(userId, now)),
    safe('predictions', () => predictions(userId, now)),
    safe('proposals', () => proposals(userId, now)),
  ])
  return { candidates: parts.flat(), failed }
}
