import { mindSwitch } from '@/lib/kairos/level'
// KAIROS_LIFE_CHAPTERS: unset/'0' → off (nothing planned, no read, prompts
// byte-identical); 'observe' → write the monthly chapter, readable via
// MCP/REST, nothing feeds back; '1' → observe + the reflect continuity block.
// KAIROS_LIFE_CHAPTER_LINE=1 (acts only in mode '1'): one Telegram notice.
export type LifeChapterMode = 'off' | 'observe' | 'on'

export function lifeChapterMode(): LifeChapterMode {
  const raw = mindSwitch('KAIROS_LIFE_CHAPTERS').trim().toLowerCase()
  if (raw === '1' || raw === 'on') return 'on'
  if (raw === 'observe') return 'observe'
  return 'off'
}

export function lifeChapterLineOn(): boolean {
  return lifeChapterMode() === 'on' && mindSwitch('KAIROS_LIFE_CHAPTER_LINE').trim() === '1'
}
