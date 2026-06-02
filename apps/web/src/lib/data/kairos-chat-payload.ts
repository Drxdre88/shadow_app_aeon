// Pure JSONB-payload guards for kairos chat messages. Lives outside
// kairos-chat.ts so unit tests can exercise the defensive parser without
// booting the Drizzle DB driver.

export interface CitedMemorySnapshot {
  id: string
  title: string
}

export interface ChatRetrievalMeta {
  cortex?: CitedMemorySnapshot | null
  archetypes?: CitedMemorySnapshot[]
  substrate?: CitedMemorySnapshot[]
}

export function parseSnapshot(raw: unknown): CitedMemorySnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.title !== 'string') return null
  return { id: r.id, title: r.title }
}

export function hasAnyRetrieval(meta: ChatRetrievalMeta): boolean {
  return !!meta.cortex || (meta.archetypes?.length ?? 0) > 0 || (meta.substrate?.length ?? 0) > 0
}

export function parseRetrievalMeta(raw: unknown): ChatRetrievalMeta | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const meta: ChatRetrievalMeta = {}
  if (r.cortex && typeof r.cortex === 'object') {
    const snap = parseSnapshot(r.cortex)
    if (snap) meta.cortex = snap
  }
  if (Array.isArray(r.archetypes)) {
    const arr = r.archetypes.map(parseSnapshot).filter((s): s is CitedMemorySnapshot => s !== null)
    if (arr.length) meta.archetypes = arr
  }
  if (Array.isArray(r.substrate)) {
    const arr = r.substrate.map(parseSnapshot).filter((s): s is CitedMemorySnapshot => s !== null)
    if (arr.length) meta.substrate = arr
  }
  return hasAnyRetrieval(meta) ? meta : null
}
