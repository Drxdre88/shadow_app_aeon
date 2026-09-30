import { captureMemory, type CaptureMemoryInput } from '@/lib/data/memories'
import {
  attachSessionMemory,
  countFlightDeckSignals,
  findMissionCardContext,
  type FlightDeckCounts,
} from '@/lib/data/sessions'
import type { HangarResultEnvelope } from '@/lib/data/validators'
import type { AgentSession } from '@/lib/db/schema'
import { buildSessionRecord, type SessionRecordV1 } from './session-record'

// Mission envelope → memory (research/kairos_2909/03 §C injection point 1).
// A Hangar mission's terminal result becomes ONE session_summary memory so the
// digest / cortex / chat readers see "mission X landed" the same way they see
// a hook-captured CLI session. Idempotent through captureMemory's
// (source, externalId) dedup: externalId = hangar:{sessionId}.

const TITLE_MAX = 255
const SUMMARY_MAX = 240
const BODY_SUMMARY_MAX = 8000
const TAG_MAX = 50

export interface MissionCard {
  taskId: string
  name: string
  projectId: string
  dominionId: string | null
}

export interface MissionMemoryContext {
  session: Pick<AgentSession, 'id' | 'engine' | 'repo' | 'dominionId' | 'startedAt' | 'spawnedAt' | 'metadata'>
  envelope: HangarResultEnvelope
  card: MissionCard
  flightDeck?: FlightDeckCounts | null
  now?: Date
}

// Chat / dialogue threads share agent_sessions; they are not missions.
export function isMissionEngine(engine: string): boolean {
  return !engine.startsWith('kairos-')
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? ''
}

function firstSentence(text: string): string {
  const line = firstLine(text)
  const match = line.match(/^(.+?[.!?])(\s|$)/)
  return (match ? match[1] : line).slice(0, SUMMARY_MAX)
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

function hangarMeta(session: MissionMemoryContext['session']): Record<string, unknown> {
  const meta = (session.metadata as { hangar?: unknown } | null)?.hangar
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta as Record<string, unknown> : {}
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

export function buildMissionSessionRecord(ctx: MissionMemoryContext): SessionRecordV1 {
  const { session, envelope, card, flightDeck } = ctx
  const now = ctx.now ?? new Date()
  const hangar = hangarMeta(session)
  const stats = envelope.stats
  const repo = str(session.repo) ?? str(hangar.repo)
  const started = session.startedAt ?? null
  const durationMs = stats?.durationMs ?? (started ? now.getTime() - started.getTime() : undefined)

  return buildSessionRecord({
    client: session.engine,
    sessionId: session.id,
    hangarSessionId: session.id,
    taskId: card.taskId,
    projectId: card.projectId,
    // Hangar knows the registry slug only; the canonical folder slug is
    // resolved by readers via the registry.
    repo,
    registrySlug: repo,
    worktree: true,
    startedAt: started ? started.toISOString() : undefined,
    endedAt: now.toISOString(),
    durationMin: durationMs !== undefined && durationMs >= 0 ? Math.round(durationMs / 600) / 100 : undefined,
    objective: str(hangar.objective),
    cardName: card.name,
    status: envelope.status,
    outcome: str(envelope.outcome),
    questions: envelope.questions,
    branch: str(envelope.branch),
    commits: str(envelope.commit) ? [{ sha: envelope.commit!.trim() }] : undefined,
    tests: envelope.tests,
    model: stats?.model ?? str(hangar.model),
    inputTokens: stats?.inputTokens,
    outputTokens: stats?.outputTokens,
    cacheReadTokens: stats?.cacheReadTokens,
    costUsd: stats?.totalCostUsd,
    toolCalls: stats?.toolCalls !== undefined ? { total: stats.toolCalls } : undefined,
    errorCount: flightDeck ? flightDeck.errors : undefined,
    files: envelope.artifacts,
  })
}

function renderBody(ctx: MissionMemoryContext, record: SessionRecordV1): string {
  const { envelope, flightDeck } = ctx
  const lines: string[] = []
  lines.push(`**Status:** ${envelope.status}${envelope.outcome ? ` — ${envelope.outcome}` : ''}`)
  if (record.objective) lines.push(`**Objective:** ${record.objective}`)
  if (record.repo) lines.push(`**Repo:** ${record.repo}`)
  if (record.branch || record.commits?.length) {
    const commit = record.commits?.[0]?.sha
    lines.push(`**Branch:** ${record.branch ?? '—'}${commit ? ` @ ${commit.slice(0, 12)}` : ''}`)
  }
  if (envelope.tests) {
    lines.push(`**Tests:** ${envelope.tests.status}${envelope.tests.summary ? ` — ${envelope.tests.summary}` : ''}`)
  }

  if (envelope.questions?.length) {
    lines.push('', '### Questions', ...envelope.questions.map((q) => `- ${q}`))
  }
  if (envelope.recommended_tasks?.length) {
    lines.push('', '### Recommended tasks',
      ...envelope.recommended_tasks.map((t) => `- ${t.title} (${t.objective})`))
  }
  if (envelope.artifacts?.length) {
    lines.push('', '### Artifacts', ...envelope.artifacts.map((a) => `- ${a}`))
  }

  const stats: string[] = []
  if (record.model) stats.push(`model ${record.model}`)
  if (record.durationMin !== undefined) stats.push(`${record.durationMin} min`)
  if (envelope.stats?.numTurns !== undefined) stats.push(`${envelope.stats.numTurns} turns`)
  if (envelope.stats?.toolCalls !== undefined) stats.push(`${envelope.stats.toolCalls} tool calls`)
  if (record.inputTokens !== undefined || record.outputTokens !== undefined) {
    stats.push(`tokens in ${record.inputTokens ?? 0} / out ${record.outputTokens ?? 0}`)
  }
  if (record.costUsd !== undefined) stats.push(`$${record.costUsd.toFixed(2)}`)
  if (flightDeck) {
    stats.push(`${flightDeck.errors} errors, ${flightDeck.warnings} warnings, ${flightDeck.downgrades} downgrades`)
  }
  if (stats.length) lines.push('', '### Stats', stats.join(' · '))

  const summary = envelope.summary.trim()
  if (summary) lines.push('', '### Summary', clip(summary, BODY_SUMMARY_MAX))
  return lines.join('\n')
}

/** Pure: the captureMemory payload for a settled mission. */
export function buildMissionMemoryInput(ctx: MissionMemoryContext): CaptureMemoryInput {
  const { session, envelope, card, flightDeck } = ctx
  const record = buildMissionSessionRecord(ctx)
  const summaryLine = firstSentence(envelope.summary)
  const fallbackTitle = firstLine(envelope.summary) || envelope.outcome || `Mission ${session.id}`
  const title = record.repo && card.name ? `${record.repo}: ${card.name}` : (card.name || fallbackTitle)

  const tags = ['session', 'hangar', session.engine, envelope.status, ...(record.repo ? [`repo:${record.repo}`] : [])]
    .map((t) => t.slice(0, TAG_MAX))

  const dominionId = session.dominionId ?? null

  return {
    title: clip(title, TITLE_MAX),
    bodyMd: renderBody(ctx, record),
    ...(summaryLine ? { summary: summaryLine } : {}),
    type: 'session_summary',
    source: 'system',
    streamClass: 'agentic',
    taskId: card.taskId,
    projectId: card.projectId,
    ...(dominionId ? { dominionId } : {}),
    tags,
    sourceMetadata: {
      kind: 'hangar_mission',
      externalId: `hangar:${session.id}`,
      session: record,
      ...(envelope.stats ? { stats: envelope.stats } : {}),
      ...(flightDeck ? { flightDeck } : {}),
    },
  }
}

/**
 * Best-effort: capture the mission memory and link it from agent_sessions.
 * Never throws — a memory failure must not fail the runner's result POST.
 */
export async function captureMissionMemory(
  userId: string,
  session: MissionMemoryContext['session'] & { taskId: string | null },
  envelope: HangarResultEnvelope,
): Promise<{ memoryId: string; created: boolean } | null> {
  try {
    if (!session.taskId || !isMissionEngine(session.engine)) return null
    const card = await findMissionCardContext(session.taskId)
    if (!card) return null

    let flightDeck: FlightDeckCounts | null = null
    try {
      flightDeck = await countFlightDeckSignals(session.id)
    } catch (err) {
      console.warn('[hangar] flight deck counts unavailable for mission memory', {
        sessionId: session.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }

    const { memory, created } = await captureMemory(
      userId,
      buildMissionMemoryInput({ session, envelope, card, flightDeck }),
    )
    await attachSessionMemory(session.id, userId, memory.id)
    return { memoryId: memory.id, created }
  } catch (err) {
    console.error('[hangar] mission memory capture failed', {
      sessionId: session.id,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
