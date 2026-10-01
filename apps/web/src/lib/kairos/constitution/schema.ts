import { z } from 'zod'

// Constitution shapes (docs/kairos/34 §2). Pure — no DB, no model calls.
// A constitution is a numbered list of principles, each carrying its REASON
// (reasons over rules). It lives in sourceMetadata.constitution on two kinds
// of row:
//   proposal  (type 'inbound', kind 'constitution_amendment', status 'pending')
//             { principles, basedOnVersion, rationale }
//   version   (type/streamClass 'constitution', one live row per user)
//             { version, principles, acceptedFrom }
// An amendment always carries the COMPLETE amended principle list; accepting
// it replaces the live version wholesale (the previous one is superseded).

export const CONSTITUTION_PROPOSAL_KIND = 'constitution_amendment'
export const CONSTITUTION_TYPE = 'constitution'
export const CONSTITUTION_OP_STEP = 'constitution'

export const MAX_PRINCIPLES = 30
export const PRINCIPLE_TEXT_MAX = 500
export const PRINCIPLE_REASON_MAX = 800
export const RATIONALE_MAX = 2000

export const principleSchema = z.object({
  n: z.number().int().min(1),
  text: z.string().trim().min(1).max(PRINCIPLE_TEXT_MAX),
  reason: z.string().trim().min(1).max(PRINCIPLE_REASON_MAX),
})

export type Principle = z.infer<typeof principleSchema>

export interface PrincipleInput {
  text: string
  reason: string
}

export const constitutionProposalMetaSchema = z.object({
  principles: z.array(principleSchema).min(1).max(MAX_PRINCIPLES),
  basedOnVersion: z.number().int().min(0),
  rationale: z.string().max(RATIONALE_MAX),
})

export type ConstitutionProposalMeta = z.infer<typeof constitutionProposalMetaSchema>

export const constitutionVersionMetaSchema = z.object({
  version: z.number().int().min(1),
  principles: z.array(principleSchema).min(1).max(MAX_PRINCIPLES),
  acceptedFrom: z.string().min(1),
})

export type ConstitutionVersionMeta = z.infer<typeof constitutionVersionMetaSchema>

export interface LiveConstitution {
  id: string
  version: number
  principles: Principle[]
  acceptedFrom: string
  acceptedAt: Date
}

// Server-side numbering: callers and models never choose `n`.
export function numberPrinciples(input: readonly PrincipleInput[]): Principle[] {
  return input.map((p, i) => ({ n: i + 1, text: p.text.trim(), reason: p.reason.trim() }))
}

function record(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

export function readProposalMeta(sourceMetadata: unknown): ConstitutionProposalMeta | null {
  const parsed = constitutionProposalMetaSchema.safeParse(record(sourceMetadata)?.constitution)
  return parsed.success ? parsed.data : null
}

export function readVersionMeta(sourceMetadata: unknown): ConstitutionVersionMeta | null {
  const parsed = constitutionVersionMetaSchema.safeParse(record(sourceMetadata)?.constitution)
  return parsed.success ? parsed.data : null
}

export function toLiveConstitution(row: { id: string; sourceMetadata: unknown; createdAt: Date }): LiveConstitution | null {
  const meta = readVersionMeta(row.sourceMetadata)
  if (!meta) return null
  return { id: row.id, version: meta.version, principles: meta.principles, acceptedFrom: meta.acceptedFrom, acceptedAt: row.createdAt }
}

export function renderPrinciplesMarkdown(principles: readonly Principle[]): string {
  return principles.map((p) => `${p.n}. **${p.text}**\n   _Because:_ ${p.reason}`).join('\n')
}

export function renderConstitutionMarkdown(version: number, principles: readonly Principle[]): string {
  return [`# Constitution v${version}`, '', renderPrinciplesMarkdown(principles)].join('\n')
}

export function renderProposalMarkdown(meta: ConstitutionProposalMeta): string {
  const target = meta.basedOnVersion + 1
  const head = meta.basedOnVersion === 0
    ? `# Constitution draft (v${target})`
    : `# Constitution amendment (v${meta.basedOnVersion} → v${target})`
  const parts = [head, '']
  if (meta.rationale.trim()) parts.push(`**Why:** ${meta.rationale.trim()}`, '')
  parts.push(renderPrinciplesMarkdown(meta.principles))
  parts.push('', '_Accepting this proposal replaces the live constitution with exactly these principles._')
  return parts.join('\n')
}

export function proposalTitle(basedOnVersion: number): string {
  return basedOnVersion === 0
    ? 'Constitution draft v1'
    : `Constitution amendment v${basedOnVersion} → v${basedOnVersion + 1}`
}
