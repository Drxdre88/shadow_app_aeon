import {
  acceptConstitutionProposalTx,
  findLatestDriftRun,
  findLiveConstitutionRow,
  insertConstitutionProposal,
  listConstitutionVersionRows,
  listPendingConstitutionProposals,
  type AcceptDecision,
  type ConstitutionRow,
  type ProposalForAccept,
} from '@/lib/data/constitution'
import type { EngineLink } from '@/lib/kairos/engine/types'
import { findDriftProbe } from './probes'
import {
  CONSTITUTION_PROPOSAL_KIND,
  numberPrinciples,
  proposalTitle,
  readProposalMeta,
  renderConstitutionMarkdown,
  renderProposalMarkdown,
  toLiveConstitution,
  type ConstitutionProposalMeta,
  type LiveConstitution,
  type PrincipleInput,
} from './schema'

// Constitution amendments (docs/kairos/34 §2): propose-not-commit. Kairos (the
// seed cron, MCP, REST) only ever writes PROPOSALS; the constitution itself
// changes only when the operator accepts one, through
// applyAcceptedConstitutionAmendment.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function getLiveConstitution(userId: string): Promise<LiveConstitution | null> {
  const row = await findLiveConstitutionRow(userId)
  return row ? toLiveConstitution(row) : null
}

// ── Propose ────────────────────────────────────────────────────────────────

export interface ProposalSpec {
  principles: readonly PrincipleInput[]
  rationale: string
  basedOnVersion: number
  source: string
  // Memory ids the proposal is grounded in (the seed's citations).
  citations?: readonly string[]
  runId?: string
}

export function buildProposalValues(spec: ProposalSpec) {
  const constitution: ConstitutionProposalMeta = {
    principles: numberPrinciples(spec.principles),
    basedOnVersion: spec.basedOnVersion,
    rationale: spec.rationale.trim(),
  }
  const citations = [...new Set(spec.citations ?? [])]
  const title = proposalTitle(spec.basedOnVersion)
  return {
    title,
    bodyMd: renderProposalMarkdown(constitution),
    summary: `${title}: ${constitution.principles.length} principles`,
    source: spec.source,
    links: citations.map((target): EngineLink => ({ type: 'refers_to', target, target_kind: 'memory' })),
    tags: ['proposal', 'constitution'],
    // introspection:true + status:'pending' make it a first-class proposal the
    // inbox lists and acceptProposal accepts.
    sourceMetadata: {
      introspection: true,
      kind: CONSTITUTION_PROPOSAL_KIND,
      status: 'pending',
      constitution,
      citations,
      ...(spec.runId ? { runId: spec.runId } : {}),
    },
  }
}

export interface AmendmentInput {
  principles: PrincipleInput[]
  rationale: string
}

export type ProposeAmendmentResult = { ok: true; proposalId: string; basedOnVersion: number; principles: number }

// MCP/REST: write an amendment proposal against the CURRENT live version (0 =
// none yet, i.e. a first draft). Never touches the constitution itself.
export async function proposeConstitutionAmendment(
  userId: string,
  input: AmendmentInput,
  source: string,
): Promise<ProposeAmendmentResult> {
  const live = await getLiveConstitution(userId)
  const basedOnVersion = live?.version ?? 0
  const values = buildProposalValues({ principles: input.principles, rationale: input.rationale, basedOnVersion, source })
  const res = await insertConstitutionProposal(userId, values)
  if (!res.written) throw new Error(`constitution proposal not written: ${res.skipped}`)
  return { ok: true, proposalId: res.memoryId, basedOnVersion, principles: input.principles.length }
}

// ── Accept ─────────────────────────────────────────────────────────────────

// docs/kairos/34 §2: only the OPERATOR accepts an amendment — in the Aeon
// inbox (signed-in session) or the Telegram inline button (operator chat id
// verified). Agent surfaces (MCP, REST with an API key / OAuth / bearer
// token) must refuse a constitution proposal before calling acceptProposal.
export const OPERATOR_ONLY_AMENDMENT_ERROR =
  'constitution amendments can only be accepted by the operator in the Aeon inbox or Telegram'

export function isConstitutionAmendmentProposal(row: { sourceMetadata: unknown } | null | undefined): boolean {
  const meta = row?.sourceMetadata
  return !!meta && typeof meta === 'object' && (meta as Record<string, unknown>).kind === CONSTITUTION_PROPOSAL_KIND
}

// The constitution rows themselves (live AND superseded versions — history
// must stay intact) are owner-only too: agent surfaces may not archive them,
// retype them, rewrite their content, delete them, or supersede them through
// accept_proposal. Summary backfills (aiTitle / execSummary) and tags / pinned
// stay allowed. The owner's UI and signed-in session are not gated here.
export const OPERATOR_ONLY_CONSTITUTION_EDIT_ERROR =
  'constitution rows can only be archived, retyped, rewritten, deleted or superseded by the operator in Aeon'

export function isConstitutionRow(
  row: { type?: unknown; streamClass?: unknown } | null | undefined,
): boolean {
  return !!row && (row.type === 'constitution' || row.streamClass === 'constitution')
}

export interface ConstitutionPatch {
  archivedAt?: string | Date | null
  type?: string
  title?: string
  bodyMd?: string
  summary?: string | null
}

type ConstitutionPatchRow = {
  type?: unknown
  streamClass?: unknown
  title?: unknown
  bodyMd?: unknown
  summary?: unknown
}

// Returns the refusal message when an agent-surface patch would remove or
// rewrite a constitution row; null when the patch is allowed.
export function constitutionPatchRefusal(
  row: ConstitutionPatchRow | null | undefined,
  patch: ConstitutionPatch,
): string | null {
  if (!row || !isConstitutionRow(row)) return null
  const changes = (field: 'type' | 'title' | 'bodyMd' | 'summary') =>
    patch[field] !== undefined && patch[field] !== row[field]
  if (patch.archivedAt != null) return OPERATOR_ONLY_CONSTITUTION_EDIT_ERROR
  if (changes('type') || changes('title') || changes('bodyMd') || changes('summary')) {
    return OPERATOR_ONLY_CONSTITUTION_EDIT_ERROR
  }
  return null
}

export type ConstitutionAcceptFailure =
  | 'not_found'
  | 'not_a_constitution_amendment'
  | 'not_pending'
  | 'invalid_amendment'
  | 'invalid_live_constitution'
  | 'stale_amendment'

export type ApplyAmendmentResult =
  | { ok: true; constitutionId: string; version: number; supersededId: string | null; alreadyApplied: boolean }
  | { ok: false; reason: ConstitutionAcceptFailure }

function linkTargets(meta: Record<string, unknown>): string[] {
  return Array.isArray(meta.citations) ? meta.citations.filter((c): c is string => typeof c === 'string') : []
}

// Pure: validate a proposal against the live version and build the next one.
// An amendment drafted against an older version is refused (stale) rather than
// silently discarding the changes accepted since.
export function decideConstitutionAcceptance(
  proposal: ProposalForAccept,
  liveRow: ConstitutionRow | null,
  now: Date = new Date(),
): AcceptDecision<ConstitutionAcceptFailure> {
  const meta = proposal.sourceMetadata
  if (proposal.type !== 'inbound' || meta.introspection !== true || meta.kind !== CONSTITUTION_PROPOSAL_KIND) {
    return { ok: false, reason: 'not_a_constitution_amendment' }
  }
  if (meta.status !== 'pending') return { ok: false, reason: 'not_pending' }
  const amendment = readProposalMeta(meta)
  if (!amendment) return { ok: false, reason: 'invalid_amendment' }

  const live = liveRow ? toLiveConstitution(liveRow) : null
  if (liveRow && !live) return { ok: false, reason: 'invalid_live_constitution' }
  const current = live?.version ?? 0
  if (amendment.basedOnVersion !== current) return { ok: false, reason: 'stale_amendment' }

  const version = current + 1
  const principles = numberPrinciples(amendment.principles)
  const links: EngineLink[] = [
    { type: 'refers_to', target: proposal.id, target_kind: 'memory' },
    ...linkTargets(meta).map((target): EngineLink => ({ type: 'refers_to', target, target_kind: 'memory' })),
    ...(live ? [{ type: 'supersedes', target: live.id, target_kind: 'memory' }] : []),
  ]
  return {
    ok: true,
    values: {
      version,
      title: `Constitution v${version}`,
      bodyMd: renderConstitutionMarkdown(version, principles),
      summary: `Constitution v${version}: ${principles.length} principles`,
      links,
      sourceMetadata: {
        constitution: { version, principles, acceptedFrom: proposal.id },
        basedOnVersion: amendment.basedOnVersion,
        rationale: amendment.rationale,
        acceptedAt: now.toISOString(),
      },
      opReason: live
        ? `constitution v${current} → v${version} accepted from proposal ${proposal.id}`
        : `constitution v1 accepted from proposal ${proposal.id}`,
      opAfter: { version, principles: principles.length, acceptedFrom: proposal.id, previousVersion: live?.version ?? null },
    },
  }
}

// The acceptance hook for acceptProposal (kind 'constitution_amendment'):
// writes the new version, supersedes the previous live one, closes the
// proposal and logs a memory_ops 'promote' row (step 'constitution') in ONE
// transaction. Idempotent — a second call for the same proposal returns the
// version it already produced with alreadyApplied:true.
export async function applyAcceptedConstitutionAmendment(
  userId: string,
  proposalId: string,
  now: Date = new Date(),
): Promise<ApplyAmendmentResult> {
  if (!UUID_RE.test(proposalId)) return { ok: false, reason: 'not_found' }
  return acceptConstitutionProposalTx<ConstitutionAcceptFailure>(
    userId,
    proposalId,
    (proposal, live) => decideConstitutionAcceptance(proposal, live, now),
    now,
  )
}

// ── Read (get_constitution / GET /api/v1/kairos/constitution) ──────────────

export interface DriftStatus {
  date: string
  version: number
  mean: number
  alert: boolean
  flipped: Array<{ probeId: string; question: string; sim: number }>
  measuredAt: Date
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

// Latest nightly drift reading for the daily message (null = none measured
// yet — e.g. only the baseline exists).
export async function getLatestDriftStatus(userId: string): Promise<DriftStatus | null> {
  const row = await findLatestDriftRun(userId)
  if (!row) return null
  const drift = row.sourceMetadata.drift as Record<string, unknown> | undefined
  const mean = num(drift?.mean)
  const version = num(drift?.version)
  if (!drift || mean === null || version === null || typeof drift.date !== 'string') return null
  const perProbe = Array.isArray(drift.perProbe) ? (drift.perProbe as Array<Record<string, unknown>>) : []
  const flippedIds = new Set(Array.isArray(drift.flipped) ? drift.flipped.filter((x): x is string => typeof x === 'string') : [])
  const flipped = perProbe
    .filter((p) => typeof p.probeId === 'string' && flippedIds.has(p.probeId) && num(p.sim) !== null)
    .map((p) => ({
      probeId: p.probeId as string,
      question: findDriftProbe(p.probeId as string)?.question ?? '',
      sim: p.sim as number,
    }))
  return { date: drift.date, version, mean, alert: drift.alert === true, flipped, measuredAt: row.createdAt }
}

export interface ConstitutionOverview {
  constitution: LiveConstitution | null
  versions: Array<{ id: string; version: number | null; createdAt: Date; supersededAt: Date | null }>
  pendingAmendments: Array<{ id: string; title: string; basedOnVersion: number | null; principles: number; createdAt: Date }>
  drift: DriftStatus | null
}

export async function getConstitutionOverview(userId: string): Promise<ConstitutionOverview> {
  const [constitution, versionRows, pending, drift] = await Promise.all([
    getLiveConstitution(userId),
    listConstitutionVersionRows(userId),
    listPendingConstitutionProposals(userId),
    getLatestDriftStatus(userId),
  ])
  return {
    constitution,
    versions: versionRows.map((r) => ({
      id: r.id,
      version: toLiveConstitution(r)?.version ?? null,
      createdAt: r.createdAt,
      supersededAt: r.supersededAt,
    })),
    pendingAmendments: pending.map((p) => {
      const meta = readProposalMeta(p.sourceMetadata)
      return {
        id: p.id,
        title: p.title,
        basedOnVersion: meta?.basedOnVersion ?? null,
        principles: meta?.principles.length ?? 0,
        createdAt: p.createdAt,
      }
    }),
    drift,
  }
}
