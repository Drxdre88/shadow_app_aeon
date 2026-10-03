import { z } from 'zod'

// Horae — Kairos's own agenda of dated check-ins (A1, A2 …). Stored as the
// server-owned `kairosAgenda` key in user_preferences.preferences. Items are
// booked only by the server (goal approval, reflect follow-ups, one agenda_due
// rebook); the owner can cancel. The list schema is shared verbatim by the
// list_kairos_agenda MCP tool and GET /api/v1/kairos/agenda.

export const MAX_OPEN_AGENDA = 8
export const MAX_CLOSED_AGENDA = 60
export const MAX_AGENDA_PER_JOB = 2
export const MAX_AGENDA_PER_DAY = 3
export const AGENDA_WHAT_MIN_CHARS = 10
export const AGENDA_WHAT_MAX_CHARS = 200
export const AGENDA_BASIS_MAX = 5

export const agendaDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
  .refine((s) => {
    const d = new Date(`${s}T12:00:00.000Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
  }, 'date is not a real calendar date')

export const agendaSlotSchema = z.enum(['morning', 'afternoon'])

export const agendaSourceSchema = z.object({
  kind: z.enum(['reflect', 'goal_checkin', 'agenda_due']),
  jobId: z.string().min(1).max(100).optional(),
  goalId: z.string().min(1).max(100).optional(),
}).strict()

export const agendaResultSchema = z.object({
  kind: z.enum(['thought', 'ask', 'message', 'nothing']),
  memoryId: z.string().min(1).max(100).optional(),
  downgraded: z.literal(true).optional(),
}).strict()

export const agendaCancelledBySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('owner'), via: z.enum(['session', 'telegram']) }).strict(),
  z.object({ kind: z.literal('rule'), reason: z.enum(['goal_closed', 'expired']) }).strict(),
])

export const agendaStatusSchema = z.enum(['open', 'fired', 'done', 'missed', 'cancelled'])

export const kairosAgendaItemSchema = z.object({
  id: z.string().uuid(),
  seq: z.number().int().positive(),
  what: z.string().min(1).max(AGENDA_WHAT_MAX_CHARS),
  dueAt: z.string().min(1),
  createdAt: z.string().min(1),
  source: agendaSourceSchema,
  basisIds: z.array(z.string().min(1).max(100)).max(AGENDA_BASIS_MAX),
  dominionId: z.string().nullable(),
  goalId: z.string().min(1).max(100).optional(),
  rebookDepth: z.union([z.literal(0), z.literal(1)]),
  status: agendaStatusSchema,
  // Set when a pass planned the agenda_due job (claim-once).
  firedAt: z.string().optional(),
  firedJobId: z.string().min(1).max(100).optional(),
  closedAt: z.string().optional(),
  result: agendaResultSchema.optional(),
  cancelledBy: agendaCancelledBySchema.optional(),
}).strict()

export const kairosAgendaStateSchema = z.object({
  v: z.literal(1),
  nextSeq: z.number().int().positive(),
  open: z.array(kairosAgendaItemSchema).max(MAX_OPEN_AGENDA),
  closed: z.array(kairosAgendaItemSchema).max(MAX_CLOSED_AGENDA),
}).strict()

export type AgendaSlot = z.infer<typeof agendaSlotSchema>
export type AgendaSource = z.infer<typeof agendaSourceSchema>
export type AgendaResult = z.infer<typeof agendaResultSchema>
export type AgendaCancelledBy = z.infer<typeof agendaCancelledBySchema>
export type AgendaStatus = z.infer<typeof agendaStatusSchema>
export type KairosAgendaItem = z.infer<typeof kairosAgendaItemSchema>
export type KairosAgendaState = z.infer<typeof kairosAgendaStateSchema>

// One item as the server books it (goal check-in, reflect follow-up, rebook).
// Strict: status, seq, dueAt time and rebook depth are server-decided.
export const agendaProposalSchema = z.object({
  what: z.string().trim().min(AGENDA_WHAT_MIN_CHARS).max(AGENDA_WHAT_MAX_CHARS),
  date: agendaDateSchema,
  slot: agendaSlotSchema,
  basisIds: z.array(z.string().min(1).max(100)).max(AGENDA_BASIS_MAX).optional(),
  dominionId: z.string().min(1).max(100).nullable().optional(),
  goalId: z.string().min(1).max(100).optional(),
}).strict()

export type AgendaProposal = z.infer<typeof agendaProposalSchema>

export const listKairosAgendaSchema = z.object({
  scope: z.enum(['open', 'all']).default('open'),
})

export type ListKairosAgendaInput = z.infer<typeof listKairosAgendaSchema>

// Owner-only (server action under requireAuth, Telegram operator chat).
export const ownerAgendaItemIdSchema = z.string().uuid()
