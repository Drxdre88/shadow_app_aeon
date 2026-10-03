// KAIROS_COLD_READ: unset/anything else = off; 'audit' = tag judgement turns
// and record cold reads only; '1' = record and send a "Second look" message
// when the cold view materially disagrees.

export type ColdReadMode = 'off' | 'audit' | 'speak'

export function coldReadMode(): ColdReadMode {
  const raw = process.env.KAIROS_COLD_READ?.trim().toLowerCase()
  if (raw === 'audit') return 'audit'
  if (raw === '1') return 'speak'
  return 'off'
}

export function coldReadEnabled(): boolean {
  return coldReadMode() !== 'off'
}
