import { z } from 'zod'
import { IDEA_KINDS, IDEA_LEAPS } from '@/lib/kairos/ideas/types'

// Idea atlas (wave 3 lane A, MAP-Elites grid: life area × idea kind × leap).
// Stored as the server-owned `kairosIdeaAtlas` key in
// user_preferences.preferences; written only by the nightly idea judge
// through mutateKairosIdeaAtlas. The read schema is shared verbatim by the
// get_kairos_idea_atlas MCP tool and GET /api/v1/kairos/idea-atlas
// (kairos-idea-atlas-parity.test.ts).

export const ATLAS_MAX_CELLS = 200
export const ATLAS_MAX_HISTORY = 30
export const ATLAS_TITLE_MAX = 140
export const ATLAS_CLAIM_MAX = 300
export const ATLAS_MAX_BYTES = 150_000
export const ATLAS_CROSS_AREA = 'cross'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const atlasHolderSchema = z.object({
  memoryId: z.string().min(1).max(100),
  title: z.string().max(ATLAS_TITLE_MAX),
  claim: z.string().max(ATLAS_CLAIM_MAX),
  since: day,
  elo: z.number().nullable(),
  defended: z.number().int().min(0),
}).strict()

export const atlasCellSchema = z.object({
  area: z.string().min(1).max(100),
  kind: z.enum(IDEA_KINDS),
  leap: z.enum(IDEA_LEAPS),
  holder: atlasHolderSchema.nullable(),
  tries: z.number().int().min(0),
  targetedOn: day.nullable(),
  lastChallengeOn: day.nullable(),
}).strict()

export const atlasHistorySchema = z.object({
  date: day,
  filled: z.number().int().min(0),
  replaced: z.number().int().min(0),
  defended: z.number().int().min(0),
  targets: z.array(z.string().max(200)).max(16),
  coverage: z.number().min(0).max(1),
}).strict()

export const kairosIdeaAtlasStateSchema = z.object({
  v: z.literal(1),
  lastNight: day.nullable(),
  cells: z.record(z.string().min(1).max(200), atlasCellSchema)
    .refine((cells) => Object.keys(cells).length <= ATLAS_MAX_CELLS, `kairosIdeaAtlas exceeds ${ATLAS_MAX_CELLS} cells`),
  history: z.array(atlasHistorySchema).max(ATLAS_MAX_HISTORY),
}).strict().refine((s) => JSON.stringify(s).length <= ATLAS_MAX_BYTES, `kairosIdeaAtlas exceeds ${ATLAS_MAX_BYTES} bytes`)

export type AtlasHolder = z.infer<typeof atlasHolderSchema>
export type AtlasCell = z.infer<typeof atlasCellSchema>
export type AtlasHistoryEntry = z.infer<typeof atlasHistorySchema>
export type KairosIdeaAtlasState = z.infer<typeof kairosIdeaAtlasStateSchema>

export const emptyIdeaAtlasState = (): KairosIdeaAtlasState => ({ v: 1, lastNight: null, cells: {}, history: [] })

// Read surfaces (MCP + REST).
export const getKairosIdeaAtlasSchema = z.object({
  format: z.enum(['json', 'markdown']).default('json'),
})

export type GetKairosIdeaAtlasInput = z.infer<typeof getKairosIdeaAtlasSchema>
