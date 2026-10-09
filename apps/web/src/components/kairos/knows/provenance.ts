import { originKindOf, type OriginKind } from '@/lib/kairos/origin'
import { readBelief } from '@/lib/kairos/beliefs/types'
import { SENSITIVE_TOPIC_LABELS } from '@/lib/kairos/sensitive/lexicon'
import { sensitiveTopicsOf } from '@/lib/kairos/sensitive/meta'
import { MIND_NAME } from '@/lib/kairos/identity'

// Plain-English provenance for the "What Vorath knows" surfaces. Pure: every
// function reads a memory row's own fields, no fetching.

export type ProvenanceRow = {
  type: string
  streamClass?: string | null
  source: string
  sourceMetadata: unknown
  confidence?: number | null
  standing?: number | null
  projectId?: string | null
  taskId?: string | null
  createdAt: Date | string
}

type Meta = Record<string, unknown>
const meta = (v: unknown): Meta => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Meta) : {})
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

export const ORIGIN_WORDS: Record<OriginKind, string> = {
  operator: 'You',
  activity: 'Your own work',
  agent: 'An AI agent working for you',
  kairos: `${MIND_NAME}\u2019s own thinking`,
  external: 'Outside content',
}

export function originWords(row: Pick<ProvenanceRow, 'source' | 'sourceMetadata'>): string {
  return ORIGIN_WORDS[originKindOf(row)]
}

export type SourceRef = { label: string; href?: string }

// Where the row came from, as specifically as its metadata allows.
export function sourceRef(row: ProvenanceRow): SourceRef {
  const m = meta(row.sourceMetadata)
  const voice = meta(m.voiceNote)
  if (row.source === 'voice' || Object.keys(voice).length > 0) return { label: 'a voice note you dictated' }
  if (Object.keys(meta(m.chatDistill)).length > 0) {
    const date = str(meta(m.chatDistill).date)
    return { label: date ? `your chat with ${MIND_NAME} on ${date}` : `a chat with ${MIND_NAME}` }
  }
  const repo = str(m.repo)
  const client = str(m.client) ?? (['claude', 'codex', 'copilot'].includes(row.source) ? row.source : null)
  if (str(m.sessionId) || repo) {
    const who = client ? `a ${client} coding session` : 'a coding session'
    return { label: repo ? `${who} in ${repo}` : who }
  }
  const kind = str(m.kind)
  if (row.projectId && (row.taskId || kind === 'board_card_done')) return { label: 'a card on your board', href: `/project/${row.projectId}` }
  if (row.projectId && (kind === 'board_day' || kind === 'board_week')) return { label: 'your board activity', href: `/project/${row.projectId}` }
  if (row.projectId) return { label: 'one of your projects', href: `/project/${row.projectId}` }
  if (readBelief(row.sourceMetadata)) return { label: 'the notes listed below' }
  switch (row.source) {
    case 'manual': return { label: 'a note you wrote in Aeon' }
    case 'webhook': return { label: 'an outside service' }
    case 'import': return { label: 'an import' }
    case 'cron':
    case 'system': return { label: `${MIND_NAME}\u2019s scheduled thinking` }
    case 'hook': return { label: 'a coding session' }
    default: return { label: row.source }
  }
}

export function standingWords(row: Pick<ProvenanceRow, 'standing' | 'confidence' | 'sourceMetadata'>): string {
  const belief = readBelief(row.sourceMetadata)
  const c = belief?.confidence ?? row.confidence ?? null
  const s = row.standing ?? null
  const value = s ?? c
  if (value == null) return 'not weighed yet'
  if (value >= 0.75) return 'held firmly'
  if (value >= 0.5) return 'fairly sure'
  if (value >= 0.3) return 'tentative'
  return 'weak \u2014 worth checking'
}

function kindNoun(row: ProvenanceRow): string {
  if (row.type === 'belief' || row.streamClass === 'belief') return 'believe this'
  if (row.type === 'fact') return 'know this'
  return 'remember this'
}

function shortDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''
}

// One line: "I believe this because an AI agent working for you wrote it, from
// a claude coding session in aeon (5 Oct 2026)."
export function whyLine(row: ProvenanceRow): string {
  const belief = readBelief(row.sourceMetadata)
  const when = shortDate(row.createdAt)
  const tail = when ? ` (${when})` : ''
  if (belief) {
    const n = belief.provenance.length
    const basis = belief.sourceType === 'operator' ? 'your own words' : belief.sourceType === 'tool' ? 'records of your work' : 'my own reading'
    return `I ${kindNoun(row)} from ${n === 1 ? '1 note' : `${n} notes`}, mostly ${basis}${tail}.`
  }
  const who = originWords(row)
  const verb = who === 'You' ? 'told me' : 'wrote it'
  return `I ${kindNoun(row)} because ${lowerFirst(who)} ${verb}, from ${sourceRef(row).label}${tail}.`
}

function lowerFirst(s: string): string {
  return s === 'You' ? 'you' : s.startsWith(MIND_NAME) ? s : s.charAt(0).toLowerCase() + s.slice(1)
}

export function sensitiveWords(sourceMetadata: unknown): string | null {
  const topics = sensitiveTopicsOf(sourceMetadata)
  return topics.length ? topics.map((t) => SENSITIVE_TOPIC_LABELS[t] ?? t).join(', ') : null
}

export function recheckWords(sourceMetadata: unknown): string | null {
  const b = readBelief(sourceMetadata)
  if (!b?.recheck) return null
  const n = b.recheck.lostSources.length
  return `${n === 1 ? 'One note' : `${n} notes`} it rested on changed or went away.`
}

const OP_WORDS: Record<string, string> = {
  score: 'weighed', promote: 'promoted', decay: 'faded', reject: 'set aside', merge: 'merged with a repeat',
  concept_create: 'grouped into a concept', concept_update: 'concept updated', feedback: 'feedback recorded',
  revert: 'a change was undone', recheck: 'flagged for re-check', retire: 'retired',
  archetype_update: 'theme revised',
}

export function opWords(op: { op: string; step: string }): string {
  const base = OP_WORDS[op.op] ?? op.op
  if (op.step === 'owner') {
    if (op.op === 'reject') return 'You marked it wrong'
    if (op.op === 'feedback') return 'You confirmed it'
  }
  return `${MIND_NAME}: ${base}`
}
