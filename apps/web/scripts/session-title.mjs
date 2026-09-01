// Title derivation for session capture.
//
// Extracted so it can be tested: claude-session-capture.mjs calls main() at
// import time, so nothing inside it could ever be exercised directly.
//
// This exists because of a real data-loss bug. truncate() sliced to n and THEN
// appended an ellipsis, returning n+1 characters. aiTitle is capped at 120 by
// memoryCreateSchema, so any session whose first prompt was long enough to be
// truncated POSTed a 121-character title, got a 400, retried four more times,
// and dead-lettered — the session was lost outright. It only bit long first
// prompts, which is why it looked intermittent.

/** At most `n` characters INCLUDING the ellipsis. */
export function truncate(s, n) {
  if (!s) return ''
  if (s.length <= n) return s
  if (n <= 1) return '…'.slice(0, Math.max(0, n))
  return s.slice(0, n - 1).trimEnd() + '…'
}

/**
 * A short headline derived deterministically from the first prompt, so a
 * capture never lands with a NULL ai_title. The async summariser still
 * upgrades the prose for sessions that lack an Executive Summary; this is the
 * floor.
 *
 * The word cap is not a length cap: eight "words" of pasted path or URL can
 * run well past the column limit, which is exactly how the overflow above was
 * reached. truncate() is what actually bounds it.
 */
export function deriveAiTitle(firstPrompt, maxLength = 120) {
  if (!firstPrompt) return ''
  let s = firstPrompt.replace(/\s+/g, ' ').trim()
  s = s.replace(/^\/[\w-]+\s*/, '')          // drop a leading slash-command token
  s = s.replace(/^(can you|could you|please|let'?s|i want to|i need to|help me)\s+/i, '')
  const words = s.split(' ').filter(Boolean).slice(0, 8).join(' ')
  return truncate(words, maxLength)
}
