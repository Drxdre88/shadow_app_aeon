import { setProposalTelegram } from '@/lib/data/proposal-decision'
import { countPendingVoiceSamples, insertVoiceSampleProposal, VOICE_SAMPLE_KIND } from '@/lib/data/voice-samples'
import { sendKairosProposal } from '@/lib/kairos/telegram'
import type { CharacterSource } from './sample'

// Voice samples (character check, Lane B): at most one proposal a week, only
// while fewer than two are pending. The owner decides through the one
// proposal-decision registry (inbox / Telegram Approve · Veto; agents
// refused; 14-day expiry). Approved samples become the rater's unlabelled
// anchors — measurement only, never part of a Kairos prompt. Kairos picks
// them, so they are biased; the owner's veto is the safeguard.

export { VOICE_SAMPLE_KIND }
export const VOICE_SAMPLE_TTL_DAYS = 14
export const MAX_PENDING_VOICE_SAMPLES = 2
export const MAX_VOICE_ANCHORS = 6

export const voiceSampleKey = (isoWeek: string) => `voice_sample:${isoWeek}`

const SOURCE_PHRASE: Readonly<Record<CharacterSource, string>> = {
  reflection: 'one of his reflections',
  chat: 'a chat reply',
  daily: 'a 06:00 message',
  aether: 'his self-model',
  review: 'a weekly review',
  exemplar: 'a voice sample',
}

export const VOICE_SAMPLE_TITLE = 'Voice sample — does this sound like him?'

export function renderVoiceSampleBody(text: string, source: CharacterSource, isoWeek: string): string {
  return [
    text.split('\n').map((l) => `> ${l}`).join('\n'),
    '',
    `From ${SOURCE_PHRASE[source]} (${isoWeek}). The weekly character check rated it the plainest, most grounded text of the week.`,
    'Approve to keep it as a reference for how he should sound; veto if it doesn’t ring true. It is only used to calibrate the check — never fed into his prompts.',
  ].join('\n')
}

export interface VoiceSampleProposalInput {
  text: string
  source: CharacterSource
  isoWeek: string
  jobId: string
}

// Telegram is the operator's channel only; best-effort.
async function announce(userId: string, id: string, body: string, expiresAt: string, now: Date): Promise<void> {
  if (!userId || userId !== process.env.KAIROS_OPERATOR_USER_ID?.trim()) return
  try {
    const sent = await sendKairosProposal({ proposalId: id, title: VOICE_SAMPLE_TITLE, body, expiresAt })
    if (sent) await setProposalTelegram(userId, id, sent, now)
  } catch (err) {
    console.warn('[kairos:voice-sample] Telegram announce failed', err)
  }
}

// Null when skipped (two already pending). Idempotent per ISO week.
export async function proposeVoiceSample(userId: string, input: VoiceSampleProposalInput, now: Date): Promise<string | null> {
  if (input.source === 'exemplar') return null
  if ((await countPendingVoiceSamples(userId, now)) >= MAX_PENDING_VOICE_SAMPLES) return null
  const expiresAt = new Date(now.getTime() + VOICE_SAMPLE_TTL_DAYS * 86_400_000).toISOString()
  const body = renderVoiceSampleBody(input.text, input.source, input.isoWeek)
  const res = await insertVoiceSampleProposal(userId, {
    externalKey: voiceSampleKey(input.isoWeek),
    title: VOICE_SAMPLE_TITLE,
    bodyMd: body,
    text: input.text,
    source: input.source,
    isoWeek: input.isoWeek,
    expiresAt,
    jobId: input.jobId,
    now,
  })
  if (res.written) await announce(userId, res.id, body, expiresAt, now)
  return res.id
}
