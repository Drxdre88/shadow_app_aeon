import type { BidKind, KairosRapport, RapportRupture } from '@/lib/data/validators/kairos-rapport'
import type { MomentChatContext, MomentChatContribution } from '@/lib/kairos/moment/types'
import { anyRapportLive, rapportModes, type RapportModes } from './flag'
import { detectBid, detectNotNow, hasChangeTalk, scoreChangeTalk } from './lexicon'
import { chatRef } from './owner-turn'
import { isBackingOff } from './repair'
import { goalTurnFor, previewTip, type ObjectiveRef } from './state'

// Chat wording for one turn, recomputed from the stored state plus the
// current message (the owner-turn capture may not have landed yet).
// Precedence: "not now" > repair > small bid > readiness. The first three
// claim the turn's style so later lanes can't add advice framing.

export const NOT_NOW_STYLE = "- The operator just said not now: reply with one short, warm line that accepts it. No question, no headline, no follow-up ask."

export const BID_STYLE = (kind: BidKind): string =>
  `- This is a small bid (${kind}): acknowledge it warmly in 1–2 lines. No headline, no blockquote, no question, no pivot to tasks, goals or asks.`

export const REPAIR_STYLE =
  '- Open by naming the strain in one plain sentence, own your part without grovelling, then answer what they said. At most one question in the whole reply.'

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`
}

function strain(r: RapportRupture): string {
  switch (r.reason) {
    case 'not_now': return r.trigger ? `they told you “${clip(r.trigger, 60)}”` : 'they told you not now'
    case 'dismissed': return 'they dismissed a couple of your messages'
    case 'terse': return 'their replies turned short'
    default: return 'several of your messages went unanswered'
  }
}

export function repairSection(r: RapportRupture): string {
  return `Rapport: you have been backing off since ${r.since.slice(0, 10)} because ${strain(r)}. This reply is your repair: name it, own your part, then move on.`
}

export interface ChatContextDeps {
  modes?: RapportModes
  now?: Date
  read?: (userId: string, now: Date) => Promise<KairosRapport>
  listObjectives?: (userId: string) => Promise<ObjectiveRef[]>
}

async function loadState(ctx: MomentChatContext, deps: ChatContextDeps, now: Date): Promise<KairosRapport | null> {
  try {
    const read = deps.read ?? (await import('@/lib/data/kairos-rapport')).readKairosRapport
    return await read(ctx.userId, now)
  } catch (err) {
    console.warn('[kairos:rapport] chat state read failed:', err instanceof Error ? err.message : String(err))
    return null
  }
}

async function readinessPart(ctx: MomentChatContext, state: KairosRapport, deps: ChatContextDeps, now: Date): Promise<MomentChatContribution | null> {
  if (!hasChangeTalk(scoreChangeTalk(ctx.userBody))) return null
  const list = deps.listObjectives ?? (await import('@/lib/data/kairos-rapport')).listObjectiveRefs
  const objectives = await list(ctx.userId)
  const tip = previewTip(state, goalTurnFor({ ref: chatRef(ctx.threadId, ctx.userSeq), body: ctx.userBody, at: now, objectives }))
  if (!tip) return null
  const title = clip(tip.title, 80)
  if (tip.kind === 'commit') {
    return {
      section: `Readiness — “${title}”: the operator just moved from wanting to committing (“${tip.marker}”).`,
      styleLines: [`- Offer exactly ONE small, optional next step for “${title}” — concrete, doable soon, easy to decline. Don't stack advice.`],
    }
  }
  return {
    section: `Readiness — “${title}”: the operator is pulling back from an earlier commitment (“${tip.marker}”).`,
    styleLines: [`- Don't push on “${title}”. Reflect both sides — why it mattered and what's in the way — in 1–2 sentences, and let them lead.`],
  }
}

export async function rapportChatContext(ctx: MomentChatContext, deps: ChatContextDeps = {}): Promise<MomentChatContribution | null> {
  const modes = deps.modes ?? rapportModes()
  if (!anyRapportLive(modes)) return null
  if (modes.repair === 'on' && detectNotNow(ctx.userBody)) return { styleLines: [NOT_NOW_STYLE], brief: true, claim: true }
  const now = deps.now ?? new Date()
  const needsState = modes.repair === 'on' || modes.readiness === 'on'
  const state = needsState ? await loadState(ctx, deps, now) : null
  if (modes.repair === 'on' && state && isBackingOff(state.rupture)) {
    return { section: repairSection(state.rupture), styleLines: [REPAIR_STYLE], claim: true }
  }
  const bid = modes.bids === 'on' ? detectBid(ctx.userBody) : null
  if (bid) return { styleLines: [BID_STYLE(bid)], brief: true, claim: true }
  if (modes.readiness === 'on' && state) return readinessPart(ctx, state, deps, now)
  return null
}
