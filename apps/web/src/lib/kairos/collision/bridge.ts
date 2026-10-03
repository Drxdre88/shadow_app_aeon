import { addLink } from '@/lib/data/memories'
import { memoriesLive, recordBridgeLinked } from '@/lib/data/idea-bridges'
import type { Origin } from '@/lib/kairos/origin'
import type { BridgeMeta } from './types'

// Bridge write on an owner/operator accept (`on` mode): a `relates` link from
// memory A to memory B whose note names the idea. Agent accepts never bridge.

export const BRIDGE_NOTE_PREFIX = 'bridge · idea:'
const NOTE_MAX = 500

export function bridgeNote(ideaId: string, insight: string): string {
  return `${BRIDGE_NOTE_PREFIX}${ideaId} · ${insight.replace(/\s+/g, ' ').trim()}`.slice(0, NOTE_MAX)
}

export function isBridgeNote(note: unknown): boolean {
  return typeof note === 'string' && note.startsWith(BRIDGE_NOTE_PREFIX)
}

export const bridgingOrigin = (origin: Origin | undefined) => origin === undefined || origin.kind === 'operator'

// The bridge on an idea proposal's sourceMetadata, or null.
export function bridgeOf(meta: Readonly<Record<string, unknown>>): BridgeMeta | null {
  const idea = meta.idea as { bridge?: unknown } | undefined
  const b = idea && typeof idea === 'object' ? (idea.bridge as Partial<BridgeMeta> | undefined) : undefined
  if (!b || typeof b !== 'object') return null
  if (typeof b.aId !== 'string' || typeof b.bId !== 'string' || !b.aId || !b.bId || b.aId === b.bId) return null
  return b as BridgeMeta
}

export type BridgeWriteResult = 'linked' | 'exists' | 'skipped'

export async function writeIdeaBridge(
  userId: string,
  ideaId: string,
  meta: Readonly<Record<string, unknown>>,
  origin: Origin | undefined,
): Promise<BridgeWriteResult> {
  if (!bridgingOrigin(origin)) return 'skipped'
  const bridge = bridgeOf(meta)
  if (!bridge) return 'skipped'
  if (!(await memoriesLive(userId, [bridge.aId, bridge.bId]))) return 'skipped'
  const res = await addLink(bridge.aId, userId, {
    type: 'relates',
    target: bridge.bId,
    targetKind: 'memory',
    note: bridgeNote(ideaId, typeof bridge.insight === 'string' ? bridge.insight : ''),
  })
  if (!res) return 'skipped'
  if (!res.created) return 'exists'
  await recordBridgeLinked(userId, ideaId)
  return 'linked'
}
