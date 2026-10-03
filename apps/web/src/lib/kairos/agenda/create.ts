import { randomUUID } from 'node:crypto'
import { londonDate } from '@/lib/kairos/daily-message-prompt'
import { mutateKairosAgenda } from '@/lib/data/kairos-agenda'
import {
  MAX_AGENDA_PER_DAY,
  MAX_AGENDA_PER_JOB,
  MAX_OPEN_AGENDA,
  agendaProposalSchema,
  agendaSourceSchema,
  type AgendaSource,
  type KairosAgendaItem,
} from '@/lib/data/validators/kairos-agenda'
import { agendaEnabled } from './flag'
import { agendaDueAt, checkAgendaWhat, createdOnLondonDay, isDueAtInWindow, normaliseWhat, type AgendaWhatProblem } from './rules'

// Kairos books Horae items only through the server: goal approval check-ins,
// reflect follow-ups (wave 2) and one agenda_due rebook. Never from MCP or
// REST. Every field is re-validated here; status is always 'open', the time
// of day comes from the slot, and the caps hold under the row lock.

export type AgendaRejectReason =
  | 'disabled'
  | 'invalid'
  | AgendaWhatProblem
  | 'due_out_of_window'
  | 'over_per_job_cap'
  | 'over_daily_cap'
  | 'over_open_cap'
  | 'duplicate'

export interface CreateAgendaResult {
  created: KairosAgendaItem[]
  rejected: Array<{ index: number; reason: AgendaRejectReason }>
}

export interface CreateAgendaOptions {
  now?: Date
  // 1 only for an agenda_due rebook of a first-generation item.
  rebookDepth?: 0 | 1
  // When given, basisIds outside this set are dropped (grounding).
  validBasisIds?: ReadonlySet<string>
}

interface Candidate {
  index: number
  what: string
  dueAt: string
  basisIds: string[]
  dominionId: string | null
  goalId?: string
}

function sameSource(item: KairosAgendaItem, src: AgendaSource): boolean {
  if (item.source.kind !== src.kind) return false
  if (src.jobId) return item.source.jobId === src.jobId
  return !!src.goalId && item.source.goalId === src.goalId
}

export async function createAgendaItems(
  userId: string,
  proposals: readonly unknown[],
  source: AgendaSource,
  opts: CreateAgendaOptions = {},
): Promise<CreateAgendaResult> {
  const now = opts.now ?? new Date()
  if (!agendaEnabled()) return { created: [], rejected: proposals.map((_, index) => ({ index, reason: 'disabled' as const })) }
  const src = agendaSourceSchema.parse(source)
  const rebookDepth = opts.rebookDepth ?? 0
  const rejected: CreateAgendaResult['rejected'] = []
  const candidates: Candidate[] = []

  for (const [index, raw] of proposals.entries()) {
    if (index >= MAX_AGENDA_PER_JOB) { rejected.push({ index, reason: 'over_per_job_cap' }); continue }
    const parsed = agendaProposalSchema.safeParse(raw)
    if (!parsed.success) { rejected.push({ index, reason: 'invalid' }); continue }
    const p = parsed.data
    const problem = checkAgendaWhat(p.what)
    if (problem) { rejected.push({ index, reason: problem }); continue }
    const dueAt = agendaDueAt(p.date, p.slot)
    if (!isDueAtInWindow(dueAt, now)) { rejected.push({ index, reason: 'due_out_of_window' }); continue }
    const basis = [...new Set(p.basisIds ?? [])].filter((id) => !opts.validBasisIds || opts.validBasisIds.has(id))
    const goalId = p.goalId ?? src.goalId
    candidates.push({ index, what: p.what, dueAt, basisIds: basis, dominionId: p.dominionId ?? null, ...(goalId ? { goalId } : {}) })
  }

  if (candidates.length === 0) return { created: [], rejected }

  const ids = candidates.map(() => randomUUID())
  const today = londonDate(now)
  const late = await mutateKairosAgenda(userId, (state) => {
    const created: KairosAgendaItem[] = []
    const lateRejects: CreateAgendaResult['rejected'] = []
    const seen = new Set(state.open.map((i) => normaliseWhat(i.what)))
    const bySource = src.jobId || src.goalId ? [...state.open, ...state.closed].filter((i) => sameSource(i, src)).length : 0
    const madeToday = createdOnLondonDay(state, today)
    let nextSeq = state.nextSeq
    for (const [i, c] of candidates.entries()) {
      const key = normaliseWhat(c.what)
      if (seen.has(key)) { lateRejects.push({ index: c.index, reason: 'duplicate' }); continue }
      if (bySource + created.length >= MAX_AGENDA_PER_JOB) { lateRejects.push({ index: c.index, reason: 'over_per_job_cap' }); continue }
      if (madeToday + created.length >= MAX_AGENDA_PER_DAY) { lateRejects.push({ index: c.index, reason: 'over_daily_cap' }); continue }
      if (state.open.length + created.length >= MAX_OPEN_AGENDA) { lateRejects.push({ index: c.index, reason: 'over_open_cap' }); continue }
      seen.add(key)
      created.push({
        id: ids[i]!,
        seq: nextSeq++,
        what: c.what,
        dueAt: c.dueAt,
        createdAt: now.toISOString(),
        source: src,
        basisIds: c.basisIds,
        dominionId: c.dominionId,
        ...(c.goalId ? { goalId: c.goalId } : {}),
        rebookDepth,
        status: 'open',
      })
    }
    if (created.length === 0) return { state: null, result: { created, lateRejects } }
    return { state: { ...state, nextSeq, open: [...state.open, ...created] }, result: { created, lateRejects } }
  })

  return {
    created: late.created,
    rejected: [...rejected, ...late.lateRejects].sort((a, b) => a.index - b.index),
  }
}
