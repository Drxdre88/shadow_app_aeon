// Automated-session guard for the capture hook. Sessions spawned by our own
// hooks (summariser `claude -p`, AI-cleanup `claude --print`) and scheduled
// research loops are not conversations worth remembering.

const AUTOMATION_SENTINELS = [
  'drain the aeon memory summary backlog',
  'summarising a claude code session for a personal memory layer',
  'you are running headless to drain',
]

const AUTOMATION_PREFIXES = [
  /^\s*you are an autonomous (swarm|rnd) ai quant research session/i,
]

export function isAutomatedFirstMessage(firstUserMessage) {
  if (typeof firstUserMessage !== 'string' || !firstUserMessage.trim()) return false
  if (AUTOMATION_PREFIXES.some((pattern) => pattern.test(firstUserMessage))) return true
  const lowered = firstUserMessage.toLowerCase()
  return AUTOMATION_SENTINELS.some((sentinel) => lowered.includes(sentinel))
}
