import type { ChatRetrieval, RetrievedMemory } from '@/lib/kairos/chat-retrieval'

// The voice-sized grounding bundle. A spoken reply is two or three sentences,
// so the prompt carries the strongest few sources, clipped short, instead of
// the web chat's full set (Aether doc, ten archetypes, five substrate hits at
// up to 1,800 characters each). A smaller prompt reaches its first token
// sooner. Web-only sections (the moment lanes: owner model, stage, cold read)
// are not loaded for voice at all; see chat-turn-context.ts.

export const VOICE_GROUNDING = {
  cortexChars: 900,
  archetypes: 3,
  archetypeChars: 400,
  substrate: 4,
  substrateChars: 700,
  // "Today across channels" for voice: the gist, not the full digest.
  todayChars: 600,
  // Spoken turns are short; older ones add tokens, not context.
  historyMessages: 12,
} as const

function clip(memory: RetrievedMemory, max: number): RetrievedMemory {
  const body = memory.body.trim()
  return body.length <= max ? memory : { ...memory, body: `${body.slice(0, max).trimEnd()}…` }
}

// Trimmed before the prompt and the citation set are built, so Vorath can
// only cite what he was actually shown.
export function trimRetrievalForVoice(retrieval: ChatRetrieval): ChatRetrieval {
  return {
    cortex: retrieval.cortex ? clip(retrieval.cortex, VOICE_GROUNDING.cortexChars) : null,
    archetypes: retrieval.archetypes.slice(0, VOICE_GROUNDING.archetypes).map((a) => clip(a, VOICE_GROUNDING.archetypeChars)),
    substrate: retrieval.substrate.slice(0, VOICE_GROUNDING.substrate).map((s) => clip(s, VOICE_GROUNDING.substrateChars)),
  }
}
