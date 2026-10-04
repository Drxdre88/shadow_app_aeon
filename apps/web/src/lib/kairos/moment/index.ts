import { adviseTrustLane } from './lanes/advise-trust'
import { chaptersLane } from './lanes/chapters'
import { gateLane } from './lanes/gate'
import { ownerModelLane } from './lanes/owner-model'
import { rapportLane } from './lanes/rapport'
import type {
  DailyDeliveredEvent,
  MomentChatContext,
  MomentChatOptions,
  MomentDaily,
  MomentLane,
  MomentReplyContext,
  NamedMomentLane,
  OwnerDecisionEvent,
  OwnerTurnEvent,
  ReplyEvent,
  SpeakDeliveredEvent,
  SpeakPolicyContext,
  SpeakPolicyVerdict,
  TelegramCallbackContext,
  TelegramMessageContext,
  TelegramTextContext,
} from './types'

export type * from './types'

// Fixed order, also the chat style precedence: rapport (repair/bid wording)
// first, so its claim wins over advice framing, the owner model, gate, chapters.
export const MOMENT_LANES: readonly NamedMomentLane[] = [
  { name: 'rapport', lane: rapportLane },
  { name: 'advise-trust', lane: adviseTrustLane },
  { name: 'owner-model', lane: ownerModelLane },
  { name: 'gate', lane: gateLane },
  { name: 'chapters', lane: chaptersLane },
]

type Lanes = readonly NamedMomentLane[]
type Hook = keyof MomentLane

function report(name: string, hook: string, err: unknown): void {
  const reason = `moment:${name}.${hook}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200)
  console.warn('[kairos:moment] hook failed:', reason)
}

function guard<T>(name: string, hook: string, fallback: T, run: () => T): T {
  try {
    return run()
  } catch (err) {
    report(name, hook, err)
    return fallback
  }
}

async function guardAsync<T>(name: string, hook: string, fallback: T, run: () => T | Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    report(name, hook, err)
    return fallback
  }
}

const implementing = (hook: Hook, lanes: Lanes): NamedMomentLane[] => lanes.filter((l) => typeof l.lane[hook] === 'function')

export function hasMomentHook(hook: Hook, lanes: Lanes = MOMENT_LANES): boolean {
  return implementing(hook, lanes).length > 0
}

async function notifyAll(hook: Hook, lanes: Lanes, call: (lane: MomentLane) => unknown): Promise<void> {
  for (const { name, lane } of implementing(hook, lanes)) await guardAsync(name, hook, undefined, () => call(lane) as Promise<void>)
}

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const lines = (v: unknown): string[] => (Array.isArray(v) ? v.filter(nonEmpty) : [])

// ── speak ────────────────────────────────────────────────────────────────

// Block beats hold; the first valid block / hold in lane order wins.
export async function runSpeakPolicies(ctx: SpeakPolicyContext, lanes: Lanes = MOMENT_LANES): Promise<SpeakPolicyVerdict | null> {
  let hold: SpeakPolicyVerdict['hold'] | undefined
  for (const { name, lane } of implementing('speakPolicy', lanes)) {
    const verdict = await guardAsync(name, 'speakPolicy', null, () => lane.speakPolicy!(ctx))
    if (!verdict) continue
    if (verdict.block) {
      if (verdict.block.status === 429 && nonEmpty(verdict.block.reason)) return { block: { status: 429, reason: verdict.block.reason } }
      report(name, 'speakPolicy', new Error('invalid block'))
    }
    if (verdict.hold && !hold) {
      const until = Date.parse(verdict.hold.until)
      if (Number.isFinite(until) && nonEmpty(verdict.hold.reason)) hold = { until: new Date(until).toISOString(), reason: verdict.hold.reason }
      else report(name, 'speakPolicy', new Error('invalid hold'))
    }
  }
  return hold ? { hold } : null
}

export async function runSpeakDelivered(event: SpeakDeliveredEvent, lanes: Lanes = MOMENT_LANES): Promise<void> {
  await notifyAll('speakDelivered', lanes, (lane) => lane.speakDelivered!(event))
}

// ── thinking-sweep ───────────────────────────────────────────────────────

// null when no lane reported anything, so the sweep JSON gains no keys.
export async function runSweepHooks(userId: string, now: Date, lanes: Lanes = MOMENT_LANES): Promise<Record<string, unknown> | null> {
  const out: Record<string, unknown> = {}
  for (const { name, lane } of implementing('sweep', lanes)) {
    const result = await guardAsync(name, 'sweep', null, () => lane.sweep!(userId, now))
    if (!result || typeof result !== 'object') continue
    for (const [key, value] of Object.entries(result)) if (!(key in out)) out[key] = value
  }
  return Object.keys(out).length ? out : null
}

// ── chat-today ───────────────────────────────────────────────────────────

export async function runOwnerTurnHooks(event: OwnerTurnEvent, lanes: Lanes = MOMENT_LANES): Promise<void> {
  await notifyAll('ownerTurn', lanes, (lane) => lane.ownerTurn!(event))
}

export async function runReplyHooks(event: ReplyEvent, lanes: Lanes = MOMENT_LANES): Promise<void> {
  await notifyAll('reply', lanes, (lane) => lane.reply!(event))
}

// ── chat ─────────────────────────────────────────────────────────────────

type ChatExtras = Pick<MomentChatOptions, 'momentSections' | 'momentStyleLines' | 'briefReply'>

// Sections from every lane; style lines and brief stop after the first claim.
export async function runChatContext(ctx: MomentChatContext, lanes: Lanes = MOMENT_LANES): Promise<ChatExtras> {
  const sections: string[] = []
  const styleLines: string[] = []
  let brief = false
  let claimed = false
  for (const { name, lane } of implementing('chatContext', lanes)) {
    const part = await guardAsync(name, 'chatContext', null, () => lane.chatContext!(ctx))
    if (!part) continue
    if (nonEmpty(part.section)) sections.push(part.section.trim())
    if (claimed) continue
    styleLines.push(...lines(part.styleLines))
    if (part.brief === true) brief = true
    if (part.claim === true) claimed = true
  }
  return {
    ...(sections.length ? { momentSections: sections } : {}),
    ...(styleLines.length ? { momentStyleLines: styleLines } : {}),
    ...(brief ? { briefReply: true as const } : {}),
  }
}

export async function runFinishReply(content: string, ctx: MomentReplyContext, lanes: Lanes = MOMENT_LANES): Promise<string> {
  let out = content
  for (const { name, lane } of implementing('finishReply', lanes)) {
    const before = out
    const next = await guardAsync(name, 'finishReply', before, () => lane.finishReply!(before, ctx))
    out = nonEmpty(next) ? next : before
  }
  return out
}

export function runStripFooters(content: string, lanes: Lanes = MOMENT_LANES): string {
  let out = content
  for (const { name, lane } of implementing('stripFooter', lanes)) {
    const before = out
    const next = guard(name, 'stripFooter', before, () => lane.stripFooter!(before))
    out = typeof next === 'string' ? next : before
  }
  return out
}

// ── 06:00 daily message ──────────────────────────────────────────────────

// null when every lane is silent; empty arrays are omitted.
export async function gatherMomentDaily(userId: string, now: Date, lanes: Lanes = MOMENT_LANES): Promise<MomentDaily | null> {
  const openings: string[] = []
  const promptBlocks: string[] = []
  const tail: string[] = []
  for (const { name, lane } of implementing('daily', lanes)) {
    const part = await guardAsync(name, 'daily', null, () => lane.daily!(userId, now))
    if (!part) continue
    openings.push(...lines(part.openings))
    promptBlocks.push(...lines(part.promptBlocks))
    tail.push(...lines(part.tail))
  }
  const out: MomentDaily = {
    ...(openings.length ? { openings } : {}),
    ...(promptBlocks.length ? { promptBlocks } : {}),
    ...(tail.length ? { tail } : {}),
  }
  return Object.keys(out).length ? out : null
}

export async function runDailyDelivered(event: DailyDeliveredEvent, lanes: Lanes = MOMENT_LANES): Promise<void> {
  await notifyAll('dailyDelivered', lanes, (lane) => lane.dailyDelivered!(event))
}

// ── Telegram ─────────────────────────────────────────────────────────────

async function firstHandled(hook: 'telegramText' | 'telegramCallback' | 'telegramMessage', lanes: Lanes, call: (lane: MomentLane) => unknown): Promise<boolean> {
  for (const { name, lane } of implementing(hook, lanes)) {
    if (await guardAsync(name, hook, false, () => call(lane) as Promise<boolean>) === true) return true
  }
  return false
}

export async function runTelegramText(ctx: TelegramTextContext, lanes: Lanes = MOMENT_LANES): Promise<boolean> {
  return firstHandled('telegramText', lanes, (lane) => lane.telegramText!(ctx))
}

export async function runTelegramCallback(ctx: TelegramCallbackContext, lanes: Lanes = MOMENT_LANES): Promise<boolean> {
  return firstHandled('telegramCallback', lanes, (lane) => lane.telegramCallback!(ctx))
}

export async function runTelegramMessage(ctx: TelegramMessageContext, lanes: Lanes = MOMENT_LANES): Promise<boolean> {
  return firstHandled('telegramMessage', lanes, (lane) => lane.telegramMessage!(ctx))
}

// ── inbox decisions ──────────────────────────────────────────────────────

export async function runOwnerDecisionHooks(event: OwnerDecisionEvent, lanes: Lanes = MOMENT_LANES): Promise<void> {
  await notifyAll('ownerDecision', lanes, (lane) => lane.ownerDecision!(event))
}
