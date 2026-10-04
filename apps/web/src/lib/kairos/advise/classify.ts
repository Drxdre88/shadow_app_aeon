// Deterministic "is the owner asking for advice?" classifier (lane D). No
// model call. offer = ask "want my take, or think it out loud?"; listen =
// questions only, no view; advise = questions first, view last.

export type AdviceMode = 'none' | 'offer' | 'advise' | 'listen'

export type AdviceReason =
  | 'explicit_ask'
  | 'took_offer'
  | 'thinking_aloud'
  | 'offer_ignored'
  | 'plan'
  | 'problem'
  | 'too_short'
  | 'offer_recent'
  | 'no_signal'

export interface AdviceVerdict {
  mode: AdviceMode
  reason: AdviceReason
}

export interface AdviceTurn {
  userBody: string
  // Prior turns, oldest first; the current owner message is not included.
  history: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>
}

export const OFFER_QUESTION = 'Want my take, or would you rather think it out loud?'
export const OFFER_WINDOW_MESSAGES = 8
export const OFFER_MIN_WORDS = 8

const OFFER_MARKER = /want my take,? or (?:would you rather )?think it (?:out loud|aloud|through)/i
const OFFER_LOOSE = /my take.{0,40}out loud/i
const ADVICE_RE = /\b(should i|what do you think|what(?:'|’)?s your (?:take|view|opinion|advice)|your (?:take|view|opinion|advice)|what would you do|is (?:this|it|that) a good idea|help me (?:decide|choose)|any thoughts|thoughts\?)/i
const TAKE_RE = /\b(your take|tell me|go on|go ahead|yes|yeah|yep|(?<!\bnot )sure|please|advise|give it|hit me)\b/i
const THINK_RE = /\b(out loud|aloud|think (?:it )?through|just (?:listening|venting|need to vent|vent)|no advice|let me think|think it out|don(?:'|’)?t (?:advise|tell me))\b/i
const PLAN_RE = /\b(i(?:'|’)?m (?:going|planning|thinking) (?:to|of|about)|i am (?:going|planning|thinking) (?:to|of|about)|my plan|i(?:'|’)?ve decided|i have decided|considering|i(?:'|’)?ll probably|i want to)\b/i
const PROBLEM_RE = /\b(stuck|struggling|can(?:'|’)?t (?:figure|decide|work out)|not sure (?:what|how|whether|if)|frustrat\w*|stress\w*|worried|torn|overwhelm\w*|don(?:'|’)?t know (?:what|how|whether|if))\b/i

export const isOfferMessage = (content: string): boolean => OFFER_MARKER.test(content) || OFFER_LOOSE.test(content)

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length

export function classifyAdviceTurn(turn: AdviceTurn): AdviceVerdict {
  const body = turn.userBody.trim()
  if (ADVICE_RE.test(body)) return { mode: 'advise', reason: 'explicit_ask' }

  const window = turn.history.slice(-OFFER_WINDOW_MESSAGES)
  let offerAt = -1
  for (let i = window.length - 1; i >= 0; i -= 1) {
    if (window[i].role === 'assistant' && isOfferMessage(window[i].content)) { offerAt = i; break }
  }

  if (offerAt >= 0) {
    // The first reply to the offer decides; later replies switch only on an
    // explicit advice ask or a think-aloud marker. No new offer in the window.
    const replies = [...window.slice(offerAt + 1).filter((m) => m.role === 'user').map((m) => m.content), body]
    let verdict: AdviceVerdict = { mode: 'none', reason: 'offer_ignored' }
    replies.forEach((reply, i) => {
      if (THINK_RE.test(reply)) verdict = { mode: 'listen', reason: 'thinking_aloud' }
      else if (ADVICE_RE.test(reply) || (i === 0 && TAKE_RE.test(reply))) verdict = { mode: 'advise', reason: 'took_offer' }
    })
    if (verdict.mode === 'none' && (PLAN_RE.test(body) || PROBLEM_RE.test(body))) return { mode: 'none', reason: 'offer_recent' }
    return verdict
  }

  const plan = PLAN_RE.test(body)
  const problem = PROBLEM_RE.test(body)
  if (!plan && !problem) return { mode: 'none', reason: 'no_signal' }
  if (wordCount(body) < OFFER_MIN_WORDS) return { mode: 'none', reason: 'too_short' }
  return { mode: 'offer', reason: plan ? 'plan' : 'problem' }
}
