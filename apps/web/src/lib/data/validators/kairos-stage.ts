import { z } from 'zod'

// Kairos stage (global workspace, spec_stage). Stored as the server-owned
// `kairosStage` key in user_preferences.preferences. Written only by the
// plain-code selector (lib/kairos/stage) through mutateKairosStage. The read
// schema is shared verbatim by the get_kairos_stage MCP tool and
// GET /api/v1/kairos/stage (locked by kairos-stage-parity.test.ts).

export const STAGE_MAX_COALITIONS = 16
export const STAGE_MAX_MEMBERS = 6
export const STAGE_MAX_CITES = 8
export const STAGE_MAX_CYCLES = 24
export const STAGE_MAX_SURPRISE = 32
export const STAGE_MAX_POSTED_JOBS = 64
export const STAGE_MAX_AMBIENT_SEEN = 64
export const STAGE_TEXT_MAX = 240
export const STAGE_MAX_BYTES = 20_000

const unit = z.number().min(0).max(1)
const iso = z.string().min(1).max(40)

export const stageTierSchema = z.enum(['light', 'deep', 'owner'])
export const stageSourceSchema = z.enum(['job', 'promise', 'prediction', 'owner'])

export const stageMemberSchema = z.object({
  id: z.string().regex(/^m_[0-9a-f]{8}$/),
  kind: z.string().min(1).max(40),
  source: stageSourceSchema,
  jobId: z.string().min(1).max(100).optional(),
  tier: stageTierSchema,
  at: iso,
  base: unit,
  echo: z.literal(true).optional(),
}).strict()

export const stageCoalitionSchema = z.object({
  id: z.string().regex(/^c_[0-9a-f]{8}$/),
  text: z.string().min(1).max(STAGE_TEXT_MAX),
  cites: z.array(z.string().min(1).max(100)).max(STAGE_MAX_CITES),
  components: z.object({ importance: unit, surprise: unit, goalRelevance: unit, need: unit }).strict(),
  mass: z.number().min(0).max(1000),
  massAt: iso,
  firstAt: iso,
  wins: z.number().int().min(0),
  deepBacked: z.boolean(),
  members: z.array(stageMemberSchema).max(STAGE_MAX_MEMBERS),
}).strict()

export const stageCycleSchema = z.object({
  cycle: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}$/),
  winnerId: z.string().nullable(),
  top: z.array(z.string()).max(4),
  at: iso,
}).strict()

export const stageFocusSchema = z.object({
  coalitionId: z.string(),
  text: z.string().min(1).max(STAGE_TEXT_MAX),
  since: iso,
  londonDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict()

export const stageSurpriseSchema = z.object({
  at: iso,
  s: unit,
  kind: z.string().min(1).max(40),
  tier: stageTierSchema,
}).strict()

export const kairosStageStateSchema = z.object({
  v: z.literal(1),
  updatedAt: iso.nullable(),
  coalitions: z.array(stageCoalitionSchema).max(STAGE_MAX_COALITIONS),
  cycles: z.array(stageCycleSchema).max(STAGE_MAX_CYCLES),
  focus: stageFocusSchema.nullable(),
  surprise: z.array(stageSurpriseSchema).max(STAGE_MAX_SURPRISE),
  postedJobs: z.array(z.string().min(1).max(100)).max(STAGE_MAX_POSTED_JOBS),
  ambientSeen: z.array(z.string().min(1).max(200)).max(STAGE_MAX_AMBIENT_SEEN),
}).strict().refine((s) => JSON.stringify(s).length <= STAGE_MAX_BYTES, `kairosStage exceeds ${STAGE_MAX_BYTES} bytes`)

export type StageTier = z.infer<typeof stageTierSchema>
export type StageSource = z.infer<typeof stageSourceSchema>
export type StageMember = z.infer<typeof stageMemberSchema>
export type StageCoalition = z.infer<typeof stageCoalitionSchema>
export type StageCycle = z.infer<typeof stageCycleSchema>
export type StageFocus = z.infer<typeof stageFocusSchema>
export type KairosStageState = z.infer<typeof kairosStageStateSchema>

// Read surfaces (MCP + REST). `pool` is a '0'|'1' string on purpose: coercing
// it to a boolean would read the query string "0" as true.
export const getKairosStageSchema = z.object({
  format: z.enum(['json', 'markdown']).default('json'),
  pool: z.enum(['0', '1']).default('0'),
})

export type GetKairosStageInput = z.infer<typeof getKairosStageSchema>
