import { z } from 'zod'
import { listNearMissCandidates } from '@/lib/data/idea-shelf'
import { mutateKairosIdeaShelf, readKairosIdeaShelf } from '@/lib/data/kairos-idea-shelf'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'
import type { StageCandidateInput } from '@/lib/kairos/stage'
import { STAGE_BASE } from '@/lib/kairos/thinking/stage-thoughts'
import { ideaShelfMode } from './flag'
import { laterNote, parseLater, renderShelfSection, withLaterField } from './prompt'
import { applyOffer, applyResurface, pickNearMisses, pickOffer, shelfWindow } from './shelf'

// Incubation inside the hourly pulse. plan: pick ≤1 ripe near-miss and show
// it (mode 1) or just record it (observe). apply: if the model connected
// today to it, one today note "It came to me later: …" and one light stage
// thought. It never sends a message and never writes a memory.

export const RESURFACE_SURPRISE = 0.6

export interface PulseShelfPlan {
  system: (base: string) => string
  promptSuffix: string
  context: Record<string, unknown>
}

export interface PulseShelfApply {
  line: string | null
  thought: StageCandidateInput | null
  output: Record<string, unknown>
}

const offeredSchema = z.object({ id: z.string().min(1), title: z.string(), date: z.string() })
const observedSchema = z.object({ id: z.string().min(1), date: z.string() })
const shelfContextSchema = z.object({ shelf: offeredSchema.optional(), shelfObserved: observedSchema.optional() })

const warn = (what: string, err: unknown) =>
  console.warn(`[kairos:incubation] ${what}:`, err instanceof Error ? err.message : String(err))

// null = nothing to add (flag off, nothing ripe, or a read failed): the pulse is unchanged.
export async function planPulseShelf(userId: string, now: Date, slot: string): Promise<PulseShelfPlan | null> {
  const mode = ideaShelfMode()
  if (mode === 'off') return null
  try {
    const { fromDay, toDay } = shelfWindow(now)
    const [rows, shelf] = await Promise.all([listNearMissCandidates(userId, fromDay, toDay), readKairosIdeaShelf(userId)])
    const nearMisses = pickNearMisses(rows)
    const pick = pickOffer(nearMisses, shelf, now)
    if (!pick) return null
    if (mode === 'observe') {
      return { system: (s) => s, promptSuffix: '', context: { shelfObserved: { id: pick.id, date: pick.tournamentDate } } }
    }
    const offered = await mutateKairosIdeaShelf(userId, (locked) => {
      if (pickOffer(nearMisses, locked, now)?.id !== pick.id) return { state: null, result: false }
      return { state: applyOffer(locked, pick.id, slot, now), result: true }
    }, now)
    if (!offered) return null
    return {
      system: withLaterField,
      promptSuffix: renderShelfSection(pick),
      context: { shelf: { id: pick.id, title: pick.title, date: pick.tournamentDate } },
    }
  } catch (err) {
    warn('offer skipped', err)
    return null
  }
}

// null = this pulse carried no shelf item: the apply is unchanged.
export async function applyPulseShelf(job: ThinkingJobRow, text: string, now: Date): Promise<PulseShelfApply | null> {
  const parsed = shelfContextSchema.safeParse(job.input?.context ?? {})
  if (!parsed.success) return null
  const { shelf, shelfObserved } = parsed.data
  if (shelfObserved && !shelf) return { line: null, thought: null, output: { shelf: { observed: shelfObserved.id } } }
  if (!shelf || ideaShelfMode() !== 'on') return null
  const later = parseLater(text, shelf.id)
  if (!later) return { line: null, thought: null, output: { shelf: { offered: shelf.id, resurfaced: false } } }
  let resurfaced = false
  try {
    resurfaced = await mutateKairosIdeaShelf(job.userId, (locked) => {
      const state = applyResurface(locked, shelf.id, now)
      return { state, result: state !== null }
    }, now)
  } catch (err) {
    warn('resurface skipped', err)
  }
  if (!resurfaced) return { line: null, thought: null, output: { shelf: { offered: shelf.id, resurfaced: false } } }
  const line = laterNote(shelf.title, later.connection)
  const thought: StageCandidateInput = { ...STAGE_BASE, text: line, surprise: RESURFACE_SURPRISE, cites: [shelf.id] }
  return { line, thought, output: { shelf: { offered: shelf.id, resurfaced: true } } }
}
