import { findOpenKairosPredictionBySeq } from '@/lib/data/kairos-predictions'
import type { PredictionVerdict } from '@/lib/data/validators/kairos-predictions'
import { predictionsEnabled } from './flag'
import { settleKairosPredictionByOwner } from './verdict'

// Owner prediction verdicts from the operator's Telegram chat (spec B):
//   "R3 right" → right      "R3 wrong" → wrong      "void R3" → void
// A message is a command only when every non-empty line is one; anything
// else falls through to chat. Settles go through settleKairosPredictionByOwner
// — the only way a prediction settles from Telegram. Not wired into the
// webhook in this wave.

export interface PredictionCommand { seq: number; verdict: PredictionVerdict }

const VERDICT_RE = /^r(\d{1,4})\s+(right|wrong)$/i
const VOID_RE = /^void\s+r(\d{1,4})$/i

function parseLine(line: string): PredictionCommand | null {
  const s = line.trim().replace(/[.!]+$/, '').trim()
  let m = VERDICT_RE.exec(s)
  if (m) return { seq: Number(m[1]), verdict: m[2]!.toLowerCase() as 'right' | 'wrong' }
  m = VOID_RE.exec(s)
  if (m) return { seq: Number(m[1]), verdict: 'void' }
  return null
}

export function parsePredictionCommands(body: string): PredictionCommand[] | null {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) return null
  const out: PredictionCommand[] = []
  for (const line of lines) {
    const cmd = parseLine(line)
    if (!cmd) return null
    out.push(cmd)
  }
  return out
}

async function runCommand(userId: string, cmd: PredictionCommand, now: Date): Promise<string> {
  const label = `R${cmd.seq}`
  const prediction = await findOpenKairosPredictionBySeq(userId, cmd.seq)
  if (!prediction) return `${label}: no open prediction`
  const res = await settleKairosPredictionByOwner(userId, prediction.id, cmd.verdict, { via: 'telegram' }, now)
  if (res.ok) return `✓ ${label} ${cmd.verdict}`
  return res.reason === 'already_settled' ? `${label}: already settled` : `${label}: no open prediction`
}

// True when the text was prediction commands (handled and acked in one line).
// Flag off = never a command (falls through to chat).
export async function routePredictionCommands(
  userId: string,
  body: string,
  send: (text: string) => Promise<unknown>,
  now: Date = new Date(),
): Promise<boolean> {
  if (!predictionsEnabled()) return false
  const commands = parsePredictionCommands(body)
  if (!commands) return false
  const acks: string[] = []
  for (const cmd of commands) {
    try {
      acks.push(await runCommand(userId, cmd, now))
    } catch (err) {
      console.error('[kairos:prediction-commands] command failed', err)
      acks.push(`R${cmd.seq}: could not update — try again`)
    }
  }
  await send(acks.join(' · '))
  return true
}
