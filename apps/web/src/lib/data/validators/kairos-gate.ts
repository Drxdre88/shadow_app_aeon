import { z } from 'zod'

// Kairos gate (wave 4 lane A). State lives in the server-owned `kairosGate`
// key of user_preferences.preferences, written only through mutateKairosGate.
// The receptivity map is timing-only: it never reaches a Kairos prompt.
// The read schema is shared by the get_kairos_gate MCP tool and
// GET /api/v1/kairos/gate (kairos-gate-parity.test.ts).

export const GATE_LOG_MAX = 50
export const GATE_HALF_LIFE_DAYS = 28
export const GATE_MAX_RECORD_KEYS = 32

const iso = z.string().min(1).max(40)
const count = z.number().min(0)

export const gateCellSchema = z.object({
  n: count,
  replied: count,
  latSum: count,
  latN: count,
  warmSum: z.number(),
  warmN: count,
}).strict()

const cellRecord = z.record(z.string().max(40), gateCellSchema).refine((r) => Object.keys(r).length <= GATE_MAX_RECORD_KEYS, 'too many keys')

export const gateReceptivitySchema = z.object({
  foldedThrough: iso.nullable(),
  updatedAt: iso.nullable(),
  global: gateCellSchema,
  hour: cellRecord,
  dow: cellRecord,
  kind: cellRecord,
  source: cellRecord,
  breakType: cellRecord,
  replyChannel: z.record(z.string().max(40), count).refine((r) => Object.keys(r).length <= GATE_MAX_RECORD_KEYS, 'too many keys'),
}).strict()

export const gateLogEntrySchema = z.object({
  at: iso,
  memoryId: z.string().max(100).nullable(),
  mode: z.enum(['off', 'observe', 'on']),
  decision: z.enum(['send', 'hold', 'release']),
  reason: z.string().min(1).max(40),
  cold: z.boolean().optional(),
}).strict()

export const kairosGateStateSchema = z.object({
  v: z.literal(1),
  receptivity: gateReceptivitySchema,
  log: z.array(gateLogEntrySchema).max(GATE_LOG_MAX),
}).strict()

export type GateCell = z.infer<typeof gateCellSchema>
export type GateReceptivity = z.infer<typeof gateReceptivitySchema>
export type GateLogEntry = z.infer<typeof gateLogEntrySchema>
export type KairosGateState = z.infer<typeof kairosGateStateSchema>

// ── Read view (MCP get_kairos_gate ≡ GET /api/v1/kairos/gate) ─────────────

export const gateCellViewSchema = z.object({
  n: z.number(),
  replyRate: z.number().nullable(),
  avgLatencyMin: z.number().nullable(),
  warmth: z.number().nullable(),
})

export const gateHeldViewSchema = z.object({
  id: z.string(),
  title: z.string(),
  heldAt: z.string().nullable(),
  until: z.string().nullable(),
  reason: z.string().nullable(),
})

export const kairosGateViewSchema = z.object({
  mode: z.enum(['off', 'observe', 'on']),
  receptivityMode: z.enum(['off', 'observe', 'on']),
  limits: z.object({ maxHoldMin: z.number(), quietMin: z.number(), chatQuietMin: z.number(), awayMin: z.number() }),
  held: z.array(gateHeldViewSchema),
  receptivity: z.object({
    foldedThrough: z.string().nullable(),
    updatedAt: z.string().nullable(),
    global: gateCellViewSchema,
    hours: z.array(gateCellViewSchema.extend({ hour: z.number().int(), cold: z.boolean() })),
    dow: z.record(z.string(), gateCellViewSchema),
    kind: z.record(z.string(), gateCellViewSchema),
    source: z.record(z.string(), gateCellViewSchema),
    breakType: z.record(z.string(), gateCellViewSchema),
    replyChannel: z.record(z.string(), z.number()),
  }),
  log: z.array(gateLogEntrySchema),
})

export type GateCellView = z.infer<typeof gateCellViewSchema>
export type GateHeldView = z.infer<typeof gateHeldViewSchema>
export type KairosGateView = z.infer<typeof kairosGateViewSchema>

export const getKairosGateSchema = z.object({
  format: z.enum(['json', 'markdown']).default('json'),
})

export type GetKairosGateInput = z.infer<typeof getKairosGateSchema>
