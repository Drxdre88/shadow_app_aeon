import { z } from 'zod'

// Surprise as the engine (spec_surprise, Wave 0 contract). Two stores:
//  - the ledger: the server-owned `kairosSurprise` key in
//    user_preferences.preferences, written only through mutateKairosSurprise;
//  - the mark: memories.source_metadata.engine.surprise on a memory row,
//    written only by lib/data/surprise-marks (one atomic jsonb_set).
// The read schema is shared by the get_kairos_surprise MCP tool and
// GET /api/v1/kairos/surprise.

export const SURPRISE_MAX_EVENTS = 64
export const SURPRISE_MAX_SEEN = 128
export const SURPRISE_RETENTION_MS = 7 * 86_400_000
export const SURPRISE_MAX_BYTES = 16_000
export const SURPRISE_MAX_REFS = 24
export const SURPRISE_MAX_OPENED = 24
export const SURPRISE_MAX_LP_AREAS = 32
export const SURPRISE_MAX_REPLAY_IDS = 24
export const SURPRISE_MAX_SIGNALS = 5
export const SURPRISE_KEY_MAX = 200

const unit = z.number().min(0).max(1)
const iso = z.string().min(1).max(40)
const ref = z.string().min(1).max(100)

export const surpriseEventKindSchema = z.enum([
  'prediction_wrong',
  'prediction_right',
  'promise_kept',
  'promise_lapsed',
  'promise_dropped',
  'support_lost',
  'contradiction',
  'owner_correction',
  'aha',
])

// Mark signals also carry 'pressure' (the pressure valve opens a belief that
// accumulated gated replaces without a single event).
export const surpriseSignalKindSchema = z.enum([...surpriseEventKindSchema.options, 'pressure'])

export const surpriseRefsSchema = z.object({
  predictionId: ref.optional(),
  promiseId: ref.optional(),
  beliefIds: z.array(ref).max(SURPRISE_MAX_REFS),
  memoryIds: z.array(ref).max(SURPRISE_MAX_REFS),
}).strict()

export const surpriseEventSchema = z.object({
  id: z.string().regex(/^s_[0-9a-f]{8}$/),
  key: z.string().min(1).max(SURPRISE_KEY_MAX),
  at: iso,
  kind: surpriseEventKindSchema,
  s: unit,
  dominionId: ref.nullable(),
  refs: surpriseRefsSchema,
  opened: z.array(ref).max(SURPRISE_MAX_OPENED),
  credited: z.object({ pos: z.number().int().min(0), neg: z.number().int().min(0) }).strict().optional(),
}).strict()

export const surpriseLpAreaSchema = z.object({
  key: z.string().min(1).max(120),
  lp: z.number().min(-1).max(1),
  brierNew: unit,
  nNew: z.number().int().min(0),
  nOld: z.number().int().min(0),
}).strict()

export const surpriseLpSchema = z.object({
  computedAt: iso,
  areas: z.array(surpriseLpAreaSchema).max(SURPRISE_MAX_LP_AREAS),
}).strict()

export const surpriseReplaySchema = z.object({
  night: z.string().min(1).max(40),
  ids: z.array(ref).max(SURPRISE_MAX_REPLAY_IDS),
  prevHits: z.number().int().min(0).optional(),
}).strict()

export const kairosSurpriseLedgerSchema = z.object({
  v: z.literal(1),
  events: z.array(surpriseEventSchema).max(SURPRISE_MAX_EVENTS),
  seen: z.array(z.string().min(1).max(SURPRISE_KEY_MAX)).max(SURPRISE_MAX_SEEN),
  lp: surpriseLpSchema.nullable(),
  replay: surpriseReplaySchema.nullable(),
}).strict().refine((s) => JSON.stringify(s).length <= SURPRISE_MAX_BYTES, `kairosSurprise exceeds ${SURPRISE_MAX_BYTES} bytes`)

export type SurpriseEventKind = z.infer<typeof surpriseEventKindSchema>
export type SurpriseSignalKind = z.infer<typeof surpriseSignalKindSchema>
export type SurpriseRefs = z.infer<typeof surpriseRefsSchema>
export type SurpriseEvent = z.infer<typeof surpriseEventSchema>
export type SurpriseLp = z.infer<typeof surpriseLpSchema>
export type SurpriseLpArea = z.infer<typeof surpriseLpAreaSchema>
export type SurpriseReplay = z.infer<typeof surpriseReplaySchema>
export type KairosSurpriseLedger = z.infer<typeof kairosSurpriseLedgerSchema>

// What a producer hands recordSurprise. id is derived from key; refs and
// opened default to empty; at defaults to now.
export const surpriseEventInputSchema = z.object({
  key: z.string().min(1).max(SURPRISE_KEY_MAX),
  kind: surpriseEventKindSchema,
  s: unit,
  at: iso.optional(),
  dominionId: ref.nullable().optional(),
  refs: surpriseRefsSchema.partial().optional(),
  opened: z.array(ref).max(SURPRISE_MAX_OPENED).optional(),
  credited: z.object({ pos: z.number().int().min(0), neg: z.number().int().min(0) }).strict().optional(),
}).strict()

export type SurpriseEventInput = z.input<typeof surpriseEventInputSchema>

// ── The mark: memories.source_metadata.engine.surprise ─────────────────────

export const surpriseSignalSchema = z.object({
  kind: surpriseSignalKindSchema,
  ref: ref,
  at: iso,
  s: unit,
}).strict()

// Not strict: the row is shared jsonb; unknown keys under the mark survive.
export const surpriseMarkSchema = z.object({
  openUntil: iso,
  signals: z.array(surpriseSignalSchema).max(SURPRISE_MAX_SIGNALS),
  pressure: z.object({ n: z.number().int().min(0), since: iso }).optional(),
})

export type SurpriseSignal = z.infer<typeof surpriseSignalSchema>
export type SurpriseMark = z.infer<typeof surpriseMarkSchema>

// ── Read view (MCP get_kairos_surprise ≡ GET /api/v1/kairos/surprise) ──────

export const surpriseEventViewSchema = z.object({
  id: z.string(),
  at: z.string(),
  kind: surpriseEventKindSchema,
  s: z.number(),
  dominionId: z.string().nullable(),
  beliefs: z.number().int(),
  memories: z.number().int(),
  opened: z.number().int(),
  credited: z.object({ pos: z.number().int(), neg: z.number().int() }).nullable(),
})

export const kairosSurpriseViewSchema = z.object({
  events: z.array(surpriseEventViewSchema),
  last7d: z.object({
    count: z.number().int(),
    sumS: z.number(),
    byKind: z.record(z.string(), z.number().int()),
  }),
  lp: surpriseLpSchema.nullable(),
  replay: surpriseReplaySchema.nullable(),
})

export type SurpriseEventView = z.infer<typeof surpriseEventViewSchema>
export type KairosSurpriseView = z.infer<typeof kairosSurpriseViewSchema>

export const getKairosSurpriseSchema = z.object({
  format: z.enum(['json', 'markdown']).default('json'),
})

export type GetKairosSurpriseInput = z.infer<typeof getKairosSurpriseSchema>
