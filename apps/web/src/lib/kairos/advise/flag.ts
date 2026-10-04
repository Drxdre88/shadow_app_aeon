import { triStateFlag, type TrustMode } from '@/lib/kairos/trust/flag'

// KAIROS_ASK_FIRST 0|observe|1 — ask before advising (lane D). 'observe' =
// classify each chat turn and log only; prompts stay byte-identical.

export type AskFirstMode = TrustMode

export const askFirstMode = (): AskFirstMode => triStateFlag('KAIROS_ASK_FIRST')
