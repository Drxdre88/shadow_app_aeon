import type { OwnerTurnEvent, ReplyEvent } from '@/lib/kairos/moment/types'
import { anyRapportFlag, rapportModes, type RapportModes } from './flag'
import { scoreChangeTalk, hasChangeTalk } from './lexicon'
import { markRepaired } from './repair'
import { applyOwnerTurn, stampTipAnswered, type ObjectiveRef } from './state'

export const chatRef = (threadId: string, seq: number): string => `chat:${threadId}:${seq}`.slice(0, 100)

export interface OwnerTurnDeps {
  modes?: RapportModes
  listObjectives?: (userId: string) => Promise<ObjectiveRef[]>
}

// Every owner chat turn (detached by the seam; never on the reply path).
// All flags off → returns before any import.
export async function onOwnerTurn(event: OwnerTurnEvent, deps: OwnerTurnDeps = {}): Promise<void> {
  const modes = deps.modes ?? rapportModes()
  if (!anyRapportFlag(modes)) return
  const data = await import('@/lib/data/kairos-rapport')
  const wantsGoals = modes.readiness !== 'off' && hasChangeTalk(scoreChangeTalk(event.body))
  const objectives = wantsGoals ? await (deps.listObjectives ?? data.listObjectiveRefs)(event.userId) : []
  const effects = await data.mutateKairosRapport(event.userId, (state) => {
    const out = applyOwnerTurn(state, { ref: chatRef(event.threadId, event.seq), body: event.body, at: event.at, modes, objectives })
    return { state: out.state, result: out.effects }
  }, event.at)
  if (effects.tip || effects.bid || effects.notNow || effects.terse) {
    console.info('[kairos:rapport] owner turn', {
      tip: effects.tip ? { kind: effects.tip.kind, objectiveId: effects.tip.objectiveId } : null,
      bid: effects.bid,
      notNow: effects.notNow,
      terse: effects.terse,
      modes,
    })
  }
}

// A persisted Kairos chat reply: owed repair is now paid (the reply carried
// the repair wording), and a readiness tip in this thread is stamped answered.
export async function onChatReply(event: ReplyEvent, deps: { modes?: RapportModes } = {}): Promise<void> {
  const modes = deps.modes ?? rapportModes()
  if (modes.repair === 'off' && modes.readiness === 'off') return
  const data = await import('@/lib/data/kairos-rapport')
  await data.mutateKairosRapport(event.userId, (state) => {
    let next = state
    const r = state.rupture
    const ownerSpokeSince = state.turns.lastAt !== null && Date.parse(state.turns.lastAt) > Date.parse(r.since)
    const repairs = modes.repair !== 'off'
      && (r.state === 'repair_owed' || (r.state === 'backing_off' && ownerSpokeSince && state.turns.terseRun === 0))
    if (repairs) next = { ...next, rupture: markRepaired(r, 'chat', event.at) }
    const stamped = modes.readiness !== 'off' ? stampTipAnswered(next, event.threadId, event.at) : null
    if (stamped) next = stamped
    return { state: next === state ? null : next, result: undefined }
  }, event.at)
}
