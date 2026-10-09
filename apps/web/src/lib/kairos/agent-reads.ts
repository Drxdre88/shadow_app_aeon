import { after } from 'next/server'
import { reactUsed } from './reactions'

// Agent reads count as use (Wave 1 "one search"). When an agent surface (MCP
// or REST) hands memories to a model, the top hits get the same Usage
// reinforcement chat citations get — so the memory engine's standing learns
// from agent reads too. Capped to the head of the list (a 20-hit search is
// not 20 uses), scheduled after the response, never able to fail the read.

export const AGENT_READ_CAP = 5

export type AgentReadSurface =
  | 'mcp:search_memories'
  | 'mcp:prepare_context'
  | 'rest:search_memories'
  | 'rest:prepare_context'

export function noteAgentReads(userId: string, ids: readonly string[], surface: AgentReadSurface): boolean {
  const top = [...new Set(ids)].slice(0, AGENT_READ_CAP)
  if (top.length === 0) return false
  const run = () => reactUsed(userId, top, `agent-read:${surface}`).catch(() => undefined)
  try {
    after(run)
  } catch {
    void run()
  }
  return true
}

/** The retrieval eval (scripts/eval-retrieval.mjs) marks its reads so they never count as use. */
export const EVAL_READ_HEADER = 'x-aeon-eval'

export function isEvalRead(headers: Headers): boolean {
  return headers.get(EVAL_READ_HEADER) === '1'
}

// prepare_context: the "Most relevant" section is what the agent actually
// reads in full; pinned rows surface regardless of the query, so they are not
// a relevance signal.
export function relevantSourceIds(sources: ReadonlyArray<{ id: string; section: string }>): string[] {
  return sources.filter((s) => s.section === 'relevant').map((s) => s.id)
}
