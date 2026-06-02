// ─────────────────────────────────────────────────────────────────────────
// Kairos C2 — chat message helpers (citation chip parser + Reading line).
//
// Lives next to the Visor components but kept as pure helpers so they can
// be unit-tested without rendering the whole panel. The citation regex is
// imported from chat-retrieval-citations so server intersection and client
// chip render stay in lockstep.
// ─────────────────────────────────────────────────────────────────────────

import type { ChatMessage } from '@/lib/data/kairos-chat'
import { citationTokenRegex } from '@/lib/kairos/chat-retrieval-citations'

const EMPTY_TITLES: Map<string, string> = new Map()

export function buildTitleMap(retrieval: ChatMessage['retrieval']): Map<string, string> {
  if (!retrieval) return EMPTY_TITLES
  const map = new Map<string, string>()
  if (retrieval.cortex) map.set(retrieval.cortex.id.toLowerCase(), retrieval.cortex.title)
  for (const a of retrieval.archetypes ?? []) map.set(a.id.toLowerCase(), a.title)
  for (const s of retrieval.substrate ?? []) map.set(s.id.toLowerCase(), s.title)
  return map
}

export function formatReadingLine(retrieval: ChatMessage['retrieval']): string | null {
  if (!retrieval) return null
  const parts: string[] = []
  if (retrieval.cortex) parts.push('cortex')
  const arch = retrieval.archetypes?.length ?? 0
  if (arch > 0) parts.push(`${arch} archetype${arch === 1 ? '' : 's'}`)
  const sub = retrieval.substrate?.length ?? 0
  if (sub > 0) parts.push(`${sub} memor${sub === 1 ? 'y' : 'ies'}`)
  if (parts.length === 0) return null
  return `Reading: ${parts.join(' · ')}`
}

export function truncateTitle(title: string, max = 28): string {
  const t = title.trim()
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + '…'
}

// Splits the assistant body into text + chip nodes. Hallucinated ids
// (those not present in the retrieval snapshot) render as a muted "?"
// so the operator can spot when the model invents citations.
export function renderWithCitations(content: string, titles: Map<string, string>): React.ReactNode {
  const nodes: React.ReactNode[] = []
  let lastIndex = 0
  let key = 0
  for (const match of content.matchAll(citationTokenRegex())) {
    const start = match.index ?? 0
    if (start > lastIndex) nodes.push(content.slice(lastIndex, start))
    const id = match[1].toLowerCase()
    const title = titles.get(id)
    if (title) {
      nodes.push(
        <span
          key={`cite-${key++}`}
          title={title}
          className="mx-0.5 inline-flex items-center rounded-md border border-purple-700/50 bg-purple-950/40 px-1.5 py-0.5 align-baseline text-[11px] text-purple-200"
        >
          {truncateTitle(title)}
        </span>,
      )
    } else {
      nodes.push(
        <span
          key={`miss-${key++}`}
          title="Unknown memory id"
          className="mx-0.5 inline rounded-md border border-zinc-700/40 bg-zinc-800/40 px-1 py-0.5 align-baseline text-[10px] text-zinc-500"
        >
          ?
        </span>,
      )
    }
    lastIndex = start + match[0].length
  }
  if (lastIndex < content.length) nodes.push(content.slice(lastIndex))
  return nodes
}

type FailReason =
  | 'unauthorized'
  | 'dominion_not_found'
  | 'thread_not_found'
  | 'no_credential'
  | 'ai_empty'
  | 'ai_failed'
  | 'invalid_input'

export function formatReason(reason: FailReason, message?: string): string {
  switch (reason) {
    case 'unauthorized':       return 'Not signed in.'
    case 'dominion_not_found': return 'That Dominion is not accessible.'
    case 'thread_not_found':   return 'Thread was removed.'
    case 'no_credential':      return 'No BYOK credential — add an API key in settings.'
    case 'ai_empty':           return 'Kairos returned an empty reply. Try again.'
    case 'ai_failed':          return message ? `Kairos failed: ${message}` : 'Kairos failed. Try again.'
    case 'invalid_input':      return message ? `Invalid input: ${message}` : 'Invalid input.'
    default:                   return 'Something went wrong.'
  }
}
