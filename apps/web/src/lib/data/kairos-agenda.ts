import { db } from '@/lib/db'
import { userPreferences } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { KAIROS_AGENDA_PREF_KEY } from './preferences'
import {
  kairosAgendaStateSchema,
  type KairosAgendaItem,
  type KairosAgendaState,
  type ListKairosAgendaInput,
} from './validators/kairos-agenda'

// Horae (Kairos's agenda) lives as the server-owned `kairosAgenda` key inside
// user_preferences.preferences (no schema change). This module is the ONLY
// writer: every write runs mutateKairosAgenda — SELECT … FOR UPDATE on the
// user's preferences row inside db.transaction, a pure mutation, then a jsonb
// merge of just this key. upsertPreferences (theme sync) strips and carries
// the key over, so a theme save can neither set nor wipe it.

export class KairosAgendaCorruptError extends Error {
  constructor(detail: string) {
    super(`kairosAgenda preference is malformed: ${detail}`)
    this.name = 'KairosAgendaCorruptError'
  }
}

export function emptyAgendaState(): KairosAgendaState {
  return { v: 1, nextSeq: 1, open: [], closed: [] }
}

// Missing key = nothing booked yet. A present but malformed blob throws so no
// write path can silently clobber it.
export function parseAgendaState(raw: unknown): KairosAgendaState {
  if (raw === undefined || raw === null) return emptyAgendaState()
  const parsed = kairosAgendaStateSchema.safeParse(raw)
  if (!parsed.success) throw new KairosAgendaCorruptError(parsed.error.issues[0]?.message ?? 'invalid')
  return parsed.data
}

const agendaValue = sql<unknown>`${userPreferences.preferences} -> ${KAIROS_AGENDA_PREF_KEY}::text`

export async function readKairosAgenda(userId: string): Promise<KairosAgendaState> {
  const row = await db
    .select({ value: agendaValue })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .then((rows) => rows[0])
  return parseAgendaState(row?.value)
}

// `state: null` = nothing to write. The mutation must be pure: it can run a
// second time if a concurrent first insert of the preferences row wins.
export type AgendaMutation<R> = (state: KairosAgendaState) => { state: KairosAgendaState | null; result: R }

export async function mutateKairosAgenda<R>(userId: string, mutate: AgendaMutation<R>): Promise<R> {
  return db.transaction(async (tx) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const rows = await tx
        .select({ value: agendaValue })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .for('update')
      const { state, result } = mutate(parseAgendaState(rows[0]?.value))
      if (!state) return result
      const next = kairosAgendaStateSchema.parse(state)
      if (rows.length > 0) {
        await tx
          .update(userPreferences)
          .set({
            preferences: sql`${userPreferences.preferences} || jsonb_build_object(${KAIROS_AGENDA_PREF_KEY}::text, ${JSON.stringify(next)}::jsonb)`,
            updatedAt: new Date(),
          })
          .where(eq(userPreferences.userId, userId))
        return result
      }
      const inserted = await tx
        .insert(userPreferences)
        .values({ userId, preferences: { [KAIROS_AGENDA_PREF_KEY]: next }, updatedAt: new Date() })
        .onConflictDoNothing()
        .returning({ userId: userPreferences.userId })
      if (inserted.length > 0) return result
    }
    throw new Error('kairos-agenda: could not lock the preferences row')
  })
}

// ── Reads ────────────────────────────────────────────────────────────────

export interface KairosAgendaView {
  id: string
  number: string
  seq: number
  what: string
  dueAt: string
  status: KairosAgendaItem['status']
  source: KairosAgendaItem['source']['kind']
  goalId: string | null
  dominionId: string | null
  createdAt: string
  closedAt: string | null
  result: KairosAgendaItem['result'] | null
  cancelledBy: NonNullable<KairosAgendaItem['cancelledBy']>['kind'] | null
}

export function toKairosAgendaView(item: KairosAgendaItem): KairosAgendaView {
  return {
    id: item.id,
    number: `A${item.seq}`,
    seq: item.seq,
    what: item.what,
    dueAt: item.dueAt,
    status: item.status,
    source: item.source.kind,
    goalId: item.goalId ?? null,
    dominionId: item.dominionId,
    createdAt: item.createdAt,
    closedAt: item.closedAt ?? null,
    result: item.result ?? null,
    cancelledBy: item.cancelledBy?.kind ?? null,
  }
}

// Open (and fired, not yet settled) items by due time; scope 'all' appends
// the closed history (newest first).
export async function listKairosAgenda(userId: string, input: ListKairosAgendaInput): Promise<KairosAgendaItem[]> {
  const state = await readKairosAgenda(userId)
  const open = [...state.open].sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.seq - b.seq)
  return input.scope === 'all' ? [...open, ...state.closed] : open
}

// The A-number lookup ("cancel A3"): the still-open item numbered `seq`, or null.
export async function findOpenKairosAgendaBySeq(userId: string, seq: number): Promise<KairosAgendaItem | null> {
  const state = await readKairosAgenda(userId)
  return state.open.find((i) => i.seq === seq && i.status === 'open') ?? null
}
