// KAIROS_LEVEL (alias VORATH_LEVEL) 0–3: one dial for every mind switch.
// A switch set explicitly in the environment, even to '0', always wins.

export type MindLevel = 0 | 1 | 2 | 3

type SwitchValues = Readonly<Record<string, string>>

const LEVEL_1: SwitchValues = {
  KAIROS_PREDICTIONS: '1',
  KAIROS_GATE: 'observe',
  KAIROS_GATE_RECEPTIVITY: 'observe',
  KAIROS_READINESS: 'observe',
  KAIROS_BIDS: 'observe',
  KAIROS_REPAIR: 'observe',
  KAIROS_ASK_FIRST: 'observe',
  KAIROS_TRUST: 'observe',
  KAIROS_SURPRISE_GATE: 'observe',
  KAIROS_SURPRISE_CREDIT: 'observe',
  KAIROS_SURPRISE_REPLAY: 'observe',
  KAIROS_CURIOSITY_LP: 'observe',
  KAIROS_IDEA_TASTE: 'observe',
  KAIROS_LIVING_DOMINIONS: 'observe',
  KAIROS_REPO_MEMORY: '1',
  KAIROS_MISSION_CHECK: '1',
}

const LEVEL_2: SwitchValues = {
  ...LEVEL_1,
  KAIROS_GATE: '1',
  KAIROS_INITIATIVE: '1',
  KAIROS_AGENDA: '1',
  KAIROS_STAGE: 'observe',
  KAIROS_OWNER_MODEL: 'observe',
  KAIROS_CHARACTER_CHECK: '1',
}

const LEVEL_3: SwitchValues = {
  ...LEVEL_2,
  KAIROS_GATE_RECEPTIVITY: '1',
  KAIROS_READINESS: '1',
  KAIROS_BIDS: '1',
  KAIROS_REPAIR: '1',
  KAIROS_ASK_FIRST: '1',
  KAIROS_TRUST: '1',
  KAIROS_SURPRISE_GATE: '1',
  KAIROS_SURPRISE_CREDIT: '1',
  KAIROS_SURPRISE_REPLAY: '1',
  KAIROS_SURPRISE_STAGE: '1',
  KAIROS_CURIOSITY_LP: '1',
  KAIROS_IDEA_TASTE: '1',
  KAIROS_LIVING_DOMINIONS: '1',
  KAIROS_STAGE: '1',
  KAIROS_OWNER_MODEL: '1',
  KAIROS_IDEA_ATLAS: '1',
  KAIROS_IDEA_SWISS: '1',
  KAIROS_COLLISIONS: '1',
  KAIROS_IDEA_VS: '1',
  KAIROS_IDEA_RESAMPLE: '1',
  KAIROS_IDEA_SHELF: '1',
  KAIROS_IDEA_NOVELTY: '1',
  KAIROS_COLD_READ: '1',
  KAIROS_DREAMS: '1',
  KAIROS_DREAM_LINE: '1',
  KAIROS_LIFE_CHAPTERS: '1',
  KAIROS_LIFE_CHAPTER_LINE: '1',
}

const LEVELS: Record<MindLevel, SwitchValues> = { 0: {}, 1: LEVEL_1, 2: LEVEL_2, 3: LEVEL_3 }

export function mindLevel(): MindLevel {
  const n = Number((process.env.KAIROS_LEVEL ?? '').trim())
  return n === 1 || n === 2 || n === 3 ? n : 0
}

/** Raw value of a mind switch: its own env value if set, else the level's. */
export function mindSwitch(name: string): string {
  const own = process.env[name]
  if (own !== undefined && own.trim() !== '') return own
  return LEVELS[mindLevel()][name] ?? ''
}

export function levelSwitches(level: MindLevel): SwitchValues {
  return LEVELS[level]
}
