import { z } from 'zod'

// Life chapters (wave 4 lane E, KAIROS_LIFE_CHAPTERS). One trace row per
// UTC month: memories.source_metadata { kind:'life_chapter',
// externalKey:'life_chapter:YYYY-MM', chapter:{…} }, written only by the
// life_chapter thinking job. The read schema is shared by the
// get_kairos_life_chapters MCP tool and GET /api/v1/kairos/life-chapters.

export const LIFE_CHAPTER_TITLE_MAX = 80
export const LIFE_CHAPTER_SUMMARY_MAX = 400
export const LIFE_CHAPTER_ITEM_MAX = 240
export const LIFE_CHAPTER_SIDE_MAX = 200
export const LIFE_CHAPTER_UNRESOLVED_MAX = 200
export const LIFE_CHAPTER_TURNING_POINTS_MAX = 4
export const LIFE_CHAPTER_CHANGES_MAX = 5
export const LIFE_CHAPTER_UNRESOLVED_ITEMS_MAX = 5
export const LIFE_CHAPTER_EVIDENCE_MAX = 6
export const LIFE_CHAPTER_LIST_MAX = 12

export const lifeChapterMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be YYYY-MM')

const ids = z.array(z.string().min(1).max(100)).min(1).max(LIFE_CHAPTER_EVIDENCE_MAX)

export const lifeChapterTurningPointSchema = z.object({
  what: z.string().min(1).max(LIFE_CHAPTER_ITEM_MAX),
  before: z.string().max(LIFE_CHAPTER_SIDE_MAX),
  after: z.string().max(LIFE_CHAPTER_SIDE_MAX),
  evidenceIds: ids,
})

export const lifeChapterChangeSchema = z.object({
  text: z.string().min(1).max(LIFE_CHAPTER_ITEM_MAX),
  evidenceIds: ids,
})

// The stored chapter (sourceMetadata.chapter). Lenient on extra keys so a
// later version's row still reads.
export const lifeChapterMetaSchema = z.object({
  v: z.literal(1),
  month: lifeChapterMonthSchema,
  window: z.object({ start: z.string(), end: z.string() }),
  title: z.string().min(1).max(LIFE_CHAPTER_TITLE_MAX),
  summary: z.string().max(LIFE_CHAPTER_SUMMARY_MAX),
  turningPoints: z.array(lifeChapterTurningPointSchema).max(LIFE_CHAPTER_TURNING_POINTS_MAX),
  whatChanged: z.array(lifeChapterChangeSchema).max(LIFE_CHAPTER_CHANGES_MAX),
  unresolved: z.array(z.string().min(1).max(LIFE_CHAPTER_UNRESOLVED_MAX)).max(LIFE_CHAPTER_UNRESOLVED_ITEMS_MAX),
  citations: z.array(z.string()),
  inputCounts: z.record(z.string(), z.number().int().min(0)),
  // Measurement only: never rendered back into any prompt or view.
  lintHits: z.number().int().min(0),
  jobId: z.string(),
  answeredBy: z.string(),
})

export type LifeChapterTurningPoint = z.infer<typeof lifeChapterTurningPointSchema>
export type LifeChapterChange = z.infer<typeof lifeChapterChangeSchema>
export type LifeChapterMeta = z.infer<typeof lifeChapterMetaSchema>

// ── Read view (MCP get_kairos_life_chapters ≡ GET /api/v1/kairos/life-chapters)

export interface LifeChapterView {
  id: string
  month: string
  title: string
  summary: string
  turningPoints: LifeChapterTurningPoint[]
  whatChanged: LifeChapterChange[]
  unresolved: string[]
  citations: string[]
  createdAt: string
}

export const getKairosLifeChaptersSchema = z.object({
  month: lifeChapterMonthSchema.optional(),
  limit: z.coerce.number().int().min(1).max(LIFE_CHAPTER_LIST_MAX).default(3),
  format: z.enum(['json', 'markdown']).default('json'),
})

export type GetKairosLifeChaptersInput = z.infer<typeof getKairosLifeChaptersSchema>
