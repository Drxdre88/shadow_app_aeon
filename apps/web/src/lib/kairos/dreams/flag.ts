// KAIROS_DREAMS: unset/'0' → off (nothing planned); 'observe' → dream and read,
// store job output only (no stage post, no line); '1' → full. KAIROS_DREAM_LINE=1
// adds the Telegram "I dreamt…" line, only when dreams are fully on.
export type DreamsMode = 'off' | 'observe' | 'on'

export function dreamsMode(): DreamsMode {
  const raw = (process.env.KAIROS_DREAMS ?? '').trim().toLowerCase()
  if (raw === '1' || raw === 'on') return 'on'
  if (raw === 'observe') return 'observe'
  return 'off'
}

export function dreamLineEnabled(): boolean {
  return dreamsMode() === 'on' && (process.env.KAIROS_DREAM_LINE ?? '').trim() === '1'
}
