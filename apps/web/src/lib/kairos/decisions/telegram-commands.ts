import type { DecisionVerdict } from '@/lib/data/validators/kairos-decisions'

// Owner decision verdicts from the operator's Telegram chat:
//   "D3 right" → right      "D3 wrong" → wrong      "D3 void" / "void D3" → void
// A message is a command only when every non-empty line is one; anything
// else falls through to chat. The data layer loads only once a command
// parsed, so ordinary chat never touches the journal.

export interface DecisionCommand { seq: number; verdict: DecisionVerdict }

const VERDICT_RE = /^d(\d{1,4})\s+(right|wrong|void)$/i
const VOID_RE = /^void\s+d(\d{1,4})$/i

function parseLine(line: string): DecisionCommand | null {
  const s = line.trim().replace(/[.!]+$/, '').trim()
  let m = VERDICT_RE.exec(s)
  if (m) return { seq: Number(m[1]), verdict: m[2]!.toLowerCase() as DecisionVerdict }
  m = VOID_RE.exec(s)
  if (m) return { seq: Number(m[1]), verdict: 'void' }
  return null
}

export function parseDecisionCommands(body: string): DecisionCommand[] | null {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) return null
  const out: DecisionCommand[] = []
  for (const line of lines) {
    const cmd = parseLine(line)
    if (!cmd) return null
    out.push(cmd)
  }
  return out
}

const REFUSAL_TEXT: Record<string, string> = {
  already_settled: 'already settled',
  unconfirmed: 'relayed — confirm it in the app first',
}

async function runCommand(userId: string, cmd: DecisionCommand, now: Date): Promise<string> {
  const label = `D${cmd.seq}`
  const data = await import('@/lib/data/kairos-decisions')
  const decision = await data.findOpenKairosDecisionBySeq(userId, cmd.seq)
  if (!decision) return `${label}: no open decision`
  const res = await data.settleKairosDecisionByOwner(userId, decision.id, cmd.verdict, { via: 'telegram' }, now)
  if (res.ok) return `✓ ${label} ${cmd.verdict}`
  return `${label}: ${REFUSAL_TEXT[res.reason] ?? 'no open decision'}`
}

export async function routeDecisionCommands(
  userId: string,
  body: string,
  send: (text: string) => Promise<unknown>,
  now: Date = new Date(),
): Promise<boolean> {
  const commands = parseDecisionCommands(body)
  if (!commands) return false
  const acks: string[] = []
  for (const cmd of commands) {
    try {
      acks.push(await runCommand(userId, cmd, now))
    } catch (err) {
      console.error('[kairos:decision-commands] command failed', err)
      acks.push(`D${cmd.seq}: could not update — try again`)
    }
  }
  await send(acks.join(' · '))
  return true
}
