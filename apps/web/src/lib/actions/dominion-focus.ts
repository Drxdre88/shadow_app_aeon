'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireVorath } from './helpers'
import { listLiveDominions, rankByActivity, setDominionPinned, type FocusDominion } from '@/lib/data/dominion-focus'
import { getUnattributedActivity } from '@/lib/data/dominion-activity'
import { livingDominionsMode, type LivingDominionsMode } from '@/lib/kairos/living/flag'
import type { DominionActivity, ScoredBoard, ScoredRepo, UnattributedActivity } from '@/lib/kairos/living/types'

export type FocusDominionView = {
  id: string
  name: string
  color: string
  activityScore: number
  lastActiveAt: string | null
  activityScoredAt: string | null
  activity: DominionActivity | null
  focusState: string
  pinned: boolean
  dormant: boolean
}

export type FocusOverview = {
  mode: LivingDominionsMode
  generatedAt: string
  dominions: FocusDominionView[]
  unattributed: UnattributedActivity | null
}

const setPinnedSchema = z.object({
  dominionId: z.string().uuid(),
  pinned: z.boolean(),
})

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null
}

function list<T>(raw: unknown): T[] {
  return Array.isArray(raw) ? (raw as T[]) : []
}

function count(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
}

function toActivity(raw: unknown): DominionActivity | null {
  if (!raw || typeof raw !== 'object') return null
  const a = raw as Record<string, unknown>
  return {
    windowDays: count(a.windowDays),
    scoredAt: typeof a.scoredAt === 'string' ? a.scoredAt : '',
    boards: list<ScoredBoard>(a.boards),
    repos: list<ScoredRepo>(a.repos),
    sessions: count(a.sessions),
    cardsFinished: count(a.cardsFinished),
    notes: count(a.notes),
  }
}

function toView(d: FocusDominion): FocusDominionView {
  return {
    id: d.id,
    name: d.name,
    color: d.color,
    activityScore: d.activityScore ?? 0,
    lastActiveAt: iso(d.lastActiveAt),
    activityScoredAt: iso(d.activityScoredAt),
    activity: toActivity(d.activity),
    focusState: d.focusState,
    pinned: d.pinned,
    dormant: d.dormant,
  }
}

// "Where your time went" in Vorath → Health: live Dominions ranked by activity
// (also in watch-only mode, where the shared roster keeps the old order).
export async function getFocusOverview(): Promise<FocusOverview> {
  const userId = await requireVorath()
  const [rows, unattributed] = await Promise.all([listLiveDominions(userId), getUnattributedActivity(userId)])
  return {
    mode: livingDominionsMode(),
    generatedAt: new Date().toISOString(),
    dominions: rankByActivity(rows).map(toView),
    unattributed: unattributed ?? null,
  }
}

export async function setDominionPinnedAction(input: { dominionId: string; pinned: boolean }) {
  const userId = await requireVorath()
  const { dominionId, pinned } = setPinnedSchema.parse(input)
  const row = await setDominionPinned(dominionId, userId, pinned)
  if (!row) throw new Error('Area not found or unauthorized')
  revalidatePath('/vorath')
  return { dominionId: row.id, pinned: row.pinned, focusState: row.focusState }
}
