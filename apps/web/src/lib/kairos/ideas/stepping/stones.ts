// One reader for what happened to an idea row (outcome, ignored, eliminated), shared by stones and taste.

export const IGNORED_AFTER_DAYS = 7
const DAY_MS = 86_400_000
const JUDGE_FAILED = 'judge_failed'

export interface IdeaRowLike {
  dominionId?: string | null
  title?: string
  sourceMetadata: unknown
  archivedAt: Date | null
  createdAt: Date
}

export type IdeaSignal = 'accepted' | 'dismissed' | 'ignored'

export interface RowOutcome {
  signal: IdeaSignal | null
  by: 'operator' | 'agent' | null
}

export type SteppingStoneReason =
  | 'owner_dismissed'
  | 'ignored'
  | 'ungrounded'
  | 'contradicted'
  | 'already_known'
  | 'not_different'
  | 'ranked_out'

export interface SteppingStone {
  title: string
  claim: string
  reason: SteppingStoneReason
}

const STONE_ELIMINATIONS: ReadonlySet<string> = new Set(['ungrounded', 'contradicted', 'already_known', 'not_different', 'ranked_out'])

export function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

export const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

export const ideaOf = (row: IdeaRowLike): Record<string, unknown> => asRecord(asRecord(row.sourceMetadata).idea)

// A survivor's owner signal. Agent accepts are reported with by 'agent'; promoted rows have none.
export function rowOutcome(row: IdeaRowLike, now: Date, opts: { pendingIgnored?: boolean } = {}): RowOutcome {
  const meta = asRecord(row.sourceMetadata)
  const idea = asRecord(meta.idea)
  if (Object.keys(idea).length === 0) return { signal: null, by: null }
  const by = idea.outcomeBy === 'agent' ? 'agent' : 'operator'
  if (idea.outcome === 'accepted') return { signal: 'accepted', by }
  if (idea.outcome === 'dismissed') return { signal: 'dismissed', by: 'operator' }
  const status = str(meta.status) ?? 'pending'
  if (status === 'accepted') return { signal: 'accepted', by: 'operator' }
  if (row.archivedAt && (status === 'pending' || status === 'dismissed')) return { signal: 'dismissed', by: 'operator' }
  if (status === 'decayed') return { signal: 'ignored', by: null }
  const stale = now.getTime() - row.createdAt.getTime() > IGNORED_AFTER_DAYS * DAY_MS
  if (opts.pendingIgnored && status === 'pending' && !row.archivedAt && stale) return { signal: 'ignored', by: null }
  return { signal: null, by: null }
}

// Why an archived idea is a stepping stone; null when it is not one (accepted, repeat, unjudged).
export function steppingStoneReason(row: IdeaRowLike, now: Date): SteppingStoneReason | null {
  const idea = ideaOf(row)
  const status = str(idea.status)
  if (status === 'eliminated') {
    const reason = str(idea.eliminatedReason)
    return reason && reason !== JUDGE_FAILED && STONE_ELIMINATIONS.has(reason) ? (reason as SteppingStoneReason) : null
  }
  if (status !== 'survivor') return null
  const { signal } = rowOutcome(row, now)
  if (signal === 'dismissed') return 'owner_dismissed'
  if (signal === 'ignored') return 'ignored'
  return null
}

export function toSteppingStone(row: IdeaRowLike, now: Date): SteppingStone | null {
  const reason = steppingStoneReason(row, now)
  if (!reason) return null
  const claim = str(ideaOf(row).claim) ?? ''
  const title = row.title?.trim() ?? ''
  return title || claim ? { title, claim, reason } : null
}
