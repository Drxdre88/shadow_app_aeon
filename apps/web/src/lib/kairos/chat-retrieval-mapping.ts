// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 2 (C2) — pure shape converters between the three chat
// retrieval shapes:
//   - ChatRetrieval         (full bodies, from chat-retrieval.ts)
//   - ChatPromptRetrieval   (prompt-shape, from chat-prompt.ts)
//   - ChatRetrievalMeta     (persistence-shape, from data/kairos-chat.ts)
//
// Lives outside the action layer so tests don't need to boot the DB driver
// to exercise them, and so the shape-bridge is the single place to change
// when retrieval evolves (e.g. C3 adds an MCP front door).
// ─────────────────────────────────────────────────────────────────────────

import type { ChatRetrieval } from './chat-retrieval'
import type { ChatPromptRetrieval } from './chat-prompt'
// Pull the type from the DB-free payload module so the mapping helper
// stays decoupled from the data facade (which transitively touches Drizzle).
import type { ChatRetrievalMeta } from '@/lib/data/kairos-chat-payload'

export function toPromptRetrieval(r: ChatRetrieval): ChatPromptRetrieval {
  return {
    cortex: r.cortex ? { id: r.cortex.id, title: r.cortex.title, body: r.cortex.body } : null,
    archetypes: r.archetypes.map((a) => ({ id: a.id, title: a.title, body: a.body })),
    substrate: r.substrate.map((s) => ({ id: s.id, title: s.title, body: s.body, streamClass: s.streamClass })),
  }
}

// Bodies aren't persisted — only id + title snapshots, so chips can render
// without a follow-up fetch and historical threads survive a later rename
// or archive of the source memory.
export function toRetrievalMeta(r: ChatRetrieval): ChatRetrievalMeta {
  const meta: ChatRetrievalMeta = {}
  if (r.cortex) meta.cortex = { id: r.cortex.id, title: r.cortex.title }
  if (r.archetypes.length) meta.archetypes = r.archetypes.map((a) => ({ id: a.id, title: a.title }))
  if (r.substrate.length) meta.substrate = r.substrate.map((s) => ({ id: s.id, title: s.title }))
  return meta
}
