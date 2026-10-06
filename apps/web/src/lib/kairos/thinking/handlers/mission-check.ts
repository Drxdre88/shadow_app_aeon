import { findChecklistItems } from '@/lib/data/checklist'
import { listMissionCheckCandidates, writeMissionCheck } from '@/lib/data/mission-check'
import { touchProject } from '@/lib/data/projects'
import { missionCheckMode } from '@/lib/kairos/mission-check/flag'
import {
  MISSION_CHECK_MAX_OUTPUT_TOKENS,
  MISSION_CHECK_SYSTEM_PROMPT,
  buildMissionCheckJob,
  groundMissionCheck,
  missionCheckContextSchema,
  parseMissionCheckText,
} from '@/lib/kairos/mission-check/prompt'
import { MISSION_CHECK_KIND } from '@/lib/kairos/mission-check/types'
import type {
  ApplyOutcome,
  ThinkingAnsweredBy,
  ThinkingJobHandler,
  ThinkingJobRow,
  ThinkingJobSpec,
} from '@/lib/kairos/engine/types'
import { errorReason } from './_errors'

// Mission check (KAIROS_MISSION_CHECK + per-board settings.kairosMissionCheck,
// deep tier, brain routine). ADVISORY ONLY: plan picks up to MISSION_CHECK_CAP
// finished missions (completed, non-plan, last 48h, no verdict yet) and asks
// for a verdict judged on what the mission reported; apply writes
// metadata.hangar.check. It never moves, blocks, merges or creates a card.
// No fallback (no paid calls): an unanswered job is simply skipped.

export const MISSION_CHECK_LOOKBACK_MS = 48 * 60 * 60 * 1000
export const MISSION_CHECK_CAP = 5
export const MISSION_CHECK_DEADLINE_MINUTES = 6 * 60

export function missionCheckKey(sessionId: string): string {
  return `${MISSION_CHECK_KIND}:${sessionId}`
}

function hangarResult(metadata: unknown): unknown {
  const hangar = (metadata as { hangar?: { lastResult?: unknown } } | null)?.hangar
  return hangar?.lastResult ?? null
}

async function plan(userId: string, now: Date): Promise<ThinkingJobSpec[]> {
  if (missionCheckMode() === 'off') return []
  const since = new Date(now.getTime() - MISSION_CHECK_LOOKBACK_MS)
  const candidates = await listMissionCheckCandidates(userId, since, MISSION_CHECK_CAP)
  const specs: ThinkingJobSpec[] = []
  for (const c of candidates.slice(0, MISSION_CHECK_CAP)) {
    const checklist = await findChecklistItems(c.taskId, c.projectId)
    const { prompt, context } = buildMissionCheckJob({
      sessionId: c.sessionId,
      taskId: c.taskId,
      projectId: c.projectId,
      cardName: c.cardName,
      description: c.description,
      checklist: checklist.map((i) => ({ title: i.title, groupName: i.groupName, state: i.state, completed: i.completed })),
      result: hangarResult(c.cardMetadata),
      engine: c.engine,
      repo: c.repo,
    })
    specs.push({
      kind: MISSION_CHECK_KIND,
      dominionId: null,
      externalKey: missionCheckKey(c.sessionId),
      deadlineMinutes: MISSION_CHECK_DEADLINE_MINUTES,
      input: {
        system: MISSION_CHECK_SYSTEM_PROMPT,
        prompt,
        validMemoryIds: [],
        maxOutputTokens: MISSION_CHECK_MAX_OUTPUT_TOKENS,
        context,
      },
    })
  }
  return specs
}

async function apply(job: ThinkingJobRow, text: string, answeredBy: ThinkingAnsweredBy): Promise<ApplyOutcome> {
  const parsedCtx = missionCheckContextSchema.safeParse(job.input?.context)
  if (!parsedCtx.success) return { ok: false, reason: `bad_job: ${errorReason(parsedCtx.error)}` }
  const ctx = parsedCtx.data

  const mode = missionCheckMode()
  if (mode === 'off') return { ok: true, memoryIds: [], output: { skipped: 'mode_off', answeredBy } }

  let answer
  try {
    answer = parseMissionCheckText(text)
  } catch (err) {
    return { ok: false, reason: `parse_failed: ${errorReason(err)}` }
  }
  const check = groundMissionCheck(answer, ctx, mode, new Date().toISOString())
  const written = await writeMissionCheck({ projectId: ctx.projectId, taskId: ctx.taskId, userId: job.userId, check })
  if (written !== 'written') return { ok: true, memoryIds: [], output: { skipped: written, answeredBy } }
  await touchProject(ctx.projectId, { type: 'task:updated' })
  return { ok: true, memoryIds: [], output: { verdict: check.verdict, unmet: check.unmet.length, mode, answeredBy } }
}

export const missionCheckHandler: ThinkingJobHandler = {
  kind: MISSION_CHECK_KIND,
  plan,
  apply,
  fallback: async (): Promise<ApplyOutcome> => ({ ok: false, reason: 'no fallback — the verdict is skipped' }),
}
