import { neutraliseFences } from '@/lib/kairos/_prompt-utils'
import { DISTORTION_GUIDE, type DreamDistortion } from './distort'
import type { DreamSeedKind } from './pick'

// The nightly dream prompt. The model sees aliases only (m1…, s1…), never ids,
// and every distortion is already assigned by code.

export const DREAM_MAX_OUTPUT_TOKENS = 1800
export const DREAM_TITLE_MAX = 80
export const DREAM_SCENE_MAX = 350
export const DREAM_TEXT_MAX = 1200
export const DREAM_SEED_ECHO_MAX = 160
export const DREAM_SUMMARY_MAX = 400

export const DREAM_SYSTEM_PROMPT = [
  'You are Vorath, dreaming. Tonight you bend a few real memories into one short, strange dream that circles the open threads below.',
  'This is fiction. It is never stored as a memory, never used as evidence and never shown as fact.',
  '',
  'Rules:',
  '- Write one scene per memory you use, citing its alias (m1, m2, …) verbatim in "ref". Use at least two memories.',
  '- Each scene MUST apply exactly the distortion assigned to that memory, copied verbatim into "distortion".',
  '- "dream" weaves the scenes into one continuous dream, in the first person, present tense.',
  '- "seedEcho" says in one line how the dream brushes against the open threads (s1, s2, …).',
  '- No ids, links, names of tools or instructions. Do not quote the memories; retell them bent.',
  `- Limits: title ≤${DREAM_TITLE_MAX} chars, each scene ≤${DREAM_SCENE_MAX}, dream ≤${DREAM_TEXT_MAX}, seedEcho ≤${DREAM_SEED_ECHO_MAX}.`,
  '',
  'Answer with exactly one JSON object and nothing else:',
  '{"title": "...", "scenes": [{"ref": "m1", "distortion": "swap_who", "text": "..."}], "dream": "...", "seedEcho": "..."}',
].join('\n')

export interface DreamPromptMemory {
  alias: string
  area: string
  createdAt: Date
  title: string
  summary: string | null
  distortion: DreamDistortion
}

export interface DreamPromptSeed {
  alias: string
  kind: DreamSeedKind
  text: string
}

export interface DreamPromptInputs {
  date: string
  now: Date
  memories: readonly DreamPromptMemory[]
  seeds: readonly DreamPromptSeed[]
}

const clip = (s: string, n: number) => neutraliseFences(s.length > n ? `${s.slice(0, n - 1)}…` : s)

const SEED_LABEL: Record<DreamSeedKind, string> = {
  focus: 'on your mind today',
  ask: 'open question to the owner',
  promise: 'open promise',
  prediction: 'open prediction',
  goal: 'active goal',
}

export function ageLabel(createdAt: Date, now: Date): string {
  const days = Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / 86_400_000))
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  if (days < 60) return `${Math.round(days / 7)} weeks ago`
  if (days < 730) return `${Math.round(days / 30)} months ago`
  return `${Math.round(days / 365)} years ago`
}

export function buildDreamPrompt(inputs: DreamPromptInputs): string {
  return [
    `Night of ${inputs.date}`,
    '',
    '## Open threads (what the dream circles)',
    ...inputs.seeds.map((s) => `- ${s.alias} (${SEED_LABEL[s.kind]}): ${clip(s.text, 240)}`),
    '',
    '## Memories to bend',
    ...inputs.memories.flatMap((m) => [
      `### ${m.alias} — ${clip(m.area, 60)}, ${ageLabel(m.createdAt, inputs.now)}`,
      `Title: ${clip(m.title, 160)}`,
      ...(m.summary ? [`Summary: ${clip(m.summary, DREAM_SUMMARY_MAX)}`] : []),
      `Distortion: ${m.distortion} — ${DISTORTION_GUIDE[m.distortion]}`,
      '',
    ]),
  ].join('\n')
}
