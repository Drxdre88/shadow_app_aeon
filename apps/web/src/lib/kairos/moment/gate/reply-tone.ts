// Lexical warmth of an owner reply in [−1, 1]. Pure, no model call. Used by
// the gate fold only. Thanks / laughter / warm emoji / "!" push up;
// "not now", "stop", "later", "busy" and bare one-word acks push down.

const WARM = [
  /\bthank(s| you)\b/, /\bty\b/, /\bcheers\b/, /\b(great|nice|perfect|awesome|brilliant|lovely|love it|amazing|good one)\b/,
  /\b(haha+|lol|lmao)\b/, /\byes!/,
]
const COLD = [
  /\bnot now\b/, /\bstop\b/, /\blater\b/, /\bbusy\b/, /\bleave (it|me)\b/, /\bgo away\b/, /\bshut up\b/,
  /\benough\b/, /\bno thanks\b/, /\bnot interested\b/, /\bdon'?t (care|bother)\b/,
]
const WARM_EMOJI = /[\u{1F64F}\u{2764}\u{1F60A}\u{1F604}\u{1F601}\u{1F602}\u{1F923}\u{1F44D}\u{1F525}\u{1F389}\u{1F917}\u{1F970}\u{1F60D}]/u
const COLD_EMOJI = /[\u{1F612}\u{1F644}\u{1F620}\u{1F621}\u{1F624}\u{1F611}]/u
const BARE_ACK = /^(k|ok|okay|fine|sure|yep|yup|no|nah|meh|hm+)\.?$/

const clamp = (n: number) => Math.max(-1, Math.min(1, n))

export function replyWarmth(text: string): number {
  const t = text.trim().toLowerCase()
  if (!t) return 0
  let score = 0
  for (const re of WARM) if (re.test(t)) score += 0.4
  for (const re of COLD) if (re.test(t)) score -= 0.5
  if (WARM_EMOJI.test(t)) score += 0.3
  if (COLD_EMOJI.test(t)) score -= 0.3
  if (/!/.test(t) && score >= 0) score += 0.1
  if (BARE_ACK.test(t)) score -= 0.3
  return Math.round(clamp(score) * 100) / 100
}

