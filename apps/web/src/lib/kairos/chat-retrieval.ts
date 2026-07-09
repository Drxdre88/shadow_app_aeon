// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 3A — chat retrieval shim.
//
// The actual query layer lives in retrieve.ts now (the unified module that
// also powers the briefer + lieutenants). This file is a thin adapter that
// keeps the chat surface's positional signature and trims the result down
// to the three buckets the chat caller persists (no bundle, no traces).
//
// New code should call retrieveContext({ userId, dominionId, query, ... })
// from ./retrieve directly.
// ─────────────────────────────────────────────────────────────────────────

import { retrieveContext, retrieveGlobalContext } from './retrieve'

export interface RetrievedMemory {
  id: string
  title: string
  body: string
  streamClass: string
  createdAt: Date
}

export interface ChatRetrieval {
  cortex: RetrievedMemory | null
  archetypes: RetrievedMemory[]
  substrate: RetrievedMemory[]
}

export async function retrieveForChat(
  userId: string,
  dominionId: string,
  userQuery: string,
): Promise<ChatRetrieval> {
  const r = await retrieveContext({ userId, dominionId, query: userQuery })
  return { cortex: r.cortex, archetypes: r.archetypes, substrate: r.substrate }
}

// JARVIS-level chat retrieval — whole-brain, no Dominion scope. Kairos recalls
// across every Dominion (Aether as the self-model), so the operator talks to
// him without pinpointing which front they mean. Same three buckets the chat
// caller persists, so the prompt / citation plumbing is unchanged downstream.
export async function retrieveForChatGlobal(
  userId: string,
  userQuery: string,
): Promise<ChatRetrieval> {
  const r = await retrieveGlobalContext({ userId, query: userQuery })
  return { cortex: r.cortex, archetypes: r.archetypes, substrate: r.substrate }
}

export { extractCitationIds, intersectWithRetrieved } from './chat-retrieval-citations'
