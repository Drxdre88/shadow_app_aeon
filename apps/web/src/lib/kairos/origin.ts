// ─────────────────────────────────────────────────────────────────────────
// Origin — where a memory came from, fixed at write time (P2.5, research
// research/kairos_0110/00_verdict.md G6/G7). Trust follows the origin, never
// the wording. A row derived from several inputs takes the LOWEST-trust origin
// among them, so untrusted content can't be laundered through Kairos's own
// summaries. Stored as sourceMetadata.origin = { kind, via? }; rows written
// before P2.5 have no label and are inferred from (source, sourceMetadata).
// ─────────────────────────────────────────────────────────────────────────

export const ORIGIN_KINDS = ['operator', 'activity', 'agent', 'kairos', 'external'] as const
export type OriginKind = (typeof ORIGIN_KINDS)[number]

export interface Origin {
  kind: OriginKind
  // The write surface, for audit only (e.g. 'ui', 'telegram', 'mcp', 'rest', 'cron:chat-distill').
  via?: string
}

// operator: the owner's own words through an owner-authenticated surface.
// activity: machine records of the owner's real work (board pages, missions).
// agent:    written by an AI client acting for the owner (MCP/REST bearer, session hooks).
// kairos:   Kairos's own synthesis (crons, thinking jobs, distillations).
// external: ingested third-party content (webhooks, imports, email, web).
export const ORIGIN_TRUST: Record<OriginKind, number> = {
  operator: 1,
  activity: 0.8,
  agent: 0.7,
  kairos: 0.5,
  external: 0.3,
}

const ACTIVITY_KINDS: ReadonlySet<string> = new Set(['board_day', 'board_week', 'hangar_mission'])
const AGENT_SOURCES: ReadonlySet<string> = new Set(['claude', 'codex', 'copilot', 'hook'])

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

export function isOriginKind(v: unknown): v is OriginKind {
  return typeof v === 'string' && (ORIGIN_KINDS as readonly string[]).includes(v)
}

// The stored label, or null when the row predates P2.5 / was written without one.
export function readOrigin(sourceMetadata: unknown): Origin | null {
  const o = asRecord(asRecord(sourceMetadata)?.origin)
  if (!o || !isOriginKind(o.kind)) return null
  return typeof o.via === 'string' && o.via ? { kind: o.kind, via: o.via } : { kind: o.kind }
}

// Best guess for unlabelled rows. Deliberately conservative: an unlabelled
// 'manual'/'voice' row is treated as the operator (that is what those sources
// meant before P2.5), everything machine-written is Kairos or external.
export function inferOriginKind(source: string | null | undefined, sourceMetadata?: unknown): OriginKind {
  const meta = asRecord(sourceMetadata)
  const kind = typeof meta?.kind === 'string' ? meta.kind : null
  if (kind && ACTIVITY_KINDS.has(kind)) return 'activity'
  switch (source) {
    case 'manual':
    case 'voice':
      return 'operator'
    case 'import':
    case 'webhook':
      return 'external'
    case 'cron':
    case 'system':
      return 'kairos'
    default:
      return source && AGENT_SOURCES.has(source) ? 'agent' : 'external'
  }
}

export function originKindOf(row: { source?: string | null; sourceMetadata?: unknown }): OriginKind {
  return readOrigin(row.sourceMetadata)?.kind ?? inferOriginKind(row.source, row.sourceMetadata)
}

export function originTrust(kind: OriginKind): number {
  return ORIGIN_TRUST[kind]
}

// Lowest-trust origin among the inputs. A Kairos synthesis is never better
// than 'kairos' even when all its inputs are the operator's words.
export function derivedOriginKind(inputs: Iterable<OriginKind>): OriginKind {
  let worst: OriginKind = 'kairos'
  for (const k of inputs) if (ORIGIN_TRUST[k] < ORIGIN_TRUST[worst]) worst = k
  return worst
}

// ── Belief source types (beliefs/types.ts sourceType) ──────────────────────

export type BeliefSourceType = 'operator' | 'tool' | 'inference'

export function beliefSourceTypeFor(kind: OriginKind): BeliefSourceType {
  if (kind === 'operator') return 'operator'
  if (kind === 'activity' || kind === 'agent') return 'tool'
  return 'inference'
}

// Highest source type among a belief's provenance: one operator-origin
// support is enough to call it the operator's view.
export function beliefSourceTypeFromProvenance(kinds: Iterable<OriginKind>): BeliefSourceType {
  let best: BeliefSourceType = 'inference'
  for (const k of kinds) {
    const t = beliefSourceTypeFor(k)
    if (t === 'operator') return 'operator'
    if (t === 'tool') best = 'tool'
  }
  return best
}

// Confidence ceiling by source type: a model's stated confidence is never
// trusted beyond what its evidence can carry.
export const BELIEF_CONFIDENCE_CAP: Record<BeliefSourceType, number> = {
  operator: 0.95,
  tool: 0.8,
  inference: 0.6,
}

export function capBeliefConfidence(confidence: number, sourceType: BeliefSourceType): number {
  const c = Number.isFinite(confidence) ? Math.min(Math.max(confidence, 0), 1) : 0
  return Math.min(c, BELIEF_CONFIDENCE_CAP[sourceType])
}

// External content may never shape the aligned mind or the constitution.
export function mayShapeBeliefs(kind: OriginKind): boolean {
  return kind !== 'external'
}
