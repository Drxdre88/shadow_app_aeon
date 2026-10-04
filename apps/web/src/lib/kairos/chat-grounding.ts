import {
  matchProjectsInMessage,
  fetchLiveBoardContext,
  renderLiveBoardSection,
  type LiveBoardContext,
} from '@/lib/kairos/chat-board-context'
import {
  fetchRecentActivityContext,
  renderRecentActivitySection,
} from '@/lib/kairos/chat-recency-context'

// Deterministic live-board grounding: if the operator names one of their
// projects in-message, fetch its current state straight from the data layer
// and render it into a prompt block. Retrieval-derived memories are always
// somewhat stale; this leg gives Kairos ground truth for the boards named.
// Non-fatal by design, like the chat retrieval fallback in chat-turn-assistant.ts.
export async function loadBoardSection(userId: string, threadId: string, userBody: string): Promise<string | undefined> {
  try {
    const matches = await matchProjectsInMessage(userId, userBody)
    if (matches.length === 0) return undefined

    const contexts = await Promise.all(
      matches.map((m) => fetchLiveBoardContext(userId, m.id)),
    )
    const found = contexts.filter((c): c is LiveBoardContext => c !== null)
    if (found.length === 0) return undefined

    return renderLiveBoardSection(found)
  } catch (err) {
    console.warn('[kairos-chat] live board context failed, proceeding without it', {
      threadId,
      error: err instanceof Error ? err.message : String(err),
    })
    return undefined
  }
}

// Deterministic recency grounding: last-24h coding sessions, reflections,
// introspection proposals, asks, and board activity — fresher than any
// synthesised memory (see chat-recency-context.ts header). Non-fatal by
// design: fetchRecentActivityContext already catches internally and returns
// null on error or on a genuinely quiet window, so there is nothing to log
// here beyond that call.
export async function loadRecencySection(userId: string): Promise<string | undefined> {
  const ctx = await fetchRecentActivityContext(userId)
  return ctx ? renderRecentActivitySection(ctx) : undefined
}
