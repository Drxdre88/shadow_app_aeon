import { z } from 'zod'

// Kairos owner model (wave 4 lane B): lasting traits vs expiring states, kept
// in the server-owned `kairosOwnerModel` preference key. No MCP/REST writer.

export const OWNER_MODEL_MAX_ITEMS = 40
export const OWNER_MODEL_MAX_VETOES = 40
export const OWNER_MODEL_MAX_CARDS = 8
export const OWNER_MODEL_MAX_CORRECTIONS = 50
export const OWNER_ITEM_TEXT_MAX = 160
export const OWNER_TEXT_MAX = 500
export const OWNER_MAX_SUPPORT_DAYS = 10
export const OWNER_MAX_CONFIRMATIONS = 6

export const ownerItemKindSchema = z.enum(['trait', 'state'])
export const ownerItemStatusSchema = z.enum(['candidate', 'held', 'ended', 'expired', 'retired'])
export const ownerConfirmViaSchema = z.enum(['extract', 'telegram', 'session'])
export const ownerRetiredReasonSchema = z.enum(['owner_over', 'owner_wrong', 'expired', 'ended', 'superseded'])
export const ownerCorrectionActionSchema = z.enum(['still', 'yes', 'over', 'wrong', 'drop', 'text'])

export const ownerConfirmationSchema = z.object({
  at: z.string(),
  via: ownerConfirmViaSchema,
  memoryIds: z.array(z.string()).max(12),
  anchored: z.boolean(),
})

export const ownerItemSchema = z.object({
  id: z.string().min(1),
  seq: z.number().int().min(1),
  kind: ownerItemKindSchema,
  text: z.string().min(1).max(OWNER_ITEM_TEXT_MAX),
  domain: z.string().max(120),
  status: ownerItemStatusSchema,
  firstSeenAt: z.string(),
  lastConfirmedAt: z.string(),
  expiresAt: z.string().optional(),
  supportDays: z.array(z.string()).max(OWNER_MAX_SUPPORT_DAYS),
  confirmations: z.array(ownerConfirmationSchema).max(OWNER_MAX_CONFIRMATIONS),
  ownerText: z.string().max(OWNER_TEXT_MAX).optional(),
  retiredReason: ownerRetiredReasonSchema.optional(),
  closedAt: z.string().optional(),
})

export const ownerVetoSchema = z.object({
  norm: z.string().min(1),
  kind: ownerItemKindSchema,
  until: z.string(),
})

export const ownerCardRecordSchema = z.object({
  isoWeek: z.string().min(1),
  at: z.string(),
  status: z.enum(['sent', 'skipped_empty', 'throttled']),
  memoryId: z.string().optional(),
  seqs: z.array(z.number().int()),
  acted: z.array(z.number().int()).optional(),
})

export const ownerCorrectionRecordSchema = z.object({
  at: z.string(),
  seq: z.number().int(),
  action: ownerCorrectionActionSchema,
  via: z.enum(['telegram', 'session']),
  text: z.string().max(OWNER_TEXT_MAX).optional(),
  updateId: z.number().int().optional(),
})

export const kairosOwnerModelSchema = z.object({
  v: z.literal(1),
  nextSeq: z.number().int().min(1),
  items: z.array(ownerItemSchema).max(OWNER_MODEL_MAX_ITEMS),
  vetoes: z.array(ownerVetoSchema).max(OWNER_MODEL_MAX_VETOES),
  cards: z.array(ownerCardRecordSchema).max(OWNER_MODEL_MAX_CARDS),
  corrections: z.array(ownerCorrectionRecordSchema).max(OWNER_MODEL_MAX_CORRECTIONS),
  lastExtractAt: z.string().optional(),
})

export type OwnerItemKind = z.infer<typeof ownerItemKindSchema>
export type OwnerItemStatus = z.infer<typeof ownerItemStatusSchema>
export type OwnerConfirmation = z.infer<typeof ownerConfirmationSchema>
export type OwnerItem = z.infer<typeof ownerItemSchema>
export type OwnerVeto = z.infer<typeof ownerVetoSchema>
export type OwnerCardRecord = z.infer<typeof ownerCardRecordSchema>
export type OwnerCorrectionRecord = z.infer<typeof ownerCorrectionRecordSchema>
export type OwnerCorrectionAction = z.infer<typeof ownerCorrectionActionSchema>
export type KairosOwnerModel = z.infer<typeof kairosOwnerModelSchema>

// ── read surface (MCP get_kairos_owner_model ≡ GET /api/v1/kairos/owner-model) ──

export const getKairosOwnerModelSchema = z.object({
  format: z.enum(['json', 'markdown']).default('json'),
})

export type GetKairosOwnerModelInput = z.infer<typeof getKairosOwnerModelSchema>

export interface OwnerItemView {
  seq: number
  kind: OwnerItemKind
  text: string
  domain: string
  status: OwnerItemStatus
  firstSeenAt: string
  lastConfirmedAt: string
  expiresAt: string | null
  confirmations: number
  ownerWorded: boolean
  longRunning: boolean
}

export interface KairosOwnerModelView {
  live: OwnerItemView[]
  candidates: OwnerItemView[]
  expired: OwnerItemView[]
  closed: OwnerItemView[]
  lastCard: { isoWeek: string; at: string; status: OwnerCardRecord['status']; items: number } | null
  corrections: { last30d: number; byAction: Record<string, number> }
  vetoes: number
}

// ── web correction (session only) ──────────────────────────────────────────

export const ownerItemCorrectionSchema = z.object({
  itemId: z.string().min(1).max(64),
  action: z.enum(['still', 'over', 'wrong', 'text']),
  text: z.string().trim().min(3).max(OWNER_TEXT_MAX).optional(),
}).refine((v) => v.action !== 'text' || !!v.text, 'text is required for a correction')

export type OwnerItemCorrectionInput = z.infer<typeof ownerItemCorrectionSchema>
