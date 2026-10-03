import { findOpenKairosAgendaBySeq } from '@/lib/data/kairos-agenda'
import { cancelAgendaItem } from './cancel'

// Owner agenda commands from the operator's Telegram chat: "cancel A3".
// A message is a command only when every non-empty line is one; anything
// else falls through to the next router / chat. Wave 2 wires this into the
// Telegram webhook after the promise router.

export type AgendaCommand = { kind: 'cancel'; seq: number }

const CANCEL_RE = /^cancel\s+a(\d{1,4})$/i

export function parseAgendaCommands(body: string): AgendaCommand[] | null {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) return null
  const out: AgendaCommand[] = []
  for (const line of lines) {
    const m = CANCEL_RE.exec(line.replace(/[.!]+$/, '').trim())
    if (!m) return null
    out.push({ kind: 'cancel', seq: Number(m[1]) })
  }
  return out
}

async function runCommand(userId: string, cmd: AgendaCommand, now: Date): Promise<string> {
  const label = `A${cmd.seq}`
  const item = await findOpenKairosAgendaBySeq(userId, cmd.seq)
  if (!item) return `${label}: not on Horae`
  const res = await cancelAgendaItem(userId, item.id, { kind: 'owner', via: 'telegram' }, now)
  if (res.ok) return `✓ ${label} cancelled`
  return res.reason === 'already_closed' ? `${label}: already closed` : `${label}: not on Horae`
}

// True when the text was agenda commands (handled and acked in one line).
export async function routeAgendaCommands(
  userId: string,
  body: string,
  send: (text: string) => Promise<unknown>,
  now: Date = new Date(),
): Promise<boolean> {
  const commands = parseAgendaCommands(body)
  if (!commands) return false
  const acks: string[] = []
  for (const cmd of commands) {
    try {
      acks.push(await runCommand(userId, cmd, now))
    } catch (err) {
      console.error('[kairos:agenda-commands] command failed', err)
      acks.push(`A${cmd.seq}: could not cancel — try again`)
    }
  }
  await send(acks.join(' · '))
  return true
}
