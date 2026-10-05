// Sensitive-topic lexicon: a small deterministic phrase list, no model calls.
// Phrases are matched on word boundaries; ambiguous single words that are
// common in work notes ("debt" in "tech debt", "court" in "food court") are
// only listed inside a personal phrase.

export const SENSITIVE_TOPICS = ['health', 'relationships', 'money', 'legal', 'beliefs'] as const
export type SensitiveTopic = (typeof SENSITIVE_TOPICS)[number]

export const SENSITIVE_TOPIC_LABELS: Record<SensitiveTopic, string> = {
  health: 'health',
  relationships: 'family or relationships',
  money: 'money or debt',
  legal: 'legal matters',
  beliefs: 'religion or politics',
}

const LEXICON: Record<SensitiveTopic, readonly string[]> = {
  health: [
    'diagnosis', 'diagnosed', 'therapist', 'therapy', 'medication', 'prescription', 'depression', 'depressed',
    'anxiety', 'panic attack', 'my doctor', 'the doctor', 'hospital', 'surgery', 'illness', 'chronic pain',
    'mental health', 'psychiatrist', 'symptoms', 'pregnant', 'pregnancy',
  ],
  relationships: [
    'my wife', 'my husband', 'my girlfriend', 'my boyfriend', 'my partner', 'divorce', 'breakup', 'broke up',
    'my mum', 'my mom', 'my mother', 'my dad', 'my father', 'my son', 'my daughter', 'my sister', 'my brother',
    'my family', 'custody', 'dating', 'marriage',
  ],
  money: [
    'in debt', 'my debt', 'my debts', 'credit card', 'overdraft', 'mortgage', 'my loan', 'personal loan',
    'bankrupt', 'bankruptcy', 'my salary', 'my savings', 'can\'t afford', 'cannot afford', 'payday',
    'my bank account', 'rent arrears',
  ],
  legal: [
    'lawsuit', 'my lawyer', 'a lawyer', 'solicitor', 'court case', 'in court', 'sued', 'suing', 'arrested',
    'police', 'criminal record', 'tribunal', 'settlement agreement', 'immigration status',
  ],
  beliefs: [
    'religion', 'religious', 'my faith', 'church', 'mosque', 'synagogue', 'prayer', 'praying',
    'politics', 'political', 'election', 'vote for', 'voted for', 'my party',
  ],
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const PATTERNS: ReadonlyArray<readonly [SensitiveTopic, RegExp]> = SENSITIVE_TOPICS.map((topic) => [
  topic,
  new RegExp(`(?:^|[^a-z0-9])(?:${LEXICON[topic].map(escapeRe).join('|')})(?:$|[^a-z0-9])`, 'i'),
] as const)

const SCAN_LIMIT = 20_000

// Topics the text touches, in the fixed SENSITIVE_TOPICS order.
export function detectSensitiveTopics(text: string | null | undefined): SensitiveTopic[] {
  if (!text) return []
  const sample = text.slice(0, SCAN_LIMIT).replace(/[\u2018\u2019]/g, '\'')
  return PATTERNS.filter(([, re]) => re.test(sample)).map(([topic]) => topic)
}
