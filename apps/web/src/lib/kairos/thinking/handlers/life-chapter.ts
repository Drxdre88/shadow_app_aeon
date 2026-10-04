import type {
  ApplyOutcome,
  ThinkingJobHandler,
  ThinkingJobKind,
  ThinkingJobSpec,
} from '@/lib/kairos/engine/types'

// Life chapter (wave 4 lane E, deep tier, brain routine). Registered by the
// seam as a stub: plan never builds a job, so nothing is planned, claimed or
// written until lane E fills it in. No fallback — a missed month is skipped.

export const LIFE_CHAPTER_KIND: ThinkingJobKind = 'life_chapter'

export const lifeChapterJobKey = (month: string) => `life_chapter:${month}`

async function plan(): Promise<ThinkingJobSpec[]> {
  return []
}

async function apply(): Promise<ApplyOutcome> {
  return { ok: false, reason: 'life_chapter is not built yet' }
}

async function fallback(): Promise<ApplyOutcome> {
  return { ok: false, reason: 'no fallback — a missed month is fine' }
}

export const lifeChapterHandler: ThinkingJobHandler = {
  kind: LIFE_CHAPTER_KIND,
  plan,
  apply,
  fallback,
}
