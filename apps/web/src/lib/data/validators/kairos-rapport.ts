import { z } from 'zod'

// Rapport (wave 4 lane C): readiness per owner goal, small bids, rupture and
// repair. Stored as the server-owned `kairosRapport` key in
// user_preferences.preferences, written only through mutateKairosRapport.
// The read schema is shared by get_kairos_rapport and GET /api/v1/kairos/rapport.

export const RAPPORT_MAX_GOALS = 24
export const RAPPORT_MAX_BIDS = 50
export const RAPPORT_MAX_SOFT = 10
export const RAPPORT_BID_RETENTION_MS = 30 * 86_400_000
export const RAPPORT_SOFT_WINDOW_MS = 72 * 3_600_000
export const RAPPORT_MIN_COOLDOWN_H = 24
export const RAPPORT_MAX_COOLDOWN_H = 168
export const RAPPORT_MAX_BYTES = 24_000

const iso = z.string().min(1).max(40)
const ref = z.string().min(1).max(100)
const tally = z.number().min(0).max(1000)

export const readinessBandSchema = z.enum(['none', 'preparing', 'committed', 'wavering'])
export const tipKindSchema = z.enum(['commit', 'back'])
export const bidKindSchema = z.enum(['link', 'laugh', 'sigh', 'cheer', 'media'])
export const ruptureStateSchema = z.enum(['steady', 'backing_off', 'repair_owed', 'repaired'])
export const ruptureReasonSchema = z.enum(['not_now', 'ignored', 'dismissed', 'terse'])
export const softKindSchema = z.enum(['ignored', 'dismissed', 'terse'])

export const rapportTipSchema = z.object({
  kind: tipKindSchema,
  at: iso,
  marker: z.string().max(60),
  ref: ref.optional(),
}).strict()

export const rapportGoalSchema = z.object({
  title: z.string().min(1).max(120),
  commit: tally,
  prep: tally,
  sustain: tally,
  band: readinessBandSchema,
  lastRef: ref,
  lastSeen: iso,
  lastTip: rapportTipSchema.optional(),
  offeredAt: iso.optional(),
  reflectedAt: iso.optional(),
}).strict()

export const rapportTurnsSchema = z.object({
  lenEwma: z.number().min(0).max(10_000),
  baseline14d: z.number().min(0).max(10_000),
  terseRun: z.number().int().min(0),
  n: z.number().int().min(0),
  lastAt: iso.nullable(),
}).strict()

export const rapportBidSchema = z.object({ at: iso, kind: bidKindSchema, ref }).strict()

export const rapportSoftSchema = z.object({ at: iso, kind: softKindSchema, ref }).strict()

export const rapportRuptureSchema = z.object({
  state: ruptureStateSchema,
  since: iso,
  reason: ruptureReasonSchema.optional(),
  trigger: z.string().max(120).optional(),
  via: z.enum(['chat', 'daily']).optional(),
  soft: z.array(rapportSoftSchema).max(RAPPORT_MAX_SOFT),
  lastRepairAt: iso.optional(),
  cooldownH: z.number().min(RAPPORT_MIN_COOLDOWN_H).max(RAPPORT_MAX_COOLDOWN_H),
}).strict()

export const kairosRapportSchema = z.object({
  v: z.literal(1),
  goals: z.record(z.string().min(1).max(64), rapportGoalSchema)
    .refine((g) => Object.keys(g).length <= RAPPORT_MAX_GOALS, `at most ${RAPPORT_MAX_GOALS} goals`),
  turns: rapportTurnsSchema,
  bids: z.array(rapportBidSchema).max(RAPPORT_MAX_BIDS),
  rupture: rapportRuptureSchema,
}).strict().refine((s) => JSON.stringify(s).length <= RAPPORT_MAX_BYTES, `kairosRapport exceeds ${RAPPORT_MAX_BYTES} bytes`)

export type ReadinessBand = z.infer<typeof readinessBandSchema>
export type TipKind = z.infer<typeof tipKindSchema>
export type BidKind = z.infer<typeof bidKindSchema>
export type RuptureState = z.infer<typeof ruptureStateSchema>
export type RuptureReason = z.infer<typeof ruptureReasonSchema>
export type SoftKind = z.infer<typeof softKindSchema>
export type RapportTip = z.infer<typeof rapportTipSchema>
export type RapportGoal = z.infer<typeof rapportGoalSchema>
export type RapportTurns = z.infer<typeof rapportTurnsSchema>
export type RapportBid = z.infer<typeof rapportBidSchema>
export type RapportSoft = z.infer<typeof rapportSoftSchema>
export type RapportRupture = z.infer<typeof rapportRuptureSchema>
export type KairosRapport = z.infer<typeof kairosRapportSchema>

// ── Read view (MCP get_kairos_rapport ≡ GET /api/v1/kairos/rapport) ────────

export const rapportGoalViewSchema = z.object({
  objectiveId: z.string(),
  title: z.string(),
  band: readinessBandSchema,
  balance: z.number(),
  lastTip: z.object({ kind: tipKindSchema, at: z.string() }).nullable(),
  lastSeen: z.string(),
})

export const kairosRapportViewSchema = z.object({
  flags: z.object({ readiness: z.string(), bids: z.string(), repair: z.string() }),
  rupture: z.object({
    state: ruptureStateSchema,
    since: z.string(),
    reason: ruptureReasonSchema.nullable(),
    cooldownH: z.number(),
    lastRepairAt: z.string().nullable(),
    soft72h: z.record(z.string(), z.number().int()),
  }),
  goals: z.array(rapportGoalViewSchema),
  bids30d: z.object({ count: z.number().int(), byKind: z.record(z.string(), z.number().int()) }),
  turns: z.object({ n: z.number().int(), lenEwma: z.number(), baseline: z.number(), terseRun: z.number().int() }),
})

export type RapportGoalView = z.infer<typeof rapportGoalViewSchema>
export type KairosRapportView = z.infer<typeof kairosRapportViewSchema>

export const getKairosRapportSchema = z.object({
  format: z.enum(['json', 'markdown']).default('json'),
})

export type GetKairosRapportInput = z.infer<typeof getKairosRapportSchema>
