import { after } from 'next/server'
import { surpriseGateMode } from './flag'
import { recordSurprise } from './ledger'
import { openMemories } from './marks'

// Owner corrections (spec_surprise Lane 1) — the operator says a belief is
// wrong. Two producers, both behind KAIROS_SURPRISE_GATE (off → nothing runs):
//  - nightly: an operator-sourced replace in belief_extract (s .8) opens the
//    replaced belief's shared-provenance neighbours;
//  - daytime: a chat turn with a correction marker (regex) is matched by
//    full-text search against held beliefs — NO embedding / paid call — and
//    the top 2 above a rank floor open (s .5). It runs inside after(), so it
//    never delays the chat reply.

export const NIGHTLY_CORRECTION_S = 0.8
export const CHAT_CORRECTION_S = 0.5
export const CHAT_CORRECTION_TOP = 2
// ts_rank_cd(…, 32) is rank/(rank+1); below this the match is too loose.
export const CHAT_CORRECTION_MIN_RANK = 0.3
const NEIGHBOUR_CAP = 5
const TERM_CAP = 12

export const CORRECTION_MARKER =
  /\b(actually|i was wrong|i'?ve changed my mind|i have changed my mind|changed my mind|not any ?more|no longer|i don'?t (?:think|believe) (?:that|so)|that'?s (?:wrong|not (?:true|right|it))|not true|incorrect|correction|i stand corrected|scratch that|on second thought|i take (?:that|it) back|i was mistaken|turns out)\b/i

export function looksLikeCorrection(text: string): boolean {
  return CORRECTION_MARKER.test(text)
}

const STOP = new Set([
  'actually', 'about', 'after', 'again', 'also', 'because', 'been', 'before', 'being', 'could', 'does', 'doing', 'dont',
  'from', 'have', 'into', 'just', 'like', 'longer', 'mind', 'more', 'much', 'only', 'other', 'really', 'right', 'should',
  'some', 'than', 'that', 'their', 'them', 'then', 'there', 'these', 'they', 'thing', 'think', 'this', 'those', 'true',
  'very', 'want', 'were', 'what', 'when', 'where', 'which', 'while', 'will', 'with', 'would', 'wrong', 'your', 'changed',
  'correction', 'incorrect', 'mistaken', 'turns', 'second', 'thought', 'scratch', 'anymore', 'believe',
])

// Content words of a turn for an OR-ed full-text query: lower-case [a-z0-9],
// ≥4 chars, minus filler and the correction markers themselves; first 12.
export function correctionTerms(text: string): string[] {
  const out: string[] = []
  for (const w of text.toLowerCase().replace(/'/g, '').split(/[^a-z0-9]+/)) {
    if (w.length < 4 || STOP.has(w) || out.includes(w)) continue
    out.push(w)
    if (out.length >= TERM_CAP) break
  }
  return out
}

export interface ChatCorrectionDeps {
  match?: (userId: string, terms: readonly string[], limit: number) => Promise<Array<{ id: string; rank: number }>>
  open?: typeof openMemories
  record?: typeof recordSurprise
}

// The daytime check itself (awaitable for tests). Returns the opened ids.
export async function checkChatCorrection(
  userId: string,
  ref: string,
  body: string,
  now: Date = new Date(),
  deps: ChatCorrectionDeps = {},
): Promise<string[]> {
  if (surpriseGateMode() === 'off' || !looksLikeCorrection(body)) return []
  const terms = correctionTerms(body)
  if (terms.length === 0) return []
  try {
    const match = deps.match ?? (await import('@/lib/data/surprise-gate')).matchHeldBeliefsByText
    const hits = (await match(userId, terms, CHAT_CORRECTION_TOP))
      .filter((h) => h.rank >= CHAT_CORRECTION_MIN_RANK)
      .slice(0, CHAT_CORRECTION_TOP)
    if (hits.length === 0) return []
    const ids = hits.map((h) => h.id)
    const opened = await (deps.open ?? openMemories)(userId, ids, { kind: 'owner_correction', ref, s: CHAT_CORRECTION_S }, now)
    await (deps.record ?? recordSurprise)(userId, {
      key: `owner_correction:${ref}`,
      kind: 'owner_correction',
      s: CHAT_CORRECTION_S,
      refs: { beliefIds: ids },
      opened,
    }, { now })
    return opened
  } catch (err) {
    console.error('[kairos:surprise] chat correction check failed:', err)
    return []
  }
}

// Fire-and-forget from the chat write path: does nothing with the gate off or
// without a correction marker; otherwise the check runs after the response.
export function scheduleChatCorrectionCheck(userId: string, threadId: string, seq: number, body: string): void {
  if (surpriseGateMode() === 'off' || !looksLikeCorrection(body)) return
  const run = () => checkChatCorrection(userId, `chat:${threadId}:${seq}`, body).catch(() => [])
  try {
    after(run)
  } catch {
    // outside a request scope: run detached
    void run()
  }
}

export interface NightlyCorrection {
  newId: string
  targetId: string
  targetProvenance: readonly string[]
}

export interface NightlyCorrectionDeps {
  neighbours?: (userId: string, provenance: readonly string[], exclude: readonly string[], limit: number) => Promise<string[]>
  open?: typeof openMemories
  record?: typeof recordSurprise
}

// belief_extract persist: one owner_correction event per operator replace;
// the replaced belief's shared-provenance neighbours open for update.
export async function recordNightlyOwnerCorrections(
  userId: string,
  extractKey: string,
  corrections: readonly NightlyCorrection[],
  now: Date = new Date(),
  deps: NightlyCorrectionDeps = {},
): Promise<number> {
  let recorded = 0
  for (const c of corrections) {
    try {
      const neighbours = deps.neighbours ?? (await import('@/lib/data/surprise-gate')).listProvenanceNeighbours
      const ids = await neighbours(userId, c.targetProvenance, [c.targetId, c.newId], NEIGHBOUR_CAP)
      const ref = c.targetId
      const opened = ids.length
        ? await (deps.open ?? openMemories)(userId, ids, { kind: 'owner_correction', ref, s: NIGHTLY_CORRECTION_S }, now)
        : []
      const event = await (deps.record ?? recordSurprise)(userId, {
        key: `owner_correction:${extractKey}:${c.targetId}`,
        kind: 'owner_correction',
        s: NIGHTLY_CORRECTION_S,
        refs: { beliefIds: [c.targetId, c.newId], memoryIds: [...c.targetProvenance] },
        opened,
      }, { now })
      if (event) recorded++
    } catch (err) {
      console.error('[kairos:surprise] nightly owner correction failed:', err)
    }
  }
  return recorded
}
