import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories, dominions } from '@/lib/db/schema'
import { findDominionsByUser } from '@/lib/data/dominions'
import { findSimilarBeliefs, BELIEF_TYPES } from '@/lib/data/memories'
import { getProviderForTask } from '@/lib/ai/route-task'
import { AiCredentialMissingError, AiCredentialDecryptError } from '@/lib/ai/router'
import { withRetry } from '@/lib/ai/retry'
import {
  CONTRADICTION_SYSTEM_PROMPT,
  buildContradictionUserPrompt,
  contradictionOutSchema,
  filterGroundedFindings,
  extractJsonBlock,
  type ContradictionCandidate,
  type ContradictionProbe,
} from './contradiction-prompt'
import { todayIso } from './_prompt-utils'
import { writeCronFailureTrace } from './cron-trace'

// ─────────────────────────────────────────────────────────────────────────
// Kairos — Contradiction detection runner (propose-not-commit).
//
// Per active Dominion: take recently-touched belief memories as probes, find
// each probe's nearest semantic neighbours (findSimilarBeliefs), and ask the
// model whether any make a contradictory claim. Every grounded finding is
// staged as a `type='inbound'` memory — a conflict NOTICE, never applied
// directly — carrying a `contradicts` edge to the losing belief and a
// `refers_to` edge to the winner. The operator resolves it via accept_proposal
// (supersedes the loser) or dismisses it via archive. This is L1 on the
// autonomy gradient, same as introspection.ts: generation is cheap,
// commitment is gated, every finding is evidence-cited.
// ─────────────────────────────────────────────────────────────────────────

const PROBE_WINDOW_DAYS = 7
const PROBE_LIMIT = 25
const PROPOSAL_TYPE = 'inbound'

async function alreadyRanToday(userId: string, dominionId: string): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.dominionId, dominionId),
      eq(memories.type, PROPOSAL_TYPE),
      sql`${memories.sourceMetadata}->>'contradictionCheck' = 'true'`,
      sql`${memories.createdAt} >= DATE_TRUNC('day', NOW())`,
    ))
  return (row?.n ?? 0) > 0
}

// Probe set — belief memories touched in the last N days, capped so a single
// run stays bounded in LLM cost even for a heavily-active Dominion.
async function fetchProbes(userId: string, dominionId: string): Promise<ContradictionProbe[]> {
  const since = sql`NOW() - make_interval(days => ${PROBE_WINDOW_DAYS})`
  return db
    .select({
      id: memories.id,
      title: memories.title,
      bodyMd: memories.bodyMd,
      type: memories.type,
      createdAt: memories.createdAt,
      confidence: memories.confidence,
    })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.dominionId, dominionId),
      inArray(memories.type, [...BELIEF_TYPES]),
      isNull(memories.archivedAt),
      isNull(memories.supersededAt),
      sql`(${memories.createdAt} >= ${since} OR ${memories.updatedAt} >= ${since})`,
    ))
    .orderBy(desc(memories.createdAt))
    .limit(PROBE_LIMIT)
}

// Dedup guard — don't re-propose the same conflict every night while the
// operator sits on an earlier unresolved proposal. Keyed on the UNORDERED pair
// (LEAST/GREATEST) so a flipped-winner re-judgment (A-beats-B one night,
// B-beats-A the next) still matches the existing proposal instead of stacking
// a second, contradictory one.
async function hasPendingProposalFor(userId: string, aId: string, bId: string): Promise<boolean> {
  const [lo, hi] = aId < bId ? [aId, bId] : [bId, aId]
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.type, PROPOSAL_TYPE),
      sql`${memories.sourceMetadata}->>'kind' = 'contradiction'`,
      sql`${memories.sourceMetadata}->>'status' = 'pending'`,
      sql`LEAST(${memories.sourceMetadata}->>'winnerId', ${memories.sourceMetadata}->>'loserId') = ${lo}`,
      sql`GREATEST(${memories.sourceMetadata}->>'winnerId', ${memories.sourceMetadata}->>'loserId') = ${hi}`,
    ))
  return (row?.n ?? 0) > 0
}

export interface ContradictionScanResult {
  dominionId: string
  dominionName: string
  status: 'created' | 'existing' | 'skipped' | 'error'
  proposalsCreated?: number
  reason?: string
}

export async function runContradictionScanForDominion(
  userId: string,
  dominionId: string,
): Promise<ContradictionScanResult> {
  const [dom] = await db
    .select({ id: dominions.id, name: dominions.name, archivedAt: dominions.archivedAt })
    .from(dominions)
    .where(and(eq(dominions.id, dominionId), eq(dominions.userId, userId)))
    .limit(1)
  if (!dom) return { dominionId, dominionName: '(unknown)', status: 'error', reason: 'dominion not found' }
  if (dom.archivedAt) return { dominionId, dominionName: dom.name, status: 'skipped', reason: 'archived' }

  if (await alreadyRanToday(userId, dominionId)) {
    return { dominionId, dominionName: dom.name, status: 'existing', reason: 'already ran today' }
  }

  const probes = await fetchProbes(userId, dominionId)
  if (probes.length === 0) {
    return { dominionId, dominionName: dom.name, status: 'skipped', reason: 'no recent beliefs' }
  }

  const runId = `contradiction:${dominionId}:${todayIso()}`
  const rows: (typeof memories.$inferInsert)[] = []
  // In-run guard alongside the DB check — two probes in the same batch can
  // resolve to the same underlying conflict from opposite directions.
  const queuedPairs = new Set<string>()

  for (const probe of probes) {
    const candidates = await findSimilarBeliefs(probe.id, userId, { dominionId })
    if (candidates.length === 0) continue

    let rawText: string
    try {
      const { provider } = await getProviderForTask(userId, { taskType: 'contradiction', dominionId })
      const response = await withRetry(() => provider.ask({
        system: CONTRADICTION_SYSTEM_PROMPT,
        prompt: buildContradictionUserPrompt(probe, candidates as ContradictionCandidate[]),
        cacheSystem: true,
        maxTokens: 1200,
      }))
      rawText = response.text.trim()
    } catch (err) {
      if (err instanceof AiCredentialMissingError) {
        return { dominionId, dominionName: dom.name, status: 'skipped', reason: 'no BYOK credential' }
      }
      if (err instanceof AiCredentialDecryptError) {
        return { dominionId, dominionName: dom.name, status: 'skipped', reason: 'key undecryptable' }
      }
      // Any other judge error is probe-local (withRetry already exhausted the
      // transient path): trace it and move to the next probe so one bad probe
      // can't abort the whole Dominion scan.
      await writeCronFailureTrace(userId, { cronName: 'contradiction-scan', dominionId, reason: 'judge_failed', error: err })
      continue
    }

    if (!rawText) {
      await writeCronFailureTrace(userId, { cronName: 'contradiction-scan', dominionId, reason: 'empty_response' })
      continue
    }

    let findings
    try {
      const parsed = contradictionOutSchema.parse(extractJsonBlock(rawText))
      const validIds = new Set(candidates.map((c) => c.id))
      findings = filterGroundedFindings(parsed, validIds)
    } catch (err) {
      await writeCronFailureTrace(userId, { cronName: 'contradiction-scan', dominionId, reason: 'parse_failed', error: err })
      continue
    }

    const candidateById = new Map(candidates.map((c) => [c.id, c]))
    for (const finding of findings) {
      if (!finding.contradicts) continue
      const candidate = candidateById.get(finding.candidateId)
      if (!candidate) continue

      const winnerId = finding.winner === 'probe' ? probe.id : candidate.id
      const loserId = finding.winner === 'probe' ? candidate.id : probe.id
      // Unordered key — same pair from either direction dedups to one entry.
      const pairKey = winnerId < loserId ? `${winnerId}:${loserId}` : `${loserId}:${winnerId}`
      if (queuedPairs.has(pairKey)) continue
      if (await hasPendingProposalFor(userId, winnerId, loserId)) continue
      queuedPairs.add(pairKey)

      rows.push({
        userId,
        dominionId,
        title: `Contradiction: "${probe.title}" vs "${candidate.title}"`.slice(0, 255),
        bodyMd: finding.rationale,
        summary: finding.rationale.slice(0, 240),
        type: PROPOSAL_TYPE,
        // Agentic stream — Kairos's own flagged notice, weighted below the
        // operator's reflections until accepted.
        streamClass: 'agentic',
        source: 'cron',
        sourceMetadata: {
          contradictionCheck: true,
          kind: 'contradiction',
          status: 'pending',
          confidence: finding.confidence,
          winnerId,
          loserId,
          rationale: finding.rationale,
          citations: [probe.id, candidate.id],
          runId,
        },
        // Provenance: the loser is what this notice would supersede if
        // accepted; the winner is the belief that stays authoritative.
        links: [
          { type: 'contradicts', target: loserId, target_kind: 'memory' },
          { type: 'refers_to', target: winnerId, target_kind: 'memory' },
        ],
        tags: ['proposal', 'contradiction'],
        pinned: false,
        createdAt: new Date(),
      })
    }
  }

  if (rows.length === 0) {
    return { dominionId, dominionName: dom.name, status: 'created', proposalsCreated: 0, reason: 'no contradictions found' }
  }

  await db.insert(memories).values(rows)

  return { dominionId, dominionName: dom.name, status: 'created', proposalsCreated: rows.length }
}

export async function runContradictionScanForUser(userId: string): Promise<ContradictionScanResult[]> {
  const all = await findDominionsByUser(userId)
  const active = all.filter((d) => !d.archivedAt)
  const results: ContradictionScanResult[] = []
  for (const dom of active) {
    try {
      results.push(await runContradictionScanForDominion(userId, dom.id))
    } catch (err) {
      await writeCronFailureTrace(userId, {
        cronName: 'contradiction-scan',
        dominionId: dom.id,
        reason: 'uncaught_exception',
        error: err,
      })
      results.push({
        dominionId: dom.id,
        dominionName: dom.name,
        status: 'error',
        reason: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return results
}
