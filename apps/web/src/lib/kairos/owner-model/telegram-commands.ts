import type { OwnerCorrectionAction } from '@/lib/data/validators/kairos-owner-model'
import { correctOwnerItem } from './correct'
import { ownerModelMode } from './flag'
import { findBySeq, isActionable } from './status'

// Owner corrections from the operator's Telegram chat (spec_B §3.6):
//   "C1 still" / "C1 yes" / "C1 right"  → still (keep; a "yes" on a
//                                          long-running state makes it a trait)
//   "C1 over" / "C1 done"               → over
//   "C3 wrong" / "C3 no" / "C3 not true"→ wrong (vetoed from re-extraction)
//   "C2: <his words>"                   → text (rewritten in his words)
// A message is a command only when EVERY non-empty line is one and every C
// number is actionable; anything else falls through to chat.

export interface OwnerCommand {
  seq: number
  action: OwnerCorrectionAction
  text?: string
}

const WORD_RE = /^c(\d{1,3})\s+(still|yes|right|over|done|wrong|no|not true)$/i
const TEXT_RE = /^c(\d{1,3})\s*[:\-–—]\s*(.{3,500})$/i

const WORDS: Record<string, OwnerCorrectionAction> = {
  still: 'still', yes: 'yes', right: 'yes', over: 'over', done: 'over', wrong: 'wrong', no: 'wrong', 'not true': 'wrong',
}

function parseLine(line: string): OwnerCommand | null {
  const s = line.trim()
  const word = WORD_RE.exec(s.replace(/[.!]+$/, '').trim())
  if (word) return { seq: Number(word[1]), action: WORDS[word[2]!.toLowerCase()]! }
  const text = TEXT_RE.exec(s)
  if (text) return { seq: Number(text[1]), action: 'text', text: text[2]!.trim() }
  return null
}

export function parseOwnerCommands(body: string): OwnerCommand[] | null {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) return null
  const out: OwnerCommand[] = []
  for (const line of lines) {
    const cmd = parseLine(line)
    if (!cmd) return null
    out.push(cmd)
  }
  return out
}

const FAILED: Record<string, string> = { not_found: 'no longer open', duplicate: 'already noted' }

// True when the text was owner-model commands (handled, acked in one line).
// Off / observe, a mixed message or an unknown C number → false (chat).
export async function routeOwnerModelCommands(
  userId: string,
  body: string,
  send: (text: string) => Promise<unknown>,
  now: Date = new Date(),
  updateId: number | null = null,
): Promise<boolean> {
  if (ownerModelMode() !== 'on') return false
  const commands = parseOwnerCommands(body)
  if (!commands) return false
  const { readKairosOwnerModel } = await import('@/lib/data/kairos-owner-model')
  const model = await readKairosOwnerModel(userId)
  if (!commands.every((c) => {
    const item = findBySeq(model, c.seq)
    return item !== undefined && isActionable(item, now)
  })) return false

  const acks: string[] = []
  for (const [index, cmd] of commands.entries()) {
    try {
      const res = await correctOwnerItem(userId, { seq: cmd.seq }, cmd.action, {
        via: 'telegram',
        ...(cmd.text ? { text: cmd.text } : {}),
        // One update may carry several lines; each gets its own dedup id.
        ...(updateId !== null ? { updateId: updateId * 100 + index } : {}),
      }, now)
      acks.push(res.ok ? res.label : `C${cmd.seq}: ${FAILED[res.reason] ?? res.reason}`)
    } catch (err) {
      console.error('[kairos:owner-model] command failed', err)
      acks.push(`C${cmd.seq}: could not update — try again`)
    }
  }
  await send(acks.join(' · '))
  return true
}
